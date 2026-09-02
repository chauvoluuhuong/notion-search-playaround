import { searchAllResources, extractTitle, extractIcon, extractCover } from './notion.js';
import { dashedUuid } from './databases.js';

const TTL_MS = 5 * 60 * 1000;
let cache = null;

function shapeResource(item) {
  const isDb = item.object === 'database';
  const id = dashedUuid(item.id);
  const title = extractTitle(item).trim() || (isDb ? 'Untitled Database' : 'Untitled Page');
  const icon = extractIcon(item.icon);
  const cover = extractCover(item.cover);
  const parent = item.parent || null;
  const isInline = isDb ? Boolean(item.is_inline || parent?.type === 'page_id' || parent?.type === 'block_id') : false;

  const shaped = {
    id,
    type: item.object, // 'page' or 'database'
    title,
    icon,
    cover,
    url: item.url || `https://app.notion.com/${id.replace(/-/g, '')}`,
    parent,
    is_inline: isInline,
    archived: Boolean(item.archived),
    created_time: item.created_time || null,
    last_edited_time: item.last_edited_time || null,
    properties_count: Object.keys(item.properties || {}).length,
  };

  if (isDb) {
    shaped.property_names = Object.keys(item.properties || {});
  }

  return shaped;
}

/**
 * List all resources (pages and databases) in the workspace.
 * Optional filters: type ('page' | 'database'), query (string).
 */
export async function listResources({ type, query, refresh = false } = {}) {
  const normType = type ? String(type).trim().toLowerCase() : null;

  // Use full cache if no specific query is given
  if (!refresh && !query && cache && Date.now() - cache.at < TTL_MS) {
    let items = cache.value;
    if (normType) {
      items = items.filter((r) => r.type === normType);
    }
    return buildSummary(items);
  }

  let filter;
  if (normType === 'page' || normType === 'database') {
    filter = { value: normType, property: 'object' };
  }

  const raw = await searchAllResources({ query, filter });
  const resources = raw.map(shapeResource);

  // If this was an unfiltered fetch, update the cache
  if (!query && !normType) {
    cache = { at: Date.now(), value: resources };
  }

  return buildSummary(resources);
}

function buildSummary(resources) {
  const pagesCount = resources.filter((r) => r.type === 'page').length;
  const databasesCount = resources.filter((r) => r.type === 'database').length;

  return {
    resources,
    count: resources.length,
    pages_count: pagesCount,
    databases_count: databasesCount,
  };
}
