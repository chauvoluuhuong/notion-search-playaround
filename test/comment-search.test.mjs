// Exercises comment matching against a synthetic index, so the behaviour is
// verifiable even while the workspace has no comments in it.
import assert from 'node:assert/strict';
import { primeIndex } from '../src/content.js';
import { search } from '../src/search.js';
import { getDirectory } from '../src/directory.js';

const dir = await getDirectory();
const lucas = dir.assignees.find((a) => a.name) ?? dir.assignees[0];

// Pull two real pages so the Notion-side query still returns them.
const { results } = await search({ page_size: 2 });
const [a, b] = results;
assert.ok(a && b, 'need at least two rows in the database');

primeIndex({
  textById: new Map([[a.id, 'body of page A'], [b.id, 'body of page B']]),
  commentsById: new Map([
    [a.id, [
      { id: 'c1', text: 'Blocked on the payment gateway sandbox credentials',
        author_id: lucas.id, created_time: '2026-08-01T10:00:00.000Z',
        discussion_id: 'd1', inline: false },
      { id: 'c2', text: 'Retested after the fix, looks good now',
        author_id: lucas.id, created_time: '2026-08-02T10:00:00.000Z',
        discussion_id: 'd1', inline: false },
    ]],
    [b.id, [
      { id: 'c3', text: 'Needs a design review before we ship',
        author_id: null, created_time: '2026-08-03T10:00:00.000Z',
        discussion_id: 'd2', inline: true },
    ]],
  ]),
  pages_indexed: 2, pages_with_body: 2, pages_with_comments: 2,
  comments_indexed: 3, inline_comments_indexed: true,
  truncated: false, built_at: new Date().toISOString(),
});

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

await t('matches a word inside a comment', async () => {
  const r = await search({ q: 'sandbox credentials', fields: 'comment' });
  assert.equal(r.total, 1);
  assert.equal(r.results[0].id, a.id);
  assert.deepEqual(r.results[0].matched_fields, ['comment']);
});

await t('returns only the matching thread, with an excerpt and author', async () => {
  const r = await search({ q: 'sandbox', fields: 'comment' });
  const row = r.results[0];
  assert.equal(row.comments.length, 1, 'non-matching comments are excluded');
  assert.equal(row.comment_count, 2, 'but the full count is still reported');
  assert.match(row.comments[0].excerpt, /sandbox/i);
  assert.equal(row.comments[0].author, lucas.label);
});

await t('is case-insensitive', async () => {
  const r = await search({ q: 'BLOCKED ON THE PAYMENT', fields: 'comment' });
  assert.equal(r.total, 1);
});

await t('matches inline comments too', async () => {
  const r = await search({ q: 'design review', fields: 'comment' });
  assert.equal(r.total, 1);
  assert.equal(r.results[0].id, b.id);
  assert.equal(r.results[0].comments[0].inline, true);
});

await t('does not match when the comment field is disabled', async () => {
  const r = await search({ q: 'sandbox credentials', fields: 'summary,description' });
  assert.equal(r.total, 0);
});

await t('comment text does not leak into results when q is empty', async () => {
  const r = await search({ page_size: 2 });
  assert.deepEqual(r.results[0].comments, []);
});

await t('reports index stats in text_matching.comment', async () => {
  const r = await search({ q: 'sandbox', fields: 'comment' });
  const c = r.text_matching.comment;
  assert.equal(c.matched_in_process, true);
  assert.equal(c.comments_indexed, 3);
  assert.match(c.caveat, /unresolved/i);
});

await t('a term in body but not comments does not match the comment field', async () => {
  const r = await search({ q: 'body of page A', fields: 'comment' });
  assert.equal(r.total, 0);
});

console.log(`\n${n} passed`);
