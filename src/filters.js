import { resolveDatabaseId } from './databases.js';
import { getDatabaseSchema } from './directory.js';

/**
 * The self-describing "how do I filter this database" capability document.
 * Automatically discovered from the database schema and in-use values.
 */
export async function filterInstructions({ databaseId, refresh = false } = {}) {
  const resolvedDbId = await resolveDatabaseId(databaseId, { refresh });
  const schema = await getDatabaseSchema(resolvedDbId, { refresh });
  const db = schema.database;

  // Text-searchable fields: all title/rich_text properties + people + relation + page_content + comments
  const textFields = [];
  for (const p of schema.properties) {
    if (p.type === 'title' || p.type === 'rich_text') {
      textFields.push({
        key: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: p.name,
        notion_property: p.name,
        notion_type: p.type,
        searched_by_default: true,
        text_searchable_natively: true,
      });
    } else if (p.type === 'people') {
      textFields.push({
        key: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: p.name,
        notion_property: p.name,
        notion_type: p.type,
        searched_by_default: true,
        text_searchable_natively: false,
        note: 'Notion cannot text-match a people column. Term is resolved against user names/emails first, then filtered by user ID.',
      });
    } else if (p.type === 'relation') {
      textFields.push({
        key: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: p.name,
        notion_property: p.name,
        notion_type: p.type,
        searched_by_default: true,
        text_searchable_natively: false,
        note: 'Notion cannot text-match a relation column. Term is resolved against target page titles first, then filtered by page ID.',
      });
    }
  }

  // Virtual in-process fields
  textFields.push(
    {
      key: 'page_content',
      label: 'Page Content',
      notion_property: null,
      notion_type: 'page_content',
      searched_by_default: true,
      text_searchable_natively: false,
      note: 'Body text of the page. Notion database filters cannot read it, so it is indexed and matched in-process.',
    },
    {
      key: 'comment',
      label: 'Comments',
      notion_property: null,
      notion_type: 'comments',
      searched_by_default: true,
      text_searchable_natively: false,
      note: 'Comment threads on the page. Notion API returns unresolved comments only.',
    },
  );

  // Property filter capabilities
  const filters = [];
  for (const p of schema.properties) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const base = {
      field: slug,
      parameter: p.name,
      notion_property: p.name,
      notion_type: p.type,
    };

    if (p.type === 'select') {
      filters.push({
        ...base,
        multiple: true,
        combine: 'or',
        operators: ['equals', 'does_not_equal', 'is_empty (pass "none")', 'is_not_empty'],
        accepts: ['Exact option name or id', '"none"'],
        notion_filter_template: { property: p.name, select: { equals: '<option_name>' } },
        values: (p.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color, count: o.count })),
      });
    } else if (p.type === 'multi_select') {
      filters.push({
        ...base,
        multiple: true,
        combine: 'or',
        operators: ['contains', 'does_not_contain', 'is_empty (pass "none")', 'is_not_empty'],
        accepts: ['Option name or id', '"none"'],
        notion_filter_template: { property: p.name, multi_select: { contains: '<option_name>' } },
        values: (p.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color, count: o.count })),
      });
    } else if (p.type === 'status') {
      filters.push({
        ...base,
        multiple: true,
        combine: 'or',
        operators: ['equals', 'does_not_equal', 'is_empty (pass "none")', 'is_not_empty'],
        accepts: ['Exact status name', '"none"'],
        notion_filter_template: { property: p.name, status: { equals: '<status_name>' } },
        groups: p.groups || [],
        values: (p.options || []).map((o) => ({ id: o.id, name: o.name, color: o.color, count: o.count })),
      });
    } else if (p.type === 'people') {
      const users = p.users || schema.people_by_property[p.name] || [];
      filters.push({
        ...base,
        multiple: true,
        combine: 'or',
        operators: ['contains (by user id/name/email)', 'is_empty (pass "none")', 'is_not_empty'],
        accepts: ['User UUID', 'Full or partial name (case-insensitive)', 'Email', '"none"'],
        notion_filter_template: { property: p.name, people: { contains: '<user_id>' } },
        values: users.map((u) => ({
          id: u.id,
          label: u.label,
          name: u.name,
          email: u.email,
          avatar_url: u.avatar_url,
          count: u.count,
          filterable_by_name: u.resolvable,
        })),
      });
    } else if (p.type === 'relation') {
      const targets = p.targets || schema.relations_by_property[p.name] || [];
      filters.push({
        ...base,
        multiple: true,
        combine: 'or',
        relation_database_id: p.relation_database_id,
        operators: ['contains (by page id/title)', 'is_empty (pass "none")', 'is_not_empty'],
        accepts: ['Target page UUID', 'Target page title (case-insensitive)', '"none"'],
        notion_filter_template: { property: p.name, relation: { contains: '<page_id>' } },
        values: targets.map((t) => ({
          id: t.id,
          label: t.label,
          title: t.title,
          count: t.count,
        })),
      });
    } else if (p.type === 'number') {
      filters.push({
        ...base,
        format: p.format,
        operators: [
          'equals',
          'does_not_equal',
          'greater_than',
          'less_than',
          'greater_than_or_equal_to',
          'less_than_or_equal_to',
          'is_empty',
          'is_not_empty',
        ],
        accepts: ['Number or range expression'],
        notion_filter_template: { property: p.name, number: { equals: 0 } },
      });
    } else if (p.type === 'date') {
      filters.push({
        ...base,
        operators: [
          'equals',
          'before',
          'after',
          'on_or_before',
          'on_or_after',
          'is_empty',
          'is_not_empty',
          'past_week',
          'past_month',
          'this_week',
          'next_week',
        ],
        accepts: ['ISO date string YYYY-MM-DD or relative keywords'],
        notion_filter_template: { property: p.name, date: { equals: '2026-01-01' } },
      });
    } else if (p.type === 'checkbox') {
      filters.push({
        ...base,
        operators: ['equals'],
        accepts: ['true', 'false'],
        notion_filter_template: { property: p.name, checkbox: { equals: true } },
      });
    } else if (p.type === 'rich_text' || p.type === 'title') {
      filters.push({
        ...base,
        operators: ['contains', 'does_not_contain', 'starts_with', 'ends_with', 'equals', 'is_empty', 'is_not_empty'],
        accepts: ['Text string'],
        notion_filter_template: { property: p.name, [p.type]: { contains: '<text>' } },
      });
    }
  }

  // Generate dynamic query parameter documentation
  const queryParams = {
    database_id: `Database ID or name (default: "${db.title}").`,
    q: 'Free text. Matched with case-insensitive "contains" across active text fields.',
    fields: `Restrict which fields q searches. Comma-separated. Allowed: ${textFields.map((f) => f.key).join(', ')}.`,
  };
  for (const f of filters) {
    queryParams[f.parameter] = `Repeatable/comma-separated. ${f.accepts?.join(' | ') || f.notion_type}.`;
  }
  queryParams.page_size = 'Integer 1-100, default 25.';
  queryParams.start_cursor = "Cursor for pagination from previous response's next_cursor.";

  return {
    database: {
      id: db.id,
      name: db.title,
      description: db.description,
      icon: db.icon,
      url: db.url,
    },
    generated_at: schema.built_at,
    rows_scanned_for_values: schema.scanned_rows,

    how_to_call: {
      endpoint: 'GET /api/search (or POST /api/search with JSON body)',
      note: 'All parameters are optional. Repeatable parameters accept comma-separated lists or arrays. Multiple values inside one parameter are OR-ed; different parameters are AND-ed.',
      parameters: queryParams,
    },

    text_search: {
      operator: 'contains (case-insensitive)',
      fields: textFields,
      caveat:
        'Notion database filters only see property fields. Page body text and comments are matched in-process by the server.',
      comment_search: {
        source: 'GET /v1/comments per page',
        limitation: 'Notion exposes unresolved comments only; resolved threads are excluded by Notion API.',
      },
    },

    filters,

    examples: [
      {
        intent: 'Free text search across default fields',
        request: `/api/search?database_id=${db.id}&q=test`,
      },
      filters[0]?.values?.[0]
        ? {
            intent: `Filter by ${filters[0].parameter}`,
            request: `/api/search?database_id=${db.id}&${encodeURIComponent(filters[0].parameter)}=${encodeURIComponent(filters[0].values[0].name || filters[0].values[0].label || filters[0].values[0].id)}`,
          }
        : null,
    ].filter(Boolean),
  };
}
