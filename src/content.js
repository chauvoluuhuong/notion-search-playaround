import { DATABASE_ID, INDEX_INLINE_COMMENTS } from './config.js';
import { getBlockChildren, getComments, queryDatabase } from './notion.js';

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

/** Body text plus the ids of every block, which inline comments hang off. */
async function pageBody(pageId) {
  const parts = [];
  const blockIds = [];
  let cursor;
  try {
    do {
      const res = await getBlockChildren(pageId, cursor);
      for (const b of res.results) {
        blockIds.push(b.id);
        const t = blockText(b).trim();
        if (t) parts.push(t);
        // One level of nesting (toggles, list children, callouts) is enough here.
        if (b.has_children) {
          try {
            const kids = await getBlockChildren(b.id);
            for (const k of kids.results) {
              blockIds.push(k.id);
              const kt = blockText(k).trim();
              if (kt) parts.push(kt);
            }
          } catch { /* unreadable child block */ }
        }
      }
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
  } catch {
    return { text: '', blockIds: [] }; // page body not shared with the integration
  }
  return { text: parts.join('\n'), blockIds };
}

/**
 * Comment threads on a page.
 *
 * Notion's comments endpoint returns only UNRESOLVED comments — once a thread
 * is resolved in the UI it disappears from the API, so it cannot be indexed.
 * Page-level comments are always fetched; inline (block-level) ones cost one
 * request per block, so they are behind INDEX_INLINE_COMMENTS.
 */
async function pageComments(pageId, blockIds) {
  const targets = [pageId, ...(INDEX_INLINE_COMMENTS ? blockIds : [])];
  const out = [];
  const seen = new Set();

  for (const target of targets) {
    let cursor;
    try {
      do {
        const res = await getComments(target, cursor);
        for (const c of res.results) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const text = (c.rich_text || []).map((t) => t.plain_text ?? '').join('').trim();
          if (!text) continue;
          out.push({
            id: c.id,
            text,
            author_id: c.created_by?.id ?? null,
            created_time: c.created_time ?? null,
            discussion_id: c.discussion_id ?? null,
            inline: target !== pageId,
          });
        }
        cursor = res.has_more ? res.next_cursor : undefined;
      } while (cursor);
    } catch {
      // No "read comments" capability, or the target is not readable.
    }
  }
  out.sort((a, b) => String(a.created_time).localeCompare(String(b.created_time)));
  return out;
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

  const built = await pool(rows, async (p) => {
    const body = await pageBody(p.id);
    const comments = await pageComments(p.id, body.blockIds);
    return { text: body.text, comments };
  });

  const textById = new Map();
  const commentsById = new Map();
  rows.forEach((p, i) => {
    textById.set(p.id, built[i].text);
    commentsById.set(p.id, built[i].comments);
  });

  const commentTotal = built.reduce((n, b) => n + b.comments.length, 0);

  return {
    textById,
    commentsById,
    pages_indexed: rows.length,
    pages_with_body: built.filter((b) => b.text).length,
    pages_with_comments: built.filter((b) => b.comments.length).length,
    comments_indexed: commentTotal,
    inline_comments_indexed: INDEX_INLINE_COMMENTS,
    truncated: rows.length >= MAX_PAGES,
    built_at: new Date().toISOString(),
  };
}

/**
 * Seed the cache directly. Used to warm the index at boot, and by tests to
 * exercise matching without depending on live workspace content.
 */
export function primeIndex(value) {
  cache = { at: Date.now(), value };
  return value;
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
