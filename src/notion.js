import { NOTION_API_KEY, NOTION_VERSION } from './config.js';

const BASE = 'https://api.notion.com/v1';

export class NotionError extends Error {
  constructor(status, body) {
    super(body?.message || `Notion API error ${status}`);
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

async function request(method, pathname, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new NotionError(res.status, json);
  return json;
}

export const searchObjects = (body) => request('POST', '/search', body);
export const getDatabase = (id) => request('GET', `/databases/${id}`);
export const queryDatabase = (id, body) => request('POST', `/databases/${id}/query`, body);
export const getPage = (id) => request('GET', `/pages/${id}`);
export const listUsers = (cursor) =>
  request('GET', `/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
export const getBlockChildren = (blockId, cursor) =>
  request('GET', `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
// Returns UNRESOLVED comments only — Notion exposes no way to read resolved threads.
export const getComments = (blockId, cursor) =>
  request('GET', `/comments?block_id=${blockId}&page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);

/** Query every database in workspace. */
export async function searchAllDatabases() {
  const out = [];
  let cursor;
  do {
    const res = await searchObjects({
      filter: { value: 'database', property: 'object' },
      page_size: 100,
      start_cursor: cursor,
    });
    out.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** Query every page of a database (handles pagination). */
export async function queryAll(id, body = {}) {
  const out = [];
  let cursor;
  do {
    const page = await queryDatabase(id, { ...body, page_size: 100, start_cursor: cursor });
    out.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return out;
}

// ---------- property readers ----------

export const plainText = (rich) => (rich || []).map((t) => t.plain_text).join('');

export function readProperty(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':        return plainText(prop.title);
    case 'rich_text':    return plainText(prop.rich_text);
    case 'number':       return prop.number ?? null;
    case 'checkbox':     return Boolean(prop.checkbox);
    case 'url':          return prop.url ?? null;
    case 'email':        return prop.email ?? null;
    case 'phone_number': return prop.phone_number ?? null;
    case 'select':       return prop.select ? { id: prop.select.id, name: prop.select.name, color: prop.select.color } : null;
    case 'status':       return prop.status ? { id: prop.status.id, name: prop.status.name, color: prop.status.color } : null;
    case 'multi_select': return (prop.multi_select || []).map((o) => ({ id: o.id, name: o.name, color: o.color }));
    case 'people':       return (prop.people || []).map((u) => ({
                           id: u.id,
                           name: u.name ?? null,
                           email: u.person?.email ?? null,
                           avatar_url: u.avatar_url ?? null,
                         }));
    case 'relation':     return (prop.relation || []).map((r) => r.id);
    case 'date':         return prop.date ? { start: prop.date.start, end: prop.date.end } : null;
    case 'created_time': return prop.created_time ?? null;
    case 'last_edited_time': return prop.last_edited_time ?? null;
    case 'created_by':   return prop.created_by ? { id: prop.created_by.id, name: prop.created_by.name ?? null } : null;
    case 'last_edited_by': return prop.last_edited_by ? { id: prop.last_edited_by.id, name: prop.last_edited_by.name ?? null } : null;
    case 'files':        return (prop.files || []).map((f) => f.name || f.file?.url || f.external?.url || 'file');
    case 'unique_id':    return prop.unique_id ? `${prop.unique_id.prefix ? prop.unique_id.prefix + '-' : ''}${prop.unique_id.number}` : null;
    case 'formula':      return prop.formula?.[prop.formula.type] ?? null;
    case 'rollup':       return prop.rollup?.[prop.rollup.type] ?? null;
    default:             return null;
  }
}
