import assert from 'node:assert/strict';
import {
  buildDatabaseZodSchema,
  generateObjectSchema,
  getInstructions,
} from '../src/instructions.js';
import {
  filterInstructions,
  instructions,
} from '../src/filters.js';

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok  ' + name);
};

console.log('Running Instructions & Schema Generation tests:\n');

const mockSchema = {
  database: {
    id: 'db-11111111-2222-3333-4444-555555555555',
    title: 'Project Roadmap',
  },
  title_property: 'Task Name',
  properties: [
    { name: 'Task Name', type: 'title' },
    { name: 'Status', type: 'status', options: [{ name: 'Not started' }, { name: 'In progress' }, { name: 'Done' }] },
    { name: 'Priority', type: 'select', options: [{ name: 'High' }, { name: 'Medium' }, { name: 'Low' }] },
    { name: 'Tags', type: 'multi_select', options: [{ name: 'Frontend' }, { name: 'Backend' }, { name: 'DevOps' }] },
    { name: 'Estimate', type: 'number' },
    { name: 'Completed', type: 'checkbox' },
    { name: 'Due Date', type: 'date' },
    { name: 'Doc URL', type: 'url' },
    { name: 'Contact Email', type: 'email' },
    { name: 'Notes', type: 'rich_text' },
    { name: 'Assignee', type: 'people', users: [{ name: 'Alice Smith' }, { name: 'Bob Jones' }] },
    { name: 'Milestone', type: 'relation', targets: [{ title: 'Q3 Release' }, { title: 'Q4 Beta' }] },
    { name: 'Formula Progress', type: 'formula' },
    { name: 'Created Time', type: 'created_time' },
    { name: 'Created By', type: 'created_by' },
  ],
};

await t('buildDatabaseZodSchema creates a valid Zod object schema with field descriptions', () => {
  const zodSchema = buildDatabaseZodSchema(mockSchema);
  assert.ok(zodSchema);
  assert.equal(typeof zodSchema.parse, 'function');

  // Validate parsing conforming data
  const validData = {
    'Task Name': 'Deploy v2',
    Status: 'In progress',
    Priority: 'High',
    Tags: ['Backend', 'DevOps'],
    Estimate: 5,
    Completed: false,
    'Due Date': '2026-09-30',
    'Doc URL': 'https://notion.so/docs',
    'Contact Email': 'dev@example.com',
    Notes: 'Ready for QA',
    Assignee: 'Alice Smith',
    Milestone: 'Q3 Release',
  };

  const parsed = zodSchema.parse(validData);
  assert.equal(parsed['Task Name'], 'Deploy v2');
  assert.equal(parsed.Estimate, 5);

  // Validate error when required title is missing or wrong type
  assert.throws(() => {
    zodSchema.parse({
      'Task Name': 12345, // invalid type
    });
  });
});

await t('generateObjectSchema transforms Zod schema to clean JSON Schema via zod-to-json-schema', () => {
  const jsonSchema = generateObjectSchema(mockSchema);
  assert.ok(jsonSchema);
  assert.equal(jsonSchema.type, 'object');
  assert.ok(jsonSchema.properties);

  // Check title
  const titleProp = jsonSchema.properties['Task Name'];
  assert.ok(titleProp);
  assert.equal(titleProp.type, 'string');
  assert.ok(titleProp.description.includes('Primary title'));

  // Check status & select enums
  const statusProp = jsonSchema.properties.Status;
  assert.deepEqual(statusProp.enum, ['Not started', 'In progress', 'Done']);

  const priorityProp = jsonSchema.properties.Priority;
  assert.deepEqual(priorityProp.enum, ['High', 'Medium', 'Low']);

  // Check read-only computed annotations
  const formulaProp = jsonSchema.properties['Formula Progress'];
  assert.equal(formulaProp.readOnly, true);
  assert.ok(formulaProp.description.includes('READ-ONLY'));

  const createdTimeProp = jsonSchema.properties['Created Time'];
  assert.equal(createdTimeProp.readOnly, true);
});

