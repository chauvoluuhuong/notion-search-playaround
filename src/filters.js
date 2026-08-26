import { ASSIGNEE_PROPERTY, DATABASE_ID, SEARCH_FIELDS, SPRINT_PROPERTY } from './config.js';
import { getDirectory } from './directory.js';

/**
 * The "how do I filter this table" document.
 *
 * It is deliberately self-describing: for every filterable field it states the
 * operators, the full set of allowed values, and the exact Notion filter
 * object the server will build — so a human, a script, or an LLM can construct
 * a valid request without reading this codebase.
 */
export async function filterInstructions({ refresh = false } = {}) {
  const dir = await getDirectory({ refresh });

  return {
    database: {
      id: DATABASE_ID,
      name: '🛠️ Engineering Issue Tracker',
      url: `https://app.notion.com/${DATABASE_ID.replace(/-/g, '')}`,
    },
    generated_at: dir.built_at,
    rows_scanned_for_values: dir.scanned_rows,

    how_to_call: {
      endpoint: 'GET /api/search',
      note: 'All parameters are optional. Repeatable parameters also accept a comma-separated list. Multiple values inside one parameter are OR-ed; different parameters are AND-ed together.',
      parameters: {
        q: 'Free text. Matched with a case-insensitive "contains" across every field listed in text_search.fields.',
        fields: `Restrict which fields q searches. Comma-separated. Allowed: ${SEARCH_FIELDS.map((f) => f.key).join(', ')}.`,
        assignee: 'Repeatable. A user id, a full/partial name, an email, or "none" for unassigned.',
        sprint: 'Repeatable. A sprint page id, a full/partial sprint name, or "none" for tasks with no sprint.',
        status: 'Repeatable. Exact status name.',
        priority: 'Repeatable. Exact priority name.',
        page_size: 'Integer 1-100, default 25.',
        start_cursor: 'Cursor from a previous response\'s next_cursor, for the next page.',
      },
    },

    text_search: {
      operator: 'contains (case-insensitive)',
      fields: SEARCH_FIELDS.map((f) => ({
        key: f.key,
        label: f.label,
        notion_property: f.property,
        notion_type: f.type,
        searched_by_default: f.default,
        text_searchable_natively: f.type === 'rich_text' || f.type === 'title',
        note:
          f.type === 'people'
            ? 'Notion cannot text-match a people column. The term is resolved against filters[0].values first, then filtered by user id.'
            : f.type === 'relation'
              ? 'Notion cannot text-match a relation column. The term is resolved against filters[1].values first, then filtered by page id.'
              : f.type === 'page_content'
                ? 'Body text of the task page, not a property. Notion database filters cannot read it at all, so it is indexed by this server and matched in-process.'
                : f.type === 'comments'
                  ? 'Comment threads on the task page. Not a property either, so it is indexed by this server. Notion returns UNRESOLVED comments only — a resolved thread cannot be read back through the API and therefore cannot be searched.'
                  : undefined,
      })),
      caveat:
        'A Notion database query only ever sees properties. Page body text and comments are matched by this server, not by Notion — drop the page_content and comment fields to get pure Notion-side behaviour.',
      comment_search: {
        source: 'GET /v1/comments per page (and per block when INDEX_INLINE_COMMENTS=1)',
        limitation:
          'Notion exposes unresolved comments only. Once a thread is resolved in the UI it is no longer returned by the API, so it cannot be indexed or searched.',
        inline_comments:
          'Comments anchored to a block inside the page need one request per block, so they are opt-in via the INDEX_INLINE_COMMENTS=1 environment variable.',
      },
    },

    filters: [
      {
        field: 'assignee',
        parameter: 'assignee',
        notion_property: ASSIGNEE_PROPERTY,
        notion_type: 'people',
        multiple: true,
        combine: 'or',
        operators: ['contains (by user id)', 'is_empty (pass "none")'],
        accepts: ['user id (uuid)', 'name (partial, case-insensitive)', 'email', '"none"'],
        notion_filter_template: { property: ASSIGNEE_PROPERTY, people: { contains: '<user_id>' } },
        notion_filter_template_empty: { property: ASSIGNEE_PROPERTY, people: { is_empty: true } },
        values: dir.assignees.map((a) => ({
          id: a.id,
          label: a.label,
          name: a.name,
          email: a.email,
          task_count: a.count,
          filterable_by_name: a.resolvable,
          note: a.resolvable ? undefined : 'Workspace guest the integration cannot read; filter this one by id.',
        })),
      },
      {
        field: 'sprint',
        parameter: 'sprint',
        notion_property: SPRINT_PROPERTY,
        notion_type: 'relation',
        relation_database_id: '641ea2c0-4eb3-83d7-99c2-81b99aad17c3',
        multiple: true,
        combine: 'or',
        operators: ['contains (by page id)', 'is_empty (pass "none")'],
        accepts: ['sprint page id (uuid)', 'sprint name (partial, case-insensitive)', '"none"'],
        notion_filter_template: { property: SPRINT_PROPERTY, relation: { contains: '<sprint_page_id>' } },
        notion_filter_template_empty: { property: SPRINT_PROPERTY, relation: { is_empty: true } },
        values: dir.sprints.map((s) => ({
          id: s.id,
          label: s.label,
          name: s.name,
          status: s.status,
          start_date: s.start_date,
          end_date: s.end_date,
          task_count: s.count,
        })),
      },
    ],

    examples: [
      {
        intent: 'Free text across assignee, description, summary and sprint',
        request: '/api/search?q=supplier',
      },
      {
        intent: 'Everything assigned to Lucas in Sprint 1',
        request: '/api/search?assignee=Lucas%20Luu&sprint=Sprint%201',
        notion_filter: {
          and: [
            { property: ASSIGNEE_PROPERTY, people: { contains: dir.assignees[0]?.id ?? '<user_id>' } },
            { property: SPRINT_PROPERTY, relation: { contains: dir.sprints[0]?.id ?? '<sprint_page_id>' } },
          ],
        },
      },
      {
        intent: 'Two sprints at once (OR), text only in Summary and Description',
        request: '/api/search?q=portal&fields=summary,description&sprint=Sprint 1,Sprint 2',
      },
      {
        intent: 'Unassigned tasks with no sprint',
        request: '/api/search?assignee=none&sprint=none',
      },
    ],
  };
}
