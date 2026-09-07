import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { resolveDatabaseId } from './databases.js';
import { getDatabaseSchema } from './directory.js';

const READ_ONLY_TYPES = new Set([
  'formula',
  'rollup',
  'created_time',
  'created_by',
  'last_edited_time',
  'last_edited_by',
  'unique_id',
  'button',
]);

/**
 * Builds a runtime Zod schema representing a database item.
 */
export function buildDatabaseZodSchema(schema) {
  const shape = {};
  const properties = schema.properties || [];
  const titlePropName = schema.title_property || 'Name';

  for (const p of properties) {
    const isTitle = p.name === titlePropName || p.type === 'title';
    const isReadOnly = READ_ONLY_TYPES.has(p.type);

    if (isTitle) {
      shape[p.name] = z.string().describe('Primary title property of the item. Required on creation, editable.');
      continue;
    }

    if (isReadOnly) {
      shape[p.name] = z
        .any()
        .optional()
        .describe(`READ-ONLY: Computed ${p.type} property. Do NOT send in create or edit requests.`);
      continue;
    }

    if (p.type === 'status' || p.type === 'select') {
      const opts = (p.options || []).map((o) => o.name);
      shape[p.name] = opts.length > 0
        ? z.enum(opts).optional().describe(`${p.type} dropdown option. Editable.`)
        : z.string().optional().describe(`${p.type} dropdown option. Editable.`);
    } else if (p.type === 'multi_select') {
      const opts = (p.options || []).map((o) => o.name);
      shape[p.name] = opts.length > 0
        ? z.array(z.enum(opts)).optional().describe('Multi-select tags. Pass array of valid option names. Editable.')
        : z.array(z.string()).optional().describe('Multi-select tags. Pass array of strings. Editable.');
    } else if (p.type === 'people') {
      const users = (p.users || schema.people_by_property?.[p.name] || [])
        .map((u) => u.name || u.label)
        .filter(Boolean);
      shape[p.name] = users.length > 0
        ? z.union([z.enum(users), z.array(z.enum(users))]).optional().describe('Assignee: Workspace user name or email. Pass string or array of strings. Editable.')
        : z.union([z.string(), z.array(z.string())]).optional().describe('Assignee: Workspace user name or email. Editable.');
    } else if (p.type === 'relation') {
      const targets = (p.targets || schema.relations_by_property?.[p.name] || [])
        .map((t) => t.title || t.label)
        .filter(Boolean);
      shape[p.name] = targets.length > 0
        ? z.union([z.enum(targets), z.array(z.enum(targets))]).optional().describe('Linked relation item: Title of target database page. Pass string or array of strings. Editable.')
        : z.union([z.string(), z.array(z.string())]).optional().describe('Linked relation item title. Editable.');
    } else if (p.type === 'number') {
      shape[p.name] = z.number().optional().describe('Numeric value. Editable.');
    } else if (p.type === 'checkbox') {
      shape[p.name] = z.boolean().optional().describe('Boolean checkbox flag. Editable.');
    } else if (p.type === 'date') {
      shape[p.name] = z.union([
        z.string().regex(/^\d{4}-\d{2}-\d{2}/),
        z.object({ start: z.string(), end: z.string().optional() }),
      ]).optional().describe('Date in YYYY-MM-DD format or { start, end } range object. Editable.');
    } else if (p.type === 'rich_text') {
      shape[p.name] = z.string().optional().describe('Text content with optional inline markdown (**bold**, *italic*, `code`, [link](url)). Editable.');
    } else if (p.type === 'url') {
      shape[p.name] = z.string().url().optional().describe('Valid web URL. Editable.');
    } else if (p.type === 'email') {
      shape[p.name] = z.string().email().optional().describe('Valid email address. Editable.');
    } else if (p.type === 'phone_number') {
      shape[p.name] = z.string().optional().describe('Phone number string. Editable.');
    } else {
      shape[p.name] = z.any().optional().describe(`${p.type} property. Editable.`);
    }
  }

  return z.object(shape);
}

/**
 * Generates the clean JSON schema using zod-to-json-schema.
 */
