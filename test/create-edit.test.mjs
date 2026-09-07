import assert from 'node:assert/strict';
import {
  markdownToRichText,
  markdownToBlocks,
  formatIcon,
  formatCover,
  buildPageProperties,
  getPageComments,
  createPageComment,
} from '../src/mutation.js';

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok  ' + name);
};

console.log('Running Mutation & Schema Transformation tests:\n');

await t('converts inline markdown to rich_text objects', () => {
  const rt = markdownToRichText('Hello **bold** and *italic* and `code` and [a link](https://example.com)');
  assert.ok(Array.isArray(rt));
  assert.equal(rt[0].text.content, 'Hello ');
  assert.equal(rt[1].text.content, 'bold');
  assert.equal(rt[1].annotations?.bold, true);
  assert.equal(rt[3].text.content, 'italic');
  assert.equal(rt[3].annotations?.italic, true);
  assert.equal(rt[5].text.content, 'code');
  assert.equal(rt[5].annotations?.code, true);
  assert.equal(rt[7].text.content, 'a link');
  assert.equal(rt[7].text.link?.url, 'https://example.com');
});

await t('converts markdown headings, lists, code, and to-do items into Notion blocks', () => {
  const md = `# Title
## Subtitle
### Section
- Bullet 1
- Bullet 2
1. Numbered item
- [ ] Task incomplete
- [x] Task complete
> Important quote
---
\`\`\`javascript
const a = 1;
\`\`\`
Regular paragraph text`;

  const blocks = markdownToBlocks(md);
  assert.ok(Array.isArray(blocks));
  assert.equal(blocks[0].type, 'heading_1');
  assert.equal(blocks[0].heading_1.rich_text[0].text.content, 'Title');

  assert.equal(blocks[1].type, 'heading_2');
  assert.equal(blocks[2].type, 'heading_3');

  assert.equal(blocks[3].type, 'bulleted_list_item');
  assert.equal(blocks[4].type, 'bulleted_list_item');

  assert.equal(blocks[5].type, 'numbered_list_item');

  assert.equal(blocks[6].type, 'to_do');
  assert.equal(blocks[6].to_do.checked, false);
  assert.equal(blocks[7].type, 'to_do');
  assert.equal(blocks[7].to_do.checked, true);

  assert.equal(blocks[8].type, 'quote');
  assert.equal(blocks[9].type, 'divider');

  assert.equal(blocks[10].type, 'code');
  assert.equal(blocks[10].code.language, 'javascript');
  assert.equal(blocks[10].code.rich_text[0].text.content, 'const a = 1;');

  assert.equal(blocks[11].type, 'paragraph');
  assert.equal(blocks[11].paragraph.rich_text[0].text.content, 'Regular paragraph text');
});

await t('formats icon and cover values', () => {
  assert.deepEqual(formatIcon('🚀'), { type: 'emoji', emoji: '🚀' });
  assert.deepEqual(formatIcon('https://example.com/icon.png'), {
    type: 'external',
    external: { url: 'https://example.com/icon.png' },
  });
  assert.equal(formatIcon(null), null);

  assert.deepEqual(formatCover('https://example.com/cover.jpg'), {
    type: 'external',
    external: { url: 'https://example.com/cover.jpg' },
  });
  assert.equal(formatCover(null), null);
});

await t('transforms intuitive properties using schema definitions', () => {
  const schemaProps = [
    { name: 'Story', type: 'title' },
    { name: 'Status', type: 'status' },
    { name: 'Priority', type: 'select' },
    { name: 'Tags', type: 'multi_select' },
    { name: 'Estimate', type: 'number' },
    { name: 'Due', type: 'date' },
    { name: 'Assignee', type: 'people' },
    { name: 'Sprint', type: 'relation' },
    { name: 'Done', type: 'checkbox' },
    { name: 'Formula Prop', type: 'formula' }, // read-only
    { name: 'Created Time', type: 'created_time' }, // read-only
  ];

  const schemaLookup = {
    people_by_property: {
      Assignee: [
        { id: '11111111-2222-3333-4444-555555555555', name: 'Huong Chau' },
      ],
    },
    relations_by_property: {
      Sprint: [
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Sprint 1' },
      ],
    },
  };

  const input = {
    story: 'Write integration tests', // case-insensitive match
    status: 'In progress',
    priority: 'High',
    tags: ['Backend', 'Testing'],
    estimate: '8',
    due: '2026-09-15',
    assignee: 'Huong Chau',
    sprint: 'Sprint 1',
    done: true,
    'formula prop': 'ignore me',
    'created time': 'ignore me',
  };

  const result = buildPageProperties(input, schemaProps, schemaLookup);

  // Title
  assert.deepEqual(result.Story, {
    title: [{ type: 'text', text: { content: 'Write integration tests' } }],
  });

  // Status
  assert.deepEqual(result.Status, { status: { name: 'In progress' } });

  // Select
  assert.deepEqual(result.Priority, { select: { name: 'High' } });

  // Multi-select
  assert.deepEqual(result.Tags, {
    multi_select: [{ name: 'Backend' }, { name: 'Testing' }],
  });

  // Number
  assert.deepEqual(result.Estimate, { number: 8 });

  // Date
  assert.deepEqual(result.Due, { date: { start: '2026-09-15' } });

  // People (resolved via lookup)
  assert.deepEqual(result.Assignee, {
    people: [{ id: '11111111-2222-3333-4444-555555555555' }],
  });

  // Relation (resolved via lookup)
  assert.deepEqual(result.Sprint, {
    relation: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
  });

  // Checkbox
  assert.deepEqual(result.Done, { checkbox: true });

  // Read-only omitted
  assert.equal(result['Formula Prop'], undefined);
  assert.equal(result['Created Time'], undefined);
});

