import express from 'express';
import path from 'node:path';
import { PORT } from './src/config.js';
import { search } from './src/search.js';
import { filterInstructions } from './src/filters.js';
import { getDirectory } from './src/directory.js';
import { NotionError } from './src/notion.js';

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  const status = err instanceof NotionError ? err.status : 500;
  console.error(err);
  res.status(status).json({ error: err.message, code: err.code ?? 'internal_error' });
});

/** Filter capability document: what can be filtered and with which values. */
app.get('/api/filters', wrap(async (req, res) => {
  res.json(await filterInstructions({ refresh: req.query.refresh === '1' }));
}));
app.get('/api/filter-instructions', (req, res) => res.redirect(307, '/api/filters'));

/** Just the value lists, for populating dropdowns. */
app.get('/api/options', wrap(async (req, res) => {
  const dir = await getDirectory({ refresh: req.query.refresh === '1' });
  res.json({
    assignees: dir.assignees.map(({ id, label, email, count }) => ({ id, label, email, count })),
    sprints: dir.sprints.map(({ id, label, status, count }) => ({ id, label, status, count })),
    statuses: dir.statuses,
    priorities: dir.priorities,
  });
}));

app.get('/api/search', wrap(async (req, res) => res.json(await search(req.query))));
app.post('/api/search', wrap(async (req, res) => res.json(await search(req.body || {}))));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`notion-search  →  http://localhost:${PORT}`);
  console.log(`  form          http://localhost:${PORT}/`);
  console.log(`  search API    http://localhost:${PORT}/api/search?q=supplier`);
  console.log(`  filter API    http://localhost:${PORT}/api/filters`);
});
