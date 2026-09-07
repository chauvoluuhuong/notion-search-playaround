import { resolveDatabaseId, isUuid } from './databases.js';
import { getDatabaseSchema, resolveValues } from './directory.js';
import { getContentIndex, snippet } from './content.js';
import { queryDatabase, readProperty } from './notion.js';

const MAX_CANDIDATE_PAGES = 10; // up to 1000 rows

const asArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');

/**
 * Build a Notion filter group for people or relation properties by resolving human names to UUIDs.
 */
function resolveIdFilter(values, entries, propertyName, notionKind) {
  const ids = new Set();
  let includeEmpty = false;

  for (const raw of values) {
    const v = String(raw).trim();
    if (!v) continue;
    if (v.toLowerCase() === 'none' || v.toLowerCase() === 'unassigned' || v.toLowerCase() === 'empty') {
      includeEmpty = true;
      continue;
    }
    const hits = resolveValues(v, entries);
    if (hits.length === 0 && !isUuid(v)) {
      return { unmatched: v };
    }
    if (hits.length > 0) {
      hits.forEach((id) => ids.add(id));
    } else if (isUuid(v)) {
      ids.add(v);
    }
  }

  const leaves = [...ids].map((id) => ({ property: propertyName, [notionKind]: { contains: id } }));
  if (includeEmpty) {
    leaves.push({ property: propertyName, [notionKind]: { is_empty: true } });
  }

  return { leaves, ids: [...ids] };
}

/**
 * Build dynamic Notion query filter for any database based on its discovered schema.
 */
export async function buildQuery(databaseId, params = {}) {
  const resolvedDbId = await resolveDatabaseId(databaseId);
  const schema = await getDatabaseSchema(resolvedDbId);
  const and = [];
  const resolved = {};

  // Build a lookup for params: exact property name, lowercased, slugified
  const paramMap = new Map();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      paramMap.set(k, v);
      paramMap.set(k.toLowerCase(), v);
      paramMap.set(slugify(k), v);
    }
  }

  for (const prop of schema.properties) {
    const propName = prop.name;
    const propType = prop.type;
    const rawVal = paramMap.get(propName) ?? paramMap.get(propName.toLowerCase()) ?? paramMap.get(slugify(propName));

    if (rawVal === undefined || rawVal === null || rawVal === '') continue;

    if (propType === 'people') {
      const vals = asArray(rawVal);
      if (vals.length) {
        const users = schema.people_by_property[propName] || [];
        const res = resolveIdFilter(vals, users, propName, 'people');
        if (res.unmatched) {
          return { error: `Unknown ${propName} "${res.unmatched}". See GET /api/filter-instructions for allowed values.` };
        }
        resolved[propName] = res.ids;
        if (res.leaves.length) {
          and.push(res.leaves.length === 1 ? res.leaves[0] : { or: res.leaves });
        }
      }
    } else if (propType === 'relation') {
      const vals = asArray(rawVal);
      if (vals.length) {
        const targets = schema.relations_by_property[propName] || [];
        const res = resolveIdFilter(vals, targets, propName, 'relation');
        if (res.unmatched) {
          return { error: `Unknown ${propName} "${res.unmatched}". See GET /api/filter-instructions for allowed values.` };
        }
        resolved[propName] = res.ids;
        if (res.leaves.length) {
          and.push(res.leaves.length === 1 ? res.leaves[0] : { or: res.leaves });
        }
      }
    } else if (propType === 'select' || propType === 'status') {
      const vals = asArray(rawVal);
      if (vals.length) {
        const leaves = [];
        for (const v of vals) {
          if (v.toLowerCase() === 'none' || v.toLowerCase() === 'empty') {
            leaves.push({ property: propName, [propType]: { is_empty: true } });
          } else {
            leaves.push({ property: propName, [propType]: { equals: v } });
          }
        }
        if (leaves.length) {
          and.push(leaves.length === 1 ? leaves[0] : { or: leaves });
        }
      }
    } else if (propType === 'multi_select') {
      const vals = asArray(rawVal);
      if (vals.length) {
        const leaves = [];
        for (const v of vals) {
          if (v.toLowerCase() === 'none' || v.toLowerCase() === 'empty') {
            leaves.push({ property: propName, multi_select: { is_empty: true } });
          } else {
            leaves.push({ property: propName, multi_select: { contains: v } });
          }
        }
        if (leaves.length) {
          and.push(leaves.length === 1 ? leaves[0] : { or: leaves });
        }
      }
    } else if (propType === 'checkbox') {
      const b = typeof rawVal === 'boolean' ? rawVal : String(rawVal).toLowerCase() === 'true' || rawVal === '1';
      and.push({ property: propName, checkbox: { equals: b } });
    } else if (propType === 'number') {
      if (typeof rawVal === 'object' && rawVal !== null) {
        // e.g. { greater_than_or_equal_to: 5 }
        and.push({ property: propName, number: rawVal });
      } else {
        const str = String(rawVal).trim();
        const num = Number(str.replace(/^[<>=!]+/, ''));
        if (!isNaN(num)) {
          if (str.startsWith('>=')) and.push({ property: propName, number: { greater_than_or_equal_to: num } });
          else if (str.startsWith('<=')) and.push({ property: propName, number: { less_than_or_equal_to: num } });
          else if (str.startsWith('>')) and.push({ property: propName, number: { greater_than: num } });
          else if (str.startsWith('<')) and.push({ property: propName, number: { less_than: num } });
          else if (str.startsWith('!=')) and.push({ property: propName, number: { does_not_equal: num } });
          else and.push({ property: propName, number: { equals: num } });
        }
      }
    } else if (propType === 'date') {
      if (typeof rawVal === 'object' && rawVal !== null) {
        and.push({ property: propName, date: rawVal });
      } else {
        const str = String(rawVal).trim();
        if (str.toLowerCase() === 'none' || str.toLowerCase() === 'empty') {
          and.push({ property: propName, date: { is_empty: true } });
        } else if (str.startsWith('>=')) {
          and.push({ property: propName, date: { on_or_after: str.slice(2).trim() } });
        } else if (str.startsWith('<=')) {
          and.push({ property: propName, date: { on_or_before: str.slice(2).trim() } });
        } else if (str.startsWith('>')) {
          and.push({ property: propName, date: { after: str.slice(1).trim() } });
        } else if (str.startsWith('<')) {
          and.push({ property: propName, date: { before: str.slice(1).trim() } });
        } else {
          and.push({ property: propName, date: { equals: str } });
        }
      }
    } else if (propType === 'rich_text' || propType === 'title') {
      const str = String(rawVal).trim();
      if (str.toLowerCase() === 'none' || str.toLowerCase() === 'empty') {
        and.push({ property: propName, [propType]: { is_empty: true } });
      } else {
        and.push({ property: propName, [propType]: { contains: str } });
      }
    }
  }

  const filter = and.length === 0 ? undefined : and.length === 1 ? and[0] : { and };
  return { filter, resolved, schema, databaseId: resolvedDbId };
}

