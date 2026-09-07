import { resolveDatabaseId } from './databases.js';
import { getDatabaseSchema } from './directory.js';

/**
 * Self-describing search and filter capability document for AI agents and clients.
 * Formatted simply without internal implementation details.
 */
export async function filterInstructions({ databaseId, refresh = false } = {}) {
  const resolvedDbId = await resolveDatabaseId(databaseId, { refresh });
  const schema = await getDatabaseSchema(resolvedDbId, { refresh });
  const db = schema.database;

  // Build simple dictionary of available filter fields:
  const filters = {};
  for (const p of schema.properties) {
    if (p.type === 'select' || p.type === 'multi_select' || p.type === 'status') {
      const vals = (p.options || []).map((o) => o.name);
      filters[p.name] = {
        type: 'array of values',
        accepted_values: [...vals, 'none'],
      };
    } else if (p.type === 'people') {
      const users = p.users || schema.people_by_property[p.name] || [];
      const vals = users.map((u) => u.name || u.label).filter(Boolean);
      filters[p.name] = {
        type: 'array of values',
        accepted_values: [...vals, 'none'],
      };
    } else if (p.type === 'relation') {
      const targets = p.targets || schema.relations_by_property[p.name] || [];
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

  // Dynamic clean examples
  const examples = [
    {
      description: 'Free text search across all fields',
      request: {
        databaseId: db.id,
        searchText: 'access',
      },
    },
  ];

  const firstChoiceField = Object.entries(filters).find(
    ([, v]) => v.type === 'array of values' && v.accepted_values.length > 1,
  );
  if (firstChoiceField) {
    const [fieldName, meta] = firstChoiceField;
    examples.push({
      description: `Filter by ${fieldName}`,
      request: {
        databaseId: db.id,
        filter: {
          [fieldName]: meta.accepted_values[0],
        },
      },
    });

    examples.push({
      description: `Search text across all fields + filter by ${fieldName}`,
      request: {
        databaseId: db.id,
        searchText: 'test',
        filter: {
          [fieldName]: meta.accepted_values.slice(0, 2),
        },
      },
    });
  }

  // Build creation & edit capability documentation
  const editableProperties = {};
  const sampleCreateProps = {};
  const sampleEditProps = {};

  for (const p of schema.properties) {
    if (['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'unique_id', 'button'].includes(p.type)) {
      continue;
    }
    editableProperties[p.name] = {
      type: p.type,
      options: p.options ? p.options.map((o) => o.name) : undefined,
      users: p.users ? p.users.map((u) => u.name || u.label).filter(Boolean) : undefined,
      targets: p.targets ? p.targets.map((t) => t.title || t.label).filter(Boolean) : undefined,
    };

    // Construct realistic examples
    if (p.type === 'title') {
      sampleCreateProps[p.name] = 'New sample item';
    } else if (p.type === 'status' && p.options?.[0]) {
      sampleCreateProps[p.name] = p.options[0].name;
      if (p.options?.[1]) sampleEditProps[p.name] = p.options[1].name;
    } else if (p.type === 'select' && p.options?.[0]) {
      sampleCreateProps[p.name] = p.options[0].name;
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
    }
  }

  return {
    database: {
      id: db.id,
      name: db.title,
      title_property: schema.title_property,
    },
    how_to_search: {
      method: 'POST',
      endpoint: '/api/search',
      body_format: {
        databaseId: db.id,
        searchText: 'Case-insensitive search across all fields, page body, and comments',
        filter: 'Map of field names to values. Pass an array of values to match any (OR).',
        pageSize: 25,
        offset: 0,
      },
    },
    how_to_create: {
      method: 'POST',
      endpoint: '/api/pages',
      database_endpoint: `/api/databases/${db.id}/pages`,
      body_format: {
        databaseId: db.id,
        properties: 'Map of property names to values matching the schema',
        content: 'Optional Markdown string parsed into Notion blocks (headings, lists, code, etc.)',
        icon: 'Optional emoji string (e.g. "🚀") or image URL',
        cover: 'Optional cover image URL',
        comment: 'Optional initial comment to post to the newly created page (Markdown supported)',
      },
      example: {
        databaseId: db.id,
        properties: sampleCreateProps,
        content: '## Details\n- Added via API\n- Supports **markdown** formatting',
        icon: '📝',
      },
    },
    how_to_edit: {
      method: 'PATCH',
      endpoint: '/api/pages/:id',
      body_format: {
        properties: 'Map of field names to updated values',
        appendContent: 'Optional Markdown string to append to page body',
        comment: 'Optional comment to post to this page during update (Markdown supported)',
        archived: 'Boolean: set true to archive/trash, false to restore',
        icon: 'Optional updated emoji or image URL',
        cover: 'Optional updated cover image URL',
      },
      example: {
        properties: sampleEditProps,
        appendContent: '- Updated status via API',
      },
    },
    how_to_comment: {
      get_comments: {
        method: 'GET',
        endpoint: '/api/pages/:id/comments',
        description: 'Fetch all unresolved comments on a page or database item',
      },
      add_comment: {
        method: 'POST',
        endpoint: '/api/pages/:id/comments',
        body_format: {
          text: 'Comment string (Markdown supported: **bold**, *italic*, `code`, [link](url))',
          discussionId: 'Optional discussion_id to reply to an existing comment thread',
        },
        example: {
          text: 'Looks good! Verified in staging environment. 🚀',
        },
      },
    },
    how_to_archive: {
      method: 'DELETE',
      endpoint: '/api/pages/:id',
    },
    editable_properties: editableProperties,
    filters,
    examples,
  };
}