await t('passes raw Notion property objects through untouched', () => {
  const rawInput = {
    Story: {
      title: [{ type: 'text', text: { content: 'Raw title' } }],
    },
    CustomStatus: {
      status: { id: 'status-id-123' },
    },
  };

  const schemaProps = [
    { name: 'Story', type: 'title' },
    { name: 'CustomStatus', type: 'status' },
  ];

  const result = buildPageProperties(rawInput, schemaProps);
  assert.deepEqual(result.Story, rawInput.Story);
  assert.deepEqual(result.CustomStatus, rawInput.CustomStatus);
});

await t('validates comment creation arguments', async () => {
  await assert.rejects(
    async () => {
      await createPageComment('page-id', { text: '' });
    },
    { message: 'Comment text cannot be empty' },
  );

  await assert.rejects(
    async () => {
      await createPageComment(null, { text: 'Hello' });
    },
    { message: /pageId is required/ },
  );
});

await t('formats rich text formatting for comments correctly', () => {
  const commentRichText = markdownToRichText('Testing **bold** and `code` with [link](https://notion.so)');
  assert.equal(commentRichText.length, 6);
  assert.equal(commentRichText[1].text.content, 'bold');
  assert.equal(commentRichText[1].annotations?.bold, true);
  assert.equal(commentRichText[3].text.content, 'code');
  assert.equal(commentRichText[3].annotations?.code, true);
  assert.equal(commentRichText[5].text.content, 'link');
  assert.equal(commentRichText[5].text.link?.url, 'https://notion.so');
});

await t('constructs correct Notion comment payload for page comments and thread replies', async () => {
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;
  let capturedUrl = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = String(url);
    capturedPayload = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        object: 'comment',
        id: 'comment-123',
        parent: capturedPayload.parent,
        discussion_id: capturedPayload.discussion_id || 'disc-999',
        created_time: '2026-09-07T00:00:00.000Z',
        created_by: { id: 'user-1', name: 'Huong', type: 'person' },
        rich_text: capturedPayload.rich_text,
      }),
    };
  };

  try {
    // 1. Page comment
    const res1 = await createPageComment('11111111-2222-3333-4444-555555555555', {
      text: 'Great work team! **Approved**',
    });
    assert.equal(capturedUrl, 'https://api.notion.com/v1/comments');
    assert.deepEqual(capturedPayload.parent, {
      type: 'page_id',
      page_id: '11111111-2222-3333-4444-555555555555',
    });
    assert.equal(capturedPayload.rich_text[0].text.content, 'Great work team! ');
    assert.equal(capturedPayload.rich_text[1].text.content, 'Approved');
    assert.equal(capturedPayload.rich_text[1].annotations?.bold, true);
    assert.equal(res1.author, 'Huong');
    assert.equal(res1.text, 'Great work team! Approved');

    // 2. Thread reply
    const res2 = await createPageComment(null, {
      discussionId: 'disc-999',
      text: 'Replying to existing thread',
    });
    assert.equal(capturedPayload.parent, undefined);
    assert.equal(capturedPayload.discussion_id, 'disc-999');
    assert.equal(res2.discussion_id, 'disc-999');
    assert.equal(res2.text, 'Replying to existing thread');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await t('fetches and maps page comments with chronological ordering', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        object: 'list',
        results: [
          {
            id: 'c2',
            parent: { type: 'page_id', page_id: '11111111-2222-3333-4444-555555555555' },
            discussion_id: 'd1',
            created_time: '2026-09-02T10:00:00.000Z',
            created_by: { id: 'u2', name: 'Alice', type: 'person' },
            rich_text: [{ type: 'text', text: { content: 'Second comment' } }],
          },
          {
            id: 'c1',
            parent: { type: 'page_id', page_id: '11111111-2222-3333-4444-555555555555' },
            discussion_id: 'd1',
            created_time: '2026-09-01T10:00:00.000Z',
            created_by: { id: 'u1', name: 'Bob', type: 'person' },
            rich_text: [{ type: 'text', text: { content: 'First comment' } }],
          },
        ],
        has_more: false,
      }),
    };
  };

  try {
    const res = await getPageComments('11111111-2222-3333-4444-555555555555');
    assert.equal(res.count, 2);
    // Chronological sort: c1 (Sept 1) comes before c2 (Sept 2)
    assert.equal(res.comments[0].id, 'c1');
    assert.equal(res.comments[0].author, 'Bob');
    assert.equal(res.comments[0].text, 'First comment');
    assert.equal(res.comments[1].id, 'c2');
    assert.equal(res.comments[1].author, 'Alice');
    assert.equal(res.comments[1].text, 'Second comment');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\nAll ${n} mutation tests passed successfully!\n`);