/**
 * Equivalent Notion filter representation for text search.
 */
function equivalentTextFilter(fields, q, schema) {
  const leaves = [];
  for (const f of fields) {
    if (f.notion_type === 'title') leaves.push({ property: f.notion_property, title: { contains: q } });
    else if (f.notion_type === 'rich_text') leaves.push({ property: f.notion_property, rich_text: { contains: q } });
    else if (f.notion_type === 'people') {
      const users = schema.people_by_property[f.notion_property] || [];
      resolveValues(q, users).forEach((id) =>
        leaves.push({ property: f.notion_property, people: { contains: id } }),
      );
    } else if (f.notion_type === 'relation') {
      const targets = schema.relations_by_property[f.notion_property] || [];
      resolveValues(q, targets).forEach((id) =>
        leaves.push({ property: f.notion_property, relation: { contains: id } }),
      );
    }
  }
  return leaves;
}

async function fetchCandidates(databaseId, filter) {
  const rows = [];
  let cursor;
  for (let i = 0; i < MAX_CANDIDATE_PAGES; i++) {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    try {
      const res = await queryDatabase(databaseId, body);
      rows.push(...(res.results || []));
      if (!res.has_more) return { rows, truncated: false };
      cursor = res.next_cursor;
    } catch (err) {
      if (rows.length > 0) return { rows, truncated: true };
      throw err;
    }
  }
  return { rows, truncated: true };
}

/**
 * Dynamically shape any database page according to its schema.
 */
