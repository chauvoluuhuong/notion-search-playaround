import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader so the project stays dependency-light.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

export const NOTION_API_KEY = process.env.NOTION_API_KEY;
export const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';
export const DEFAULT_DATABASE_ID = process.env.NOTION_DATABASE_ID || null;
export const PORT = Number(process.env.PORT || 3100);

if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY missing (see .env.example)');

// Inline (block-level) comments are indexed by default along with page-level comments.
export const INDEX_INLINE_COMMENTS = process.env.INDEX_INLINE_COMMENTS !== '0';

