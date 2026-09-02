import { INDEX_INLINE_COMMENTS } from './config.js';
import { getBlockChildren, getComments, queryDatabase } from './notion.js';
import { dashedUuid } from './databases.js';

const TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 8;
const MAX_PAGES = 1000;

const contentCaches = new Map();
const inFlightMap = new Map();

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
 * Notion's comments endpoint returns only UNRESOLVED comments.
 */
async function pageComments(pageId, blockIds, state = {}) {
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
    } catch (err) {
      if (err.status === 403 || (err.message && err.message.toLowerCase().includes('permission'))) {
        state.permission_denied = true;
      }
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
 * Index page body text and comments for a given database.
 */
async function buildContent(databaseId) {
  const rows = [];
  let cursor;
  while (rows.length < MAX_PAGES) {
    try {
      const page = await queryDatabase(databaseId, { page_size: 100, start_cursor: cursor });
      rows.push(...(page.results || []));
      if (!page.has_more) break;
      cursor = page.next_cursor;
    } catch {
      break;
    }
  }

  const state = { permission_denied: false };
  const built = await pool(rows, async (p) => {
    const body = await pageBody(p.id);
    const comments = await pageComments(p.id, body.blockIds, state);
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
    comments_permission_denied: state.permission_denied,
    inline_comments_indexed: INDEX_INLINE_COMMENTS,
    truncated: rows.length >= MAX_PAGES,
    built_at: new Date().toISOString(),
  };
}

let defaultSyntheticIndex = null;

/**
 * Seed synthetic index. If databaseId is passed as an object, it sets defaultSyntheticIndex for test compatibility.
 */
export function primeIndex(databaseIdOrValue, maybeValue) {
  if (typeof databaseIdOrValue === 'object' && databaseIdOrValue !== null && !maybeValue) {
    defaultSyntheticIndex = databaseIdOrValue;
    return defaultSyntheticIndex;
  }
  const normId = dashedUuid(databaseIdOrValue).toLowerCase();
  contentCaches.set(normId, { at: Date.now(), value: maybeValue });
  return maybeValue;
}

export async function getContentIndex(databaseId, { refresh = false } = {}) {
  if (defaultSyntheticIndex) {
    return defaultSyntheticIndex;
  }
  if (!databaseId) {
    const { resolveDatabaseId } = await import('./databases.js');
    databaseId = await resolveDatabaseId();
  }
  const normId = dashedUuid(databaseId).toLowerCase();

  const cached = contentCaches.get(normId);
  if (!refresh && cached && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  if (inFlightMap.has(normId)) {
    return inFlightMap.get(normId);
  }

  const promise = buildContent(normId)
    .then((value) => {
      contentCaches.set(normId, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      inFlightMap.delete(normId);
    });

  inFlightMap.set(normId, promise);
  return promise;
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