function shapeGeneric(page, schema, body, comments) {
  const p = page.properties || {};
  const shapedProps = {};
  let titleVal = 'Untitled';

  for (const prop of schema.properties) {
    const name = prop.name;
    const rawProp = p[name];
    const val = readProperty(rawProp);

    if (prop.type === 'title') {
      titleVal = val || 'Untitled';
      shapedProps[name] = val;
    } else if (prop.type === 'relation') {
      const targets = schema.relations_by_property[name] || [];
      const relIds = Array.isArray(val) ? val : [];
      shapedProps[name] = relIds.map((id) => {
        const found = targets.find((t) => t.id === id);
        return {
          id,
          label: found?.label || found?.title || `Page (${id.slice(0, 8)}…)`,
        };
      });
    } else if (prop.type === 'people') {
      const users = schema.people_by_property[name] || [];
      const peopleList = Array.isArray(val) ? val : [];
      shapedProps[name] = peopleList.map((u) => {
        const found = users.find((x) => x.id === u.id);
        return {
          id: u.id,
          label: found?.label || u.name || u.email || `User (${u.id.slice(0, 8)}…)`,
          name: u.name,
          email: u.email,
          avatar_url: u.avatar_url,
        };
      });
    } else {
      shapedProps[name] = val;
    }
  }

  // Find assignees and relations for quick UI compatibility
  const firstPeople = schema.properties.find((p) => p.type === 'people')?.name;
  const firstRelation = schema.properties.find((p) => p.type === 'relation')?.name;
  const firstStatus = schema.properties.find((p) => p.type === 'status')?.name;
  const firstSelect = schema.properties.find((p) => p.type === 'select')?.name;

  return {
    id: page.id,
    url: page.url,
    icon: page.icon || null,
    cover: page.cover || null,
    title: titleVal,
    task_name: titleVal, // backwards compatibility
    properties: shapedProps,
    // Convenience fields for UI
    assignees: firstPeople ? shapedProps[firstPeople] || [] : [],
    relation_targets: firstRelation ? shapedProps[firstRelation] || [] : [],
    status: firstStatus ? shapedProps[firstStatus]?.name ?? shapedProps[firstStatus] : null,
    priority: firstSelect ? shapedProps[firstSelect]?.name ?? shapedProps[firstSelect] : null,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    page_content: body || null,
    comments: (comments || []).map((c) => {
      let authorLabel = null;
      if (c.author_id) {
        for (const userList of Object.values(schema.people_by_property)) {
          const found = userList.find((u) => u.id === c.author_id);
          if (found) { authorLabel = found.label; break; }
        }
        if (!authorLabel) authorLabel = `User ${c.author_id.slice(0, 8)}…`;
      }
      return {
        ...c,
        author: authorLabel,
      };
    }),
  };
}

/**
 * Test which fields match free text term `q`.
 */
function matchFieldsGeneric(row, q, activeTextFields, schema) {
  const t = q.toLowerCase();
  const hit = (v) => {
    if (v == null) return false;
    if (typeof v === 'string') return v.toLowerCase().includes(t);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v).toLowerCase().includes(t);
    if (Array.isArray(v)) return v.some((item) => hit(item?.label || item?.name || item?.title || item));
    if (typeof v === 'object') return hit(v.name || v.label || v.title);
    return false;
  };

  const out = [];

  for (const f of activeTextFields) {
    if (f.key === 'page_content') {
      if (hit(row.page_content)) out.push('page_content');
    } else if (f.key === 'comment') {
      if (row.comments && row.comments.some((c) => hit(c.text) || hit(c.author))) {
        out.push('comment');
      }
    } else if (f.notion_type === 'people') {
      const users = schema.people_by_property[f.notion_property] || [];
      const userIds = resolveValues(q, users);
      const rowUsers = row.properties[f.notion_property] || [];
      if (rowUsers.some((u) => userIds.includes(u.id) || hit(u.label) || hit(u.name) || hit(u.email))) {
        out.push(f.key);
      }
    } else if (f.notion_type === 'relation') {
      const targets = schema.relations_by_property[f.notion_property] || [];
      const targetIds = resolveValues(q, targets);
      const rowRelations = row.properties[f.notion_property] || [];
      if (rowRelations.some((r) => targetIds.includes(r.id) || hit(r.label) || hit(r.title))) {
        out.push(f.key);
      }
    } else {
      const val = row.properties[f.notion_property];
      if (hit(val)) {
        out.push(f.key);
      }
    }
  }

  return out;
}

