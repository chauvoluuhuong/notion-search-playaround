import {
  ASSIGNEE_PROPERTY, DATABASE_ID, DEFAULT_FIELD_KEYS, FIELD_BY_KEY, SPRINT_PROPERTY,
} from './config.js';
import { queryDatabase, readProperty } from './notion.js';
import { getDirectory, isUuid, resolveValues } from './directory.js';
import { getContentIndex, snippet } from './content.js';

const MAX_CANDIDATE_PAGES = 10; // 1000 rows

const asArray = (v) =>
  v == null ? [] : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean);

/** The Notion-side filter: everything Notion can evaluate itself. */
function idGroup(values, entries, property, kind) {
  const ids = new Set();
  let includeEmpty = false;
  for (const raw of values) {
    const v = String(raw).trim();
    if (!v) continue;
    if (v.toLowerCase() === 'none' || v.toLowerCase() === 'unassigned') { includeEmpty = true; continue; }
    const hits = resolveValues(v, entries);
    if (hits.length === 0 && !isUuid(v)) return { unmatched: v };
    hits.forEach((id) => ids.add(id));
  }
  const leaves = [...ids].map((id) => ({ property, [kind]: { contains: id } }));
  if (includeEmpty) leaves.push({ property, [kind]: { is_empty: true } });
  return { leaves, ids: [...ids] };
}

export async function buildQuery(params) {
  const directory = await getDirectory();
  const and = [];
  const resolved = { assignees: [], sprints: [] };

  const assignee = asArray(params.assignee);
  if (assignee.length) {
    const g = idGroup(assignee, directory.assignees, ASSIGNEE_PROPERTY, 'people');
    if (g.unmatched) return { error: `Unknown assignee "${g.unmatched}". See GET /api/filters for allowed values.` };
    resolved.assignees = g.ids;
    and.push(g.leaves.length === 1 ? g.leaves[0] : { or: g.leaves });
  }

  const sprint = asArray(params.sprint);
  if (sprint.length) {
    const g = idGroup(sprint, directory.sprints, SPRINT_PROPERTY, 'relation');
    if (g.unmatched) return { error: `Unknown sprint "${g.unmatched}". See GET /api/filters for allowed values.` };
    resolved.sprints = g.ids;
    and.push(g.leaves.length === 1 ? g.leaves[0] : { or: g.leaves });
  }

  for (const [param, property, kind] of [['status', 'Status', 'status'], ['priority', 'Priority', 'select']]) {
    const vals = asArray(params[param]);
    if (!vals.length) continue;
    const leaves = vals.map((v) => ({ property, [kind]: { equals: v } }));
    and.push(leaves.length === 1 ? leaves[0] : { or: leaves });
  }

  const filter = and.length === 0 ? undefined : and.length === 1 ? and[0] : { and };
  return { filter, resolved, directory };
}

/**
 * The filter Notion *would* run for the text part, if page bodies were
 * filterable. Returned for transparency/debugging; the body field has no
 * Notion equivalent and is matched in-process instead.
 */
function equivalentTextFilter(fields, q, directory) {
  const leaves = [];
  for (const f of fields) {
    if (f.type === 'title') leaves.push({ property: f.property, title: { contains: q } });
    else if (f.type === 'rich_text') leaves.push({ property: f.property, rich_text: { contains: q } });
    else if (f.type === 'people') {
      resolveValues(q, directory.assignees).forEach((id) => leaves.push({ property: f.property, people: { contains: id } }));
    } else if (f.type === 'relation') {
      resolveValues(q, directory.sprints).forEach((id) => leaves.push({ property: f.property, relation: { contains: id } }));
    }
  }
  return leaves;
}

