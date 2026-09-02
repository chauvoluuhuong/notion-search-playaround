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

  return {
    database: {
      id: db.id,
      name: db.title,
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
    filters,
    examples,
  };
}
