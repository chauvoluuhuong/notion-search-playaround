import { getDatabase, listUsers, plainText, queryAll, queryDatabase } from './notion.js';
import { dashedUuid, isUuid } from './databases.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_SCAN_PAGES = 10; // up to 1000 rows scanned to discover in-use values

const schemaCache = new Map();

async function listUsersSafe() {
  try {
    const out = [];
    let cursor;
    do {
      const page = await listUsers(cursor);
      out.push(...(page.results || []));
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  } catch {
    return []; // integration may lack the "read user information" capability
  }
}

async function scanRows(databaseId) {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_SCAN_PAGES; i++) {
    try {
      const page = await queryDatabase(databaseId, { page_size: 100, start_cursor: cursor });
      out.push(...(page.results || []));
      if (!page.has_more) break;
      cursor = page.next_cursor;
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Discover the schema, filter options, and relation/people directories for a given database.
 */
async function buildSchema(databaseId) {
  const [db, users, rows] = await Promise.all([
    getDatabase(databaseId),
    listUsersSafe(),
    scanRows(databaseId),
  ]);

  const properties = db.properties || {};
  const schemaProperties = [];
  const optionsByProperty = {};
  const peopleByProperty = {};
  const relationsByProperty = {};

  // Build workspace user lookup
  const userMap = new Map();
  for (const u of users) {
    if (u.type === 'bot' && !u.name) continue;
    userMap.set(u.id, {
      id: u.id,
      name: u.name ?? null,
      email: u.person?.email ?? null,
      avatar_url: u.avatar_url ?? null,
      count: 0,
    });
  }

  // Inspect each property in the database
  for (const [propName, propDef] of Object.entries(properties)) {
    const propType = propDef.type;
    const propInfo = {
      name: propName,
      type: propType,
      id: propDef.id,
      description: propDef.description || null,
    };

    if (propType === 'select' || propType === 'multi_select') {
      const schemaOpts = (propDef[propType]?.options || []).map((o) => ({
        id: o.id,
        name: o.name,
        color: o.color,
        count: 0,
      }));

      // Count occurrences in scanned rows
      const counts = new Map();
      for (const row of rows) {
        const val = row.properties[propName];
        if (!val) continue;
        if (propType === 'select' && val.select?.name) {
          counts.set(val.select.name, (counts.get(val.select.name) || 0) + 1);
        } else if (propType === 'multi_select' && Array.isArray(val.multi_select)) {
          for (const item of val.multi_select) {
            counts.set(item.name, (counts.get(item.name) || 0) + 1);
          }
        }
      }

      for (const opt of schemaOpts) {
        opt.count = counts.get(opt.name) || 0;
      }

      optionsByProperty[propName] = schemaOpts;
      propInfo.options = schemaOpts;
    } else if (propType === 'status') {
      const schemaOpts = (propDef.status?.options || []).map((o) => ({
        id: o.id,
        name: o.name,
        color: o.color,
        count: 0,
      }));
      const groups = (propDef.status?.groups || []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        option_ids: g.option_ids || [],
      }));

      const counts = new Map();
      for (const row of rows) {
        const val = row.properties[propName];
        if (val?.status?.name) {
          counts.set(val.status.name, (counts.get(val.status.name) || 0) + 1);
        }
      }

      for (const opt of schemaOpts) {
        opt.count = counts.get(opt.name) || 0;
      }

      optionsByProperty[propName] = schemaOpts;
      propInfo.options = schemaOpts;
      propInfo.groups = groups;
    } else if (propType === 'people') {
      const propUsers = new Map();
      // copy workspace users
      for (const [uid, u] of userMap.entries()) {
        propUsers.set(uid, { ...u });
      }

      // scan rows for assignees/members, including guests
      for (const row of rows) {
        const val = row.properties[propName];
        for (const u of val?.people || []) {
          if (!propUsers.has(u.id)) {
            propUsers.set(u.id, {
              id: u.id,
              name: u.name ?? null,
              email: u.person?.email ?? null,
              avatar_url: u.avatar_url ?? null,
              count: 0,
            });
          }
          propUsers.get(u.id).count += 1;
        }
      }

      const usersList = [...propUsers.values()]
        .map((u) => ({
          ...u,
          label: u.name || u.email || `Unnamed member (${u.id.slice(0, 8)}…)`,
          resolvable: Boolean(u.name || u.email),
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

      peopleByProperty[propName] = usersList;
      propInfo.users = usersList;
    } else if (propType === 'relation') {
      const relationTargetDbId = propDef.relation?.database_id;
      propInfo.relation_database_id = relationTargetDbId;

      // Fetch related pages to resolve IDs -> human titles
      let targetPages = [];
      if (relationTargetDbId) {
        try {
          targetPages = await queryAll(relationTargetDbId);
        } catch {
          targetPages = [];
        }
      }

      // Count relations in rows
      const counts = new Map();
      for (const row of rows) {
        const val = row.properties[propName];
        for (const r of val?.relation || []) {
          counts.set(r.id, (counts.get(r.id) || 0) + 1);
        }
      }

      const relationItems = targetPages
        .map((p) => {
          const titleProp = Object.values(p.properties || {}).find((v) => v.type === 'title');
          const title = plainText(titleProp?.title).trim();
          return {
            id: p.id,
            label: title || `Untitled (${p.id.slice(0, 8)}…)`,
            title: title || null,
            count: counts.get(p.id) || 0,
          };
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true }));

      relationsByProperty[propName] = relationItems;
      propInfo.targets = relationItems;
    } else if (propType === 'number') {
      propInfo.format = propDef.number?.format || 'number';
    }

    schemaProperties.push(propInfo);
  }

  // Find primary title property
  const titleProp = schemaProperties.find((p) => p.type === 'title');

  return {
    database: {
      id: db.id,
      title: plainText(db.title).trim() || 'Untitled Database',
      description: plainText(db.description).trim() || null,
      icon: db.icon,
      cover: db.cover,
      url: db.url || `https://app.notion.com/${db.id.replace(/-/g, '')}`,
    },
    title_property: titleProp?.name || null,
    properties: schemaProperties,
    options_by_property: optionsByProperty,
    people_by_property: peopleByProperty,
    relations_by_property: relationsByProperty,
    scanned_rows: rows.length,
    built_at: new Date().toISOString(),
  };
}

export async function getDatabaseSchema(databaseId, { refresh = false } = {}) {
  const normId = dashedUuid(databaseId).toLowerCase();
  const cached = schemaCache.get(normId);
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  const value = await buildSchema(normId);
  schemaCache.set(normId, { at: Date.now(), value });
  return value;
}

/**
 * Resolve a term (name, title, email, or UUID) against a list of entries with { id, label, name, email, title }.
 */
export function resolveValues(input, entries = []) {
  const term = String(input || '').trim();
  if (!term) return [];
  if (isUuid(term)) return [dashedUuid(term)];
  const t = term.toLowerCase();
  return entries
    .filter((e) =>
      [e.label, e.name, e.email, e.title].filter(Boolean).some((v) => v.toLowerCase().includes(t)),
    )
    .map((e) => e.id);
}

// Backward compatibility alias
export async function getDirectory({ refresh = false } = {}) {
  const { resolveDatabaseId } = await import('./databases.js');
  const databaseId = await resolveDatabaseId();
  const schema = await getDatabaseSchema(databaseId, { refresh });

  // Map to old directory format for any legacy callers
  const firstPeopleProp = Object.values(schema.people_by_property)[0] || [];
  const firstRelationProp = Object.values(schema.relations_by_property)[0] || [];
  const firstStatusProp = (schema.properties.find((p) => p.type === 'status')?.options || []).map((o) => o.name);
  const firstSelectProp = (schema.properties.find((p) => p.type === 'select')?.options || []).map((o) => o.name);

  return {
    assignees: firstPeopleProp,
    sprints: firstRelationProp,
    statuses: firstStatusProp,
    priorities: firstSelectProp,
    scanned_rows: schema.scanned_rows,
    built_at: schema.built_at,
    schema,
  };
}