export async function search(params = {}) {
  const rawDb = params.databaseId || params.database_id || params.database;

  // Extract filter parameters from filter object or top-level properties
  const filterParams = {};
  if (typeof params.filter === 'object' && params.filter !== null) {
    Object.assign(filterParams, params.filter);
  }
  if (typeof params.filters === 'object' && params.filters !== null) {
    Object.assign(filterParams, params.filters);
  }
  const RESERVED = new Set([
    'databaseId', 'database_id', 'database',
    'searchText', 'search_text', 'q',
    'filter', 'filters', 'fields',
    'pageSize', 'page_size', 'offset', 'startCursor', 'start_cursor',
    'refresh',
  ]);
  for (const [k, v] of Object.entries(params)) {
    if (!RESERVED.has(k) && v !== undefined && v !== null && v !== '') {
      if (filterParams[k] === undefined) {
        filterParams[k] = v;
      }
    }
  }

  const built = await buildQuery(rawDb, filterParams);
  if (built.error) {
    return {
      results: [],
      count: 0,
      total: 0,
      offset: 0,
      has_more: false,
      next_cursor: null,
      notice: built.error,
      filter_applied: null,
      notion_filter: null,
      text_matching: null,
    };
  }

  const { filter, resolved, schema, databaseId } = built;
  const q = String(params.searchText ?? params.search_text ?? params.q ?? '').trim();

  // Discover all text-capable fields for this database
  const allTextFields = [];
  for (const p of schema.properties) {
    allTextFields.push({
      key: slugify(p.name),
      label: p.name,
      notion_property: p.name,
      notion_type: p.type,
    });
  }
  allTextFields.push(
    { key: 'page_content', label: 'Page Content', notion_property: null, notion_type: 'page_content' },
    { key: 'comment', label: 'Comments', notion_property: null, notion_type: 'comments' },
  );

  const reqFieldKeys = asArray(params.fields).map(slugify);
  const activeFields = reqFieldKeys.length > 0
    ? allTextFields.filter((f) => reqFieldKeys.includes(f.key))
    : allTextFields;

  const wantsBody = activeFields.some((f) => f.key === 'page_content');
  const wantsComments = activeFields.some((f) => f.key === 'comment');

  const pageSize = Math.min(Math.max(Number(params.pageSize ?? params.page_size) || 25, 1), 100);
  const offset = Math.max(Number(params.offset ?? params.startCursor ?? params.start_cursor) || 0, 0);

  const [{ rows, truncated }, content] = await Promise.all([
    fetchCandidates(databaseId, filter),
    getContentIndex(databaseId),
  ]);

  let shaped = rows.map((p) =>
    shapeGeneric(
      p,
      schema,
      content?.textById?.get(p.id) ?? null,
      content?.commentsById?.get(p.id) ?? [],
    ),
  );

  let textMatching = null;
  if (q) {
    shaped = shaped
      .map((r) => ({ ...r, matched_fields: matchFieldsGeneric(r, q, activeFields, schema) }))
      .filter((r) => r.matched_fields.length > 0);

    textMatching = {
      term: q,
      fields: activeFields.map((f) => f.key),
      page_content: wantsBody
        ? {
            matched_in_process: true,
            pages_indexed: content?.pages_indexed ?? 0,
            indexed_at: content?.built_at ?? null,
          }
        : null,
      comment: wantsComments
        ? {
            matched_in_process: true,
            comments_indexed: content?.comments_indexed ?? 0,
            pages_with_comments: content?.pages_with_comments ?? 0,
            inline_comments_indexed: content?.inline_comments_indexed ?? false,
            permission_denied: content?.comments_permission_denied ?? false,
            caveat: content?.comments_permission_denied
              ? 'Notion integration token lacks "Read comments" capability. To search comments, enable "Read comments" on your integration at https://www.notion.so/my-integrations.'
              : 'Unresolved comments are included; resolved threads are excluded.',
            indexed_at: content?.built_at ?? null,
          }
        : null,
    };
  } else {
    shaped = shaped.map((r) => ({ ...r, matched_fields: [] }));
  }

  const total = shaped.length;
  const slice = shaped.slice(offset, offset + pageSize).map((r) => ({
    ...r,
    page_content: q ? snippet(r.page_content, q) : null,
    page_content_chars: r.page_content ? r.page_content.length : 0,
    comment_count: r.comments.length,
    comments: q
      ? r.comments
          .filter((c) => c.text.toLowerCase().includes(q.toLowerCase()))
          .map((c) => ({ ...c, excerpt: snippet(c.text, q) }))
      : [],
  }));

  return {
    database: {
      id: schema.database.id,
      title: schema.database.title,
      icon: schema.database.icon,
      url: schema.database.url,
    },
    results: slice,
    count: slice.length,
    total,
    offset,
    has_more: offset + slice.length < total,
    next_cursor: offset + slice.length < total ? String(offset + slice.length) : null,
    notice: truncated ? `Only the first ${rows.length} rows were scanned.` : null,
    filter_applied: filter ?? null,
    notion_filter: filter ?? null, // alias for backwards compatibility
    text_matching: textMatching,
    resolved,
  };
}
