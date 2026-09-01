import { DEFAULT_DATABASE_ID } from './config.js';
import { plainText, searchAllDatabases } from './notion.js';

const TTL_MS = 5 * 60 * 1000;
let cache = null;

function shapeDatabase(db) {
  const title = plainText(db.title).trim() || 'Untitled Database';
  const description = plainText(db.description).trim() || null;
  const properties = db.properties || {};
  const propertyNames = Object.keys(properties);
  const propertyTypes = Object.fromEntries(
    propertyNames.map((name) => [name, properties[name]?.type || 'unknown']),
  );

  let icon = null;
  if (db.icon?.type === 'emoji') {
    icon = { type: 'emoji', emoji: db.icon.emoji };
  } else if (db.icon?.type === 'external' || db.icon?.type === 'file') {
    icon = { type: db.icon.type, url: db.icon.external?.url || db.icon.file?.url };
  }

  let cover = null;
  if (db.cover?.type === 'external' || db.cover?.type === 'file') {
    cover = db.cover.external?.url || db.cover.file?.url;
  }

  return {
    id: db.id,
    title,
    icon,
    cover,
    description,
    url: db.url || `https://app.notion.com/${db.id.replace(/-/g, '')}`,
    created_time: db.created_time || null,
    last_edited_time: db.last_edited_time || null,
    properties_count: propertyNames.length,
    property_names: propertyNames,
    property_types: propertyTypes,
  };
}

export async function listDatabases({ refresh = false } = {}) {
  if (!refresh && cache && Date.now() - cache.at < TTL_MS) {
    return cache.value;
  }
  const rawDatabases = await searchAllDatabases();
  const databases = rawDatabases.map(shapeDatabase);
  cache = { at: Date.now(), value: databases };
  return databases;
}

export const isUuid = (s) =>
  /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(s || '').trim());

export const dashedUuid = (s) => {
  const h = String(s || '').trim().replace(/-/g, '');
  if (h.length !== 32) return s;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/**
 * Resolve a database ID from a user input (uuid, title, or undefined).
 * Falls back to DEFAULT_DATABASE_ID or the first discovered database.
 */
export async function resolveDatabaseId(input, { refresh = false } = {}) {
  const dbs = await listDatabases({ refresh });
  if (dbs.length === 0) {
    throw new Error(
      'No Notion databases found. Make sure your Notion integration is invited/shared with at least one database.',
    );
  }

  const term = String(input || '').trim();
  if (term) {
    const formatted = dashedUuid(term).toLowerCase();
    const byId = dbs.find((d) => d.id.toLowerCase() === formatted || d.id.replace(/-/g, '').toLowerCase() === term.replace(/-/g, '').toLowerCase());
    if (byId) return byId.id;

    const termLower = term.toLowerCase();
    const byTitle = dbs.find((d) => d.title.toLowerCase() === termLower || d.title.toLowerCase().includes(termLower));
    if (byTitle) return byTitle.id;

    if (isUuid(term)) return dashedUuid(term);
  }

  if (DEFAULT_DATABASE_ID) {
    const defId = dashedUuid(DEFAULT_DATABASE_ID).toLowerCase();
    const byDefault = dbs.find((d) => d.id.toLowerCase() === defId || d.id.replace(/-/g, '').toLowerCase() === defId.replace(/-/g, ''));
    if (byDefault) return byDefault.id;
  }

  return dbs[0].id;
}
