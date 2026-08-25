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

export const getDatabase = (id) => request('GET', `/databases/${id}`);
export const queryDatabase = (id, body) => request('POST', `/databases/${id}/query`, body);
export const listUsers = (cursor) =>
  request('GET', `/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
export const getBlockChildren = (blockId, cursor) =>
  request('GET', `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);

/** Query every page of a database (used for the small Sprint table). */
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
    case 'number':       return prop.number;
    case 'checkbox':     return prop.checkbox;
    case 'url':          return prop.url;
    case 'select':       return prop.select?.name ?? null;
    case 'status':       return prop.status?.name ?? null;
    case 'multi_select': return prop.multi_select.map((o) => o.name);
    case 'people':       return prop.people.map((u) => ({ id: u.id, name: u.name ?? null, email: u.person?.email ?? null }));
    case 'relation':     return prop.relation.map((r) => r.id);
    case 'date':         return prop.date?.start ?? null;
    case 'unique_id':    return prop.unique_id ? `${prop.unique_id.prefix ? prop.unique_id.prefix + '-' : ''}${prop.unique_id.number}` : null;
    case 'formula':      return prop.formula?.[prop.formula.type] ?? null;
    case 'rollup':       return prop.rollup?.[prop.rollup.type] ?? null;
    default:             return null;
  }
}