async function fetchCandidates(filter) {
  const rows = [];
  let cursor;
  for (let i = 0; i < MAX_CANDIDATE_PAGES; i++) {
    const body = { page_size: 100, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
    if (filter) body.filter = filter;
    if (cursor) body.start_cursor = cursor;
    const res = await queryDatabase(DATABASE_ID, body);
    rows.push(...res.results);
    if (!res.has_more) return { rows, truncated: false };
    cursor = res.next_cursor;
  }
  return { rows, truncated: true };
}

function shape(page, directory, body, comments) {
  const p = page.properties;
  const get = (name) => readProperty(p[name]);
  const sprintIds = get('Sprint') || [];
  return {
    id: page.id,
    url: page.url,
    task_id: get('Task ID'),
    task_name: get('Task Name'),
    summary: get('Summary'),
    description: get('Description'),
    dependencies: get('Dependencies'),
    story_id: get('Story ID'),
    source_team: get('Source Team'),
    source_type: get('Source Type'),
    assignees: (get('Assignees') || []).map((u) => ({
      id: u.id,
      label: directory.assignees.find((a) => a.id === u.id)?.label || u.name || u.id,
      email: u.email,
    })),
    sprint: sprintIds.map((id) => ({ id, label: directory.sprints.find((s) => s.id === id)?.label || id })),
    status: get('Status'),
    priority: get('Priority'),
    project: get('Project'),
    team: get('Team'),
    category: get('Category'),
    story_points: get('Story Points'),
    due_date: get('Due Date'),
    last_edited_time: page.last_edited_time,
    page_content: body || null,
    comments: (comments || []).map((c) => ({
      ...c,
      author: directory.assignees.find((a) => a.id === c.author_id)?.label
        || (c.author_id ? `User ${c.author_id.slice(0, 8)}…` : null),
    })),
  };
}

/** Which of the active fields contain `q` on this row. */
function matchFields(row, q, fields, directory) {
  const t = q.toLowerCase();
  const hit = (v) => typeof v === 'string' && v.toLowerCase().includes(t);
  const userIds = resolveValues(q, directory.assignees);
  const sprintIds = resolveValues(q, directory.sprints);
  const out = [];
  for (const f of fields) {
    switch (f.key) {
      case 'assignee':
        if (row.assignees.some((a) => userIds.includes(a.id))) out.push(f.key);
        break;
      case 'sprint':
        if (row.sprint.some((s) => sprintIds.includes(s.id))) out.push(f.key);
        break;
      case 'page_content':
        if (hit(row.page_content)) out.push(f.key);
        break;
      case 'comment':
        if (row.comments.some((c) => hit(c.text))) out.push(f.key);
        break;
      default:
        if (hit(row[f.key])) out.push(f.key);
    }
  }
  return out;
}

export async function search(params) {
  const built = await buildQuery(params);
  if (built.error) {
    return { results: [], count: 0, total: 0, offset: 0, has_more: false, next_cursor: null,
             notice: built.error, notion_filter: null, text_matching: null };
  }

  const { filter, resolved, directory } = built;
  const q = String(params.q ?? '').trim();
  const keys = asArray(params.fields).filter((k) => FIELD_BY_KEY[k]);
  const fields = (keys.length ? keys : DEFAULT_FIELD_KEYS).map((k) => FIELD_BY_KEY[k]);
  const wantsBody = fields.some((f) => f.key === 'page_content');
  const wantsComments = fields.some((f) => f.key === 'comment');

  const pageSize = Math.min(Math.max(Number(params.page_size) || 25, 1), 100);
  const offset = Math.max(Number(params.offset ?? params.start_cursor) || 0, 0);

  const [{ rows, truncated }, content] = await Promise.all([
    fetchCandidates(filter),
    q && (wantsBody || wantsComments) ? getContentIndex() : Promise.resolve(null),
  ]);

  let shaped = rows.map((p) =>
    shape(p, directory, content?.textById.get(p.id) ?? null, content?.commentsById.get(p.id) ?? []));

  let textMatching = null;
  if (q) {
    shaped = shaped
      .map((r) => ({ ...r, matched_fields: matchFields(r, q, fields, directory) }))
      .filter((r) => r.matched_fields.length > 0);

    textMatching = {
      term: q,
      fields: fields.map((f) => f.key),
      notion_filter_equivalent: equivalentTextFilter(fields, q, directory),
      page_content: wantsBody
        ? { matched_in_process: true,
            reason: 'Notion database filters cannot read page body text.',
            pages_indexed: content?.pages_indexed ?? 0,
            indexed_at: content?.built_at ?? null }
        : null,
      comment: wantsComments
        ? { matched_in_process: true,
            reason: 'Notion database filters cannot read comments.',
            comments_indexed: content?.comments_indexed ?? 0,
            pages_with_comments: content?.pages_with_comments ?? 0,
            inline_comments_indexed: content?.inline_comments_indexed ?? false,
            caveat: 'Notion\'s API returns unresolved comments only; resolved threads cannot be read.',
            indexed_at: content?.built_at ?? null }
        : null,
    };
  } else {
    shaped = shaped.map((r) => ({ ...r, matched_fields: [] }));
  }

  const total = shaped.length;
  const slice = shaped.slice(offset, offset + pageSize).map((r) => ({
    ...r,
    page_content: q ? snippet(r.page_content, q) : null,
    page_content_chars: r.page_content ? r.page_content.length : 0,
    comment_count: r.comments.length,
    // Return only the threads that matched, not every comment on the page.
    comments: q
      ? r.comments
          .filter((c) => c.text.toLowerCase().includes(q.toLowerCase()))
          .map((c) => ({ ...c, excerpt: snippet(c.text, q) }))
      : [],
  }));

  return {
    results: slice,
    count: slice.length,
    total,
    offset,
    has_more: offset + slice.length < total,
    next_cursor: offset + slice.length < total ? String(offset + slice.length) : null,
    notice: truncated ? `Only the first ${rows.length} rows were scanned.` : null,
    notion_filter: filter ?? null,
    text_matching: textMatching,
    resolved,
  };
}
