import { DATABASE_ID } from './config.js';
import { getBlockChildren, queryDatabase } from './notion.js';

const TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 8;
const MAX_PAGES = 1000;

let cache = null;
let inFlight = null;

/** Flatten every rich_text / caption run inside one block. */
function blockText(block) {
  const body = block[block.type];
  if (!body || typeof body !== 'object') return '';
  const runs = [...(body.rich_text || []), ...(body.caption || [])];
  return runs.map((t) => t.plain_text ?? '').join('');
}

async function pageText(pageId) {
  const parts = [];
  let cursor;
  try {
    do {
      const res = await getBlockChildren(pageId, cursor);
      for (const b of res.results) {
        const t = blockText(b).trim();
        if (t) parts.push(t);
        // One level of nesting (toggles, list children, callouts) is enough here.
        if (b.has_children) {
          try {
            const kids = await getBlockChildren(b.id);
            for (const k of kids.results) {
              const kt = blockText(k).trim();
              if (kt) parts.push(kt);
            }
          } catch { /* unreadable child block */ }
        }
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  } catch {
    return ''; // page body not shared with the integration
  }
  return parts.join('\n');
}

async function pool(items, worker, size = CONCURRENCY) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Notion database filters can only see *properties*. Body text of each task
 * page is invisible to them, so it is indexed here and matched in-process.
 */
async function build() {
  const rows = [];
  let cursor;
  while (rows.length < MAX_PAGES) {
    const page = await queryDatabase(DATABASE_ID, { page_size: 100, start_cursor: cursor });
    rows.push(...page.results);
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }

  const texts = await pool(rows, (p) => pageText(p.id));
  const textById = new Map();
  rows.forEach((p, i) => textById.set(p.id, texts[i]));

  return {
    textById,
    pages_indexed: rows.length,
    pages_with_body: texts.filter(Boolean).length,
    truncated: rows.length >= MAX_PAGES,
    built_at: new Date().toISOString(),
  };
}

export async function getContentIndex({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inFlight) return inFlight;
  inFlight = build()
    .then((value) => { cache = { at: Date.now(), value }; return value; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** A short excerpt around the first match, for the results list. */
export function snippet(text, term, radius = 90) {
  if (!text || !term) return null;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i === -1) return null;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + term.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}