export function generateObjectSchema(schema) {
  const zodSchema = buildDatabaseZodSchema(schema);
  const jsonSchema = zodToJsonSchema(zodSchema);

  // Annotate computed properties with readOnly: true for clarity
  if (jsonSchema && jsonSchema.properties) {
    for (const p of schema.properties || []) {
      if (READ_ONLY_TYPES.has(p.type) && jsonSchema.properties[p.name]) {
        jsonSchema.properties[p.name].readOnly = true;
      }
    }
  }

  return jsonSchema;
}

/**
 * Self-describing API instructions and AI agent configuration for a Notion database.
 * Provides a canonical object_schema (parsed via zod-to-json-schema) and transformation instructions for
 * creating, editing, filtering, and commenting.
 */
export async function getInstructions({ databaseId, refresh = false } = {}) {
  const resolvedDbId = await resolveDatabaseId(databaseId, { refresh });
  const schema = await getDatabaseSchema(resolvedDbId, { refresh });
  const db = schema.database;

  const objectSchema = generateObjectSchema(schema);

  // Build realistic sample payloads for examples
  const sampleCreateProps = {};
  const sampleEditProps = {};
  const titlePropName = schema.title_property || 'Name';

  for (const p of schema.properties || []) {
    if (READ_ONLY_TYPES.has(p.type)) continue;

    if (p.name === titlePropName || p.type === 'title') {
      sampleCreateProps[p.name] = 'New task item';
    } else if (p.type === 'status' && p.options?.[0]) {
      sampleCreateProps[p.name] = p.options[0].name;
      if (p.options[1]) sampleEditProps[p.name] = p.options[1].name;
    } else if (p.type === 'select' && p.options?.[0]) {
      sampleCreateProps[p.name] = p.options[0].name;
      if (p.options[1]) sampleEditProps[p.name] = p.options[1].name;
    } else if (p.type === 'multi_select' && p.options?.[0]) {
      sampleCreateProps[p.name] = [p.options[0].name];
    } else if (p.type === 'number') {
      sampleCreateProps[p.name] = 10;
      sampleEditProps[p.name] = 15;
    } else if (p.type === 'checkbox') {
      sampleCreateProps[p.name] = false;
      sampleEditProps[p.name] = true;
    } else if (p.type === 'date') {
      sampleCreateProps[p.name] = new Date().toISOString().slice(0, 10);
    } else if (p.type === 'people') {
      const users = (p.users || schema.people_by_property?.[p.name] || []).map((u) => u.name || u.label).filter(Boolean);
      if (users[0]) sampleCreateProps[p.name] = users[0];
    } else if (p.type === 'relation') {
      const targets = (p.targets || schema.relations_by_property?.[p.name] || []).map((t) => t.title || t.label).filter(Boolean);
      if (targets[0]) sampleCreateProps[p.name] = targets[0];
    }
  }

  // Filter example
  const sampleFilters = {};
  for (const p of schema.properties || []) {
    if (p.type === 'status' && p.options?.[0]) {
      sampleFilters[p.name] = [p.options[0].name];
      break;
    }
    if (p.type === 'select' && p.options?.[0]) {
      sampleFilters[p.name] = [p.options[0].name];
      break;
    }
  }

  const actions = {
    create: {
      method: 'POST',
      endpoint: '/api/pages',
      database_endpoint: `/api/databases/${db.id}/pages`,
      payload_structure: {
        databaseId: 'string (database.id)',
        properties: {
          $ref: '#/object_schema',
          description: `Object conforming to object_schema. Required: database.title_property ("${titlePropName}"). Omit properties marked readOnly.`,
        },
        content: 'optional Markdown string parsed automatically into native Notion blocks (headings, checklists, code blocks)',
        comment: 'optional initial comment string posted to the newly created page',
        icon: 'optional emoji string (e.g. "🚀") or image URL',
        cover: 'optional cover image URL',
      },
      example: {
        databaseId: db.id,
        properties: sampleCreateProps,
        content: '## Implementation Notes\n- Created by AI agent\n- Supports **markdown** formatting',
        icon: '🎯',
        comment: 'Assigned for initial review 🚀',
      },
    },

    edit: {
      method: 'PATCH',
      endpoint: '/api/pages/:id',
      payload_structure: {
        properties: {
          $ref: '#/object_schema',
          description: 'Partial<object_schema>. Sparse object containing only fields being updated. All fields optional. Pass null to clear/unset a property.',
        },
        appendContent: 'optional Markdown string appended as new blocks to body',
        comment: 'optional comment string posted during update',
        archived: 'optional boolean (true to move to trash, false to restore)',
        icon: 'optional updated emoji or image URL',
        cover: 'optional updated cover image URL',
      },
      example: {
        properties: sampleEditProps,
        appendContent: '- Updated task progress via AI assistant',
        comment: 'Status updated to in progress',
      },
    },

    filter: {
      method: 'POST',
      endpoint: '/api/search',
      payload_structure: {
        databaseId: 'string (database.id)',
        searchText: 'optional free-text query string (searches title, body notes, and comments)',
        filter: {
          description: 'Map of property names from object_schema to filter criteria. Supports: single value, array of values (OR match), "none" (empty check), number comparisons (>=5, <=10), or relative date keywords (this_week, past_week, past_month).',
        },
        pageSize: 'number (default 25, max 100)',
        offset: 'number (default 0)',
      },
      example: {
        databaseId: db.id,
        searchText: 'auth',
        filter: sampleFilters,
        pageSize: 25,
        offset: 0,
      },
    },

    comment: {
      get_comments: {
        method: 'GET',
        endpoint: '/api/pages/:id/comments',
        description: 'Retrieve all unresolved comments for a page or database item.',
      },
      add_comment: {
        method: 'POST',
        endpoint: '/api/pages/:id/comments',
        payload_structure: {
          text: 'Comment body string (Markdown supported: **bold**, *italic*, `code`, [link](url))',
          discussionId: 'optional thread ID for replying to an existing comment thread',
        },
        example: {
          text: 'Looks great! Approved for deployment. 🚀',
        },
      },
    },

    archive: {
      method: 'DELETE',
      endpoint: '/api/pages/:id',
      description: 'Soft-delete/archive an item from the database.',
    },
  };

  // Build legacy filters map & examples for backward compatibility
  const filters = {};
  for (const p of schema.properties || []) {
    if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') {
      const vals = (p.options || []).map((o) => o.name);
      filters[p.name] = {
        type: 'array of values',
        accepted_values: [...vals, 'none'],
      };
    } else if (p.type === 'people') {
      const users = p.users || schema.people_by_property?.[p.name] || [];
      const vals = users.map((u) => u.name || u.label).filter(Boolean);
      filters[p.name] = {
        type: 'array of values',
        accepted_values: [...vals, 'none'],
      };
    } else if (p.type === 'relation') {
      const targets = p.targets || schema.relations_by_property?.[p.name] || [];
      const vals = targets.map((t) => t.title || t.label).filter(Boolean);
      filters[p.name] = {
        type: 'array of values',
        accepted_values: [...vals, 'none'],
      };
    } else if (p.type === 'date') {
      filters[p.name] = {
        type: 'date (YYYY-MM-DD or relative keyword)',
        accepted_values: ['YYYY-MM-DD', 'past_week', 'this_week', 'next_week', 'past_month'],
      };
    } else if (p.type === 'number') {
      filters[p.name] = {
        type: 'number (number or comparison prefix)',
        accepted_values: ['number (e.g. 5)', 'comparison (e.g. >=5, <=10, !=0)'],
      };
    } else if (p.type === 'checkbox') {
      filters[p.name] = {
        type: 'boolean',
        accepted_values: [true, false],
      };
    } else if (p.type === 'rich_text' || p.type === 'title') {
      filters[p.name] = {
        type: 'free text',
      };
    }
  }

  const examples = [
    {
      description: 'Free text search across all fields',
      request: {
        databaseId: db.id,
        searchText: 'sample query',
      },
    },
  ];
  if (Object.keys(sampleFilters).length > 0) {
    const [fieldName, filterVal] = Object.entries(sampleFilters)[0];
    examples.push({
      description: `Filter by ${fieldName}`,
      request: {
        databaseId: db.id,
        filter: { [fieldName]: filterVal[0] },
      },
    });
  }

  return {
    database: {
      id: db.id,
      name: db.title,
      title_property: titlePropName,
    },
    object_schema: objectSchema,
    actions,
    // Aliases for seamless backward compatibility
    how_to_create: actions.create,
    how_to_edit: actions.edit,
    how_to_filter: actions.filter,
    how_to_search: actions.filter,
    how_to_comment: actions.comment,
    how_to_archive: actions.archive,
    filters,
    examples,
  };
}
