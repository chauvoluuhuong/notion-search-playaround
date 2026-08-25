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
export const DATABASE_ID = process.env.NOTION_DATABASE_ID;
export const PORT = Number(process.env.PORT || 3000);

if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY missing (see .env.example)');
if (!DATABASE_ID) throw new Error('NOTION_DATABASE_ID missing (see .env.example)');

/**
 * Every field the free-text `q` can match against.
 *
 * `key`      – the name used in the API / UI
 * `property` – the real Notion property name in "🛠️ Engineering Issue Tracker"
 * `type`     – Notion property type, decides how the filter leaf is built
 * `default`  – searched when the caller does not pass an explicit `fields` list
 */
export const SEARCH_FIELDS = [
  { key: 'assignee',     property: 'Assignees',    type: 'people',    default: true,  label: 'Assignee' },
  { key: 'description',  property: 'Description',  type: 'rich_text', default: true,  label: 'Description' },
  { key: 'summary',      property: 'Summary',      type: 'rich_text', default: true,  label: 'Summary' },
  { key: 'sprint',       property: 'Sprint',       type: 'relation',  default: true,  label: 'Sprint' },
  // There is no "Command" property on this database. These are the remaining
  // free-text columns, included so nothing textual is missed by a search.
  { key: 'task_name',    property: 'Task Name',    type: 'title',     default: true,  label: 'Task Name' },
  { key: 'dependencies', property: 'Dependencies', type: 'rich_text', default: true,  label: 'Dependencies' },
  { key: 'story_id',     property: 'Story ID',     type: 'rich_text', default: true,  label: 'Story ID' },
  { key: 'source_team',  property: 'Source Team',  type: 'rich_text', default: false, label: 'Source Team' },
  { key: 'source_type',  property: 'Source Type',  type: 'rich_text', default: false, label: 'Source Type' },
  // Body text of the task page. Notion database filters cannot see this, so it
  // is indexed by src/content.js and matched in-process.
  { key: 'page_content', property: null,            type: 'page_content', default: true, label: 'Page Content' },
];

export const FIELD_BY_KEY = Object.fromEntries(SEARCH_FIELDS.map((f) => [f.key, f]));
export const DEFAULT_FIELD_KEYS = SEARCH_FIELDS.filter((f) => f.default).map((f) => f.key);

// Relation target databases, used to resolve relation page ids -> human labels.
export const SPRINT_DATABASE_ID = '641ea2c04eb383d799c281b99aad17c3';

export const ASSIGNEE_PROPERTY = 'Assignees';
export const SPRINT_PROPERTY = 'Sprint';
