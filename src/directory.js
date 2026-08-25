import { ASSIGNEE_PROPERTY, DATABASE_ID, SPRINT_DATABASE_ID, SPRINT_PROPERTY } from './config.js';
import { getDatabase, listUsers, plainText, queryAll, queryDatabase } from './notion.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_SCAN_PAGES = 10; // up to 1000 rows scanned to discover in-use values

let cache = null;

/**
 * Notion cannot filter a `people` or `relation` column by text, only by id.
 * So the filterable values for Assignee and Sprint have to be discovered up
 * front: that list is both what /api/filters advertises and what the free-text
 * search resolves a name against.
 */
async function build() {
  const [users, sprintPages, rows, db] = await Promise.all([
    listUsersSafe(),
    queryAll(SPRINT_DATABASE_ID).catch(() => []),
    scanRows(),
    getDatabase(DATABASE_ID),
  ]);

  const statuses = (db.properties['Status']?.status?.options || []).map((o) => o.name);
  const priorities = (db.properties['Priority']?.select?.options || []).map((o) => o.name);

  // --- assignees ---
  const byId = new Map();
  const put = (id, patch) => {
    const cur = byId.get(id) || { id, name: null, email: null, avatar_url: null, count: 0 };
    byId.set(id, { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null)) });
  };
  for (const u of users) {
    if (u.type !== 'person') continue; // skip integration bots
    put(u.id, { name: u.name, email: u.person?.email, avatar_url: u.avatar_url });
  }
  for (const row of rows) {
    for (const u of row.properties[ASSIGNEE_PROPERTY]?.people || []) {
      put(u.id, { name: u.name, email: u.person?.email, avatar_url: u.avatar_url });
      byId.get(u.id).count += 1;
    }
  }
  const assignees = [...byId.values()]
    .map((u) => ({ ...u, label: u.name || u.email || `Unnamed member (${u.id.slice(0, 8)}…)`, resolvable: Boolean(u.name || u.email) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // --- sprints ---
  const sprintCounts = new Map();
  for (const row of rows) {
    for (const r of row.properties[SPRINT_PROPERTY]?.relation || []) {
      sprintCounts.set(r.id, (sprintCounts.get(r.id) || 0) + 1);
    }
  }
  const sprints = sprintPages
    .map((p) => {
      const titleProp = Object.values(p.properties).find((v) => v.type === 'title');
      const name = plainText(titleProp?.title).trim();
      return {
        id: p.id,
        label: name || `Untitled sprint (${p.id.slice(0, 8)}…)`,
        name: name || null,
        status: p.properties['Status']?.status?.name ?? null,
        start_date: p.properties['Start Date']?.date?.start ?? null,
        end_date: p.properties['End Date']?.date?.start ?? null,
        count: sprintCounts.get(p.id) || 0,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return { assignees, sprints, statuses, priorities, scanned_rows: rows.length, built_at: new Date().toISOString() };
}

async function listUsersSafe() {
  try {
    const out = [];
    let cursor;
    do {
      const page = await listUsers(cursor);
      out.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return out;
  } catch {
    return []; // integration may lack the "read user information" capability
  }
}

async function scanRows() {
  const out = [];
  let cursor;
  for (let i = 0; i < MAX_SCAN_PAGES; i++) {
    const page = await queryDatabase(DATABASE_ID, { page_size: 100, start_cursor: cursor });
    out.push(...page.results);
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }
  return out;
}

export async function getDirectory({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await build();
  cache = { at: Date.now(), value };
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID_RE.test(String(s).trim());
const dashed = (s) => {
  const h = String(s).replace(/-/g, '');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** Turn "lucas", an email, or a raw uuid into concrete ids to filter on. */
export function resolveValues(input, entries) {
  const term = String(input || '').trim();
  if (!term) return [];
  if (isUuid(term)) return [dashed(term)];
  const t = term.toLowerCase();
  return entries
    .filter((e) => [e.label, e.name, e.email].filter(Boolean).some((v) => v.toLowerCase().includes(t)))
    .map((e) => e.id);
}