await t('getInstructions returns database info, clean object_schema, and action transformations', async () => {
  // Test with mock directory / database lookup
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const sUrl = String(url);
    if (sUrl.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: 'list',
          results: [
            {
              object: 'database',
              id: mockSchema.database.id,
              title: [{ plain_text: mockSchema.database.title }],
              properties: {
                'Task Name': { id: 'title', type: 'title', title: {} },
                Status: { id: 'status', type: 'status', status: { options: mockSchema.properties[1].options } },
                Priority: { id: 'priority', type: 'select', select: { options: mockSchema.properties[2].options } },
              },
            },
          ],
          has_more: false,
        }),
      };
    }
    if (sUrl.includes('/users')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: 'list',
          results: [],
          has_more: false,
        }),
      };
    }
    if (sUrl.includes('/query')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          object: 'list',
          results: [],
          has_more: false,
        }),
      };
    }
    // Database endpoint
    return {
      ok: true,
      status: 200,
      json: async () => ({
        object: 'database',
        id: mockSchema.database.id,
        title: [{ plain_text: mockSchema.database.title }],
        properties: {
          'Task Name': { id: 'title', type: 'title', title: {} },
          Status: { id: 'status', type: 'status', status: { options: mockSchema.properties[1].options } },
          Priority: { id: 'priority', type: 'select', select: { options: mockSchema.properties[2].options } },
        },
      }),
    };
  };

  try {
    const doc = await getInstructions({ databaseId: mockSchema.database.id });
    assert.ok(doc);
    assert.equal(doc.database.id, mockSchema.database.id);
    assert.ok(doc.object_schema);
    assert.equal(doc.object_schema.type, 'object');

    // Actions structure
    assert.ok(doc.actions);
    assert.ok(doc.actions.create);
    assert.equal(doc.actions.create.method, 'POST');
    assert.equal(doc.actions.create.endpoint, '/api/pages');
    assert.equal(doc.actions.create.transformation, undefined);
    assert.equal(doc.actions.create.payload_structure.properties.$ref, '#/object_schema');
    assert.ok(doc.actions.create.payload_structure.properties.description.includes('Required: database.title_property'));

    assert.ok(doc.actions.edit);
    assert.equal(doc.actions.edit.method, 'PATCH');
    assert.equal(doc.actions.edit.transformation, undefined);
    assert.equal(doc.actions.edit.payload_structure.properties.$ref, '#/object_schema');
    assert.ok(doc.actions.edit.payload_structure.properties.description.includes('Partial<object_schema>'));

    assert.ok(doc.actions.filter);
    assert.equal(doc.actions.filter.method, 'POST');
    assert.equal(doc.actions.filter.endpoint, '/api/search');
    assert.equal(doc.actions.filter.transformation, undefined);
    assert.ok(doc.actions.filter.payload_structure.filter.description.includes('object_schema'));

    assert.ok(doc.actions.comment);
    assert.ok(doc.actions.comment.get_comments);
    assert.ok(doc.actions.comment.add_comment);

    assert.ok(doc.actions.archive);
    assert.equal(doc.actions.archive.method, 'DELETE');

    // Backward compatible aliases
    assert.equal(doc.how_to_create, doc.actions.create);
    assert.equal(doc.how_to_edit, doc.actions.edit);
    assert.equal(doc.how_to_filter, doc.actions.filter);
    assert.equal(doc.how_to_search, doc.actions.filter);
    assert.equal(doc.how_to_comment, doc.actions.comment);
    assert.equal(doc.how_to_archive, doc.actions.archive);
    assert.ok(doc.filters);
    assert.ok(doc.examples);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await t('filters.js re-exports getInstructions, filterInstructions, and instructions for compatibility', () => {
  assert.equal(typeof filterInstructions, 'function');
  assert.equal(typeof instructions, 'function');
  assert.equal(filterInstructions, getInstructions);
  assert.equal(instructions, getInstructions);
});

console.log(`\nAll ${n} instruction tests passed successfully!\n`);
