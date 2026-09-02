import express from 'express';
import path from 'node:path';
import { PORT } from './src/config.js';
import { listDatabases, resolveDatabaseId } from './src/databases.js';
import { listResources } from './src/resources.js';
import { getResourceContent } from './src/page_content.js';
import { getDatabaseSchema } from './src/directory.js';
import { filterInstructions } from './src/filters.js';
import { search } from './src/search.js';
import { NotionError } from './src/notion.js';

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const status = err instanceof NotionError ? err.status : 500;
    console.error(err);
    res.status(status).json({ error: err.message, code: err.code ?? 'internal_error' });
  });

/** Discover and list all Notion resources (pages and databases) in the workspace. */
app.get('/api/resources', wrap(async (req, res) => {
  res.json(await listResources({
    type: req.query.type,
    query: req.query.q || req.query.query,
  }));
}));

/** Discover and list all Notion databases in the workspace. */
app.get('/api/databases', wrap(async (req, res) => {
  const databases = await listDatabases({ refresh: req.query.refresh === '1' });
  res.json({ databases, count: databases.length });
}));

/** Full schema & filter instructions for a specific database. */
app.get('/api/databases/:id', wrap(async (req, res) => {
  const databaseId = req.params.id;
  const instructions = await filterInstructions({
    databaseId,
    refresh: req.query.refresh === '1',
  });
  res.json(instructions);
}));

/** Filter capability document: what can be filtered and with which values. */
app.get('/api/filters', wrap(async (req, res) => {
  const databaseId = req.query.database_id || req.query.database;
  res.json(await filterInstructions({ databaseId, refresh: req.query.refresh === '1' }));
}));
app.get('/api/filters/:id', wrap(async (req, res) => {
  const databaseId = req.params.id;
  res.json(await filterInstructions({ databaseId, refresh: req.query.refresh === '1' }));
}));

/** Filter instructions endpoint: returns dynamic filter capability document by database ID or default. */
app.get('/api/filter-instructions', wrap(async (req, res) => {
  const databaseId = req.query.database_id || req.query.database;
  res.json(await filterInstructions({ databaseId, refresh: req.query.refresh === '1' }));
}));
app.get('/api/filter-instructions/:id', wrap(async (req, res) => {
  const databaseId = req.params.id;
  res.json(await filterInstructions({ databaseId, refresh: req.query.refresh === '1' }));
}));

/** Value lists & options for populating dynamic dropdowns. */
app.get('/api/options', wrap(async (req, res) => {
  const databaseId = await resolveDatabaseId(req.query.database_id || req.query.database, {
    refresh: req.query.refresh === '1',
  });
  const schema = await getDatabaseSchema(databaseId, { refresh: req.query.refresh === '1' });

  res.json({
    database: schema.database,
    properties: schema.properties,
    options_by_property: schema.options_by_property,
    people_by_property: schema.people_by_property,
    relations_by_property: schema.relations_by_property,
  });
}));

/** Full content of a page or database, including nested blocks and inline databases. */
const handleContent = wrap(async (req, res) => {
  res.json(await getResourceContent(req.params.id || req.query.id));
});

app.get('/api/resources/:id/content', handleContent);
app.get('/api/pages/:id/content', handleContent);
app.get('/api/pages/:id', handleContent);

app.post('/api/search', wrap(async (req, res) => res.json(await search(req.body || {}))));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`notion-search  →  http://localhost:${PORT}`);
  console.log(`  UI               http://localhost:${PORT}/`);
  console.log(`  resources API    http://localhost:${PORT}/api/resources`);
  console.log(`  page content API http://localhost:${PORT}/api/pages/:id`);
  console.log(`  databases API    http://localhost:${PORT}/api/databases`);
  console.log(`  search API       http://localhost:${PORT}/api/search`);
  console.log(`  filter API       http://localhost:${PORT}/api/filters`);
  console.log(`  instructions API http://localhost:${PORT}/api/filter-instructions/:id`);
});
