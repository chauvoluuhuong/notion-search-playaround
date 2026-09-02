import assert from 'node:assert/strict';
import { listResources } from '../src/resources.js';
import { getResourceContent, resolveResourceId } from '../src/page_content.js';

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok  ' + name);
};

console.log('Running Resources & Full Page Content tests:\n');

const allRes = await listResources();

await t('lists all resources with id, type, title, and metadata', async () => {
  assert.ok(Array.isArray(allRes.resources), 'resources should be an array');
  assert.ok(allRes.count >= 1, 'should find at least 1 resource');
  assert.equal(allRes.count, allRes.pages_count + allRes.databases_count);

  for (const r of allRes.resources) {
    assert.ok(r.id, 'resource must have id');
    assert.ok(r.type === 'page' || r.type === 'database', 'type must be page or database');
    assert.ok(typeof r.title === 'string', 'title must be string');
    assert.ok(r.url, 'resource must have url');
    assert.ok(typeof r.is_inline === 'boolean', 'is_inline must be boolean');
  }
});

await t('filters resources by type: page', async () => {
  const pagesOnly = await listResources({ type: 'page' });
  assert.ok(Array.isArray(pagesOnly.resources));
  assert.equal(pagesOnly.databases_count, 0);
  for (const r of pagesOnly.resources) {
    assert.equal(r.type, 'page');
  }
});

await t('filters resources by type: database', async () => {
  const dbsOnly = await listResources({ type: 'database' });
  assert.ok(Array.isArray(dbsOnly.resources));
  assert.equal(dbsOnly.pages_count, 0);
  for (const r of dbsOnly.resources) {
    assert.equal(r.type, 'database');
  }
});

await t('resolves resource ID from full URL, dashed UUID, or raw 32 hex', async () => {
  const first = allRes.resources[0];
  const byDashed = await resolveResourceId(first.id);
  assert.equal(byDashed, first.id);

  const rawHex = first.id.replace(/-/g, '');
  const byRaw = await resolveResourceId(rawHex);
  assert.equal(byRaw, first.id);

  const testUrl = `https://www.notion.so/myworkspace/Sample-Title-${rawHex}`;
  const byUrl = await resolveResourceId(testUrl);
  assert.equal(byUrl, first.id);
});

// Test pulling full content for a page
const firstPage = allRes.resources.find((r) => r.type === 'page');
if (firstPage) {
  await t(`fetches full content for page "${firstPage.title}"`, async () => {
    const content = await getResourceContent(firstPage.id);
    assert.equal(content.id, firstPage.id);
    assert.equal(content.type, 'page');
    assert.ok(content.title);
    assert.ok(typeof content.markdown === 'string');
    assert.ok(content.markdown.startsWith('# '));
    assert.ok(Array.isArray(content.inline_databases));
    assert.ok(typeof content.blocks_count === 'number');
    assert.ok(typeof content.properties === 'object');
  });
}

// Test pulling full content for a database
const firstDb = allRes.resources.find((r) => r.type === 'database');
if (firstDb) {
  await t(`fetches full content/rows for database "${firstDb.title}"`, async () => {
    const content = await getResourceContent(firstDb.id);
    assert.equal(content.id, firstDb.id);
    assert.equal(content.type, 'database');
    assert.ok(content.title);
    assert.ok(typeof content.markdown === 'string');
    assert.ok(Array.isArray(content.columns));
    assert.ok(Array.isArray(content.rows));
    assert.equal(content.row_count, content.rows.length);
  });
}

console.log(`\nAll ${n} tests passed successfully!`);
