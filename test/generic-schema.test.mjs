import assert from 'node:assert/strict';
import { listDatabases, resolveDatabaseId } from '../src/databases.js';
import { getDatabaseSchema, resolveValues } from '../src/directory.js';
import { filterInstructions } from '../src/filters.js';
import { buildQuery, search } from '../src/search.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

console.log('Running Generic Schema & Database Discovery tests:\n');

const databases = await listDatabases();

await t('discovers all shared databases in the workspace', async () => {
  assert.ok(Array.isArray(databases), 'databases should be an array');
  assert.ok(databases.length >= 1, 'should find at least 1 database');
  for (const db of databases) {
    assert.ok(db.id, 'database must have id');
    assert.ok(db.title, 'database must have title');
    assert.ok(Array.isArray(db.property_names), 'must list property names');
  }
});

await t('resolves database ID by title or ID', async () => {
  const first = databases[0];
  const byId = await resolveDatabaseId(first.id);
  assert.equal(byId, first.id);

  const byTitle = await resolveDatabaseId(first.title);
  assert.equal(byTitle, first.id);
});

for (const db of databases) {
  await t(`discovers schema and filter options for "${db.title}"`, async () => {
    const schema = await getDatabaseSchema(db.id);
    assert.equal(schema.database.id, db.id);
    assert.ok(Array.isArray(schema.properties));
    assert.ok(schema.properties.length > 0);
    assert.ok(typeof schema.options_by_property === 'object');
    assert.ok(typeof schema.people_by_property === 'object');
    assert.ok(typeof schema.relations_by_property === 'object');
  });

  await t(`generates filter instructions capability document for "${db.title}" by ID and title`, async () => {
    const docById = await filterInstructions({ databaseId: db.id });
    assert.equal(docById.database.id, db.id);
    assert.ok(docById.how_to_search);
    assert.ok(docById.filters && typeof docById.filters === 'object');
    assert.ok(Array.isArray(docById.examples));

    const docByTitle = await filterInstructions({ databaseId: db.title });
    assert.equal(docByTitle.database.id, db.id);
  });

  await t(`executes generic search on "${db.title}"`, async () => {
    const res = await search({ database_id: db.id, page_size: 5 });
    assert.ok(Array.isArray(res.results));
    assert.equal(res.database.id, db.id);
    assert.ok(typeof res.total === 'number');
    if (res.results.length > 0) {
      assert.ok(res.results[0].title);
      assert.ok(res.results[0].properties);
    }
  });
}

// Test User Stories specific relation filtering if IT User Stories exists
const storiesDb = databases.find((d) => d.title.toLowerCase().includes('user stories') || d.title.toLowerCase().includes('stories'));
if (storiesDb) {
  await t('resolves relation titles into Notion filter UUIDs', async () => {
    const schema = await getDatabaseSchema(storiesDb.id);
    const epicProp = schema.properties.find((p) => p.type === 'relation');
    if (epicProp && schema.relations_by_property[epicProp.name]?.length > 0) {
      const target = schema.relations_by_property[epicProp.name][0];
      const built = await buildQuery(storiesDb.id, { [epicProp.name]: target.label });
      assert.ok(!built.error);
      assert.ok(built.filter);
      assert.deepEqual(built.resolved[epicProp.name], [target.id]);
    }
  });
}

await t('resolves values helper with case-insensitive name matching', () => {
  const entries = [
    { id: '11111111-1111-1111-1111-111111111111', label: 'Alex Johnson', name: 'Alex Johnson', email: 'alex@test.com' },
    { id: '22222222-2222-2222-2222-222222222222', label: 'Bao Nguyen', name: 'Bao Nguyen', email: 'bao@test.com' },
  ];
  assert.deepEqual(resolveValues('alex', entries), ['11111111-1111-1111-1111-111111111111']);
  assert.deepEqual(resolveValues('bao@test.com', entries), ['22222222-2222-2222-2222-222222222222']);
  assert.deepEqual(resolveValues('22222222-2222-2222-2222-222222222222', entries), ['22222222-2222-2222-2222-222222222222']);
});

console.log(`\nAll ${n} tests passed successfully!`);
