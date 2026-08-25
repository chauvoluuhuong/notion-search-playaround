#!/usr/bin/env bash
# Notion Search API — curl examples
#
# Postman: Import > Raw text, paste ONE command, Continue.
# For the whole suite at once, import postman_collection.json instead.
#

BASE="${BASE:-http://localhost:3100}"


#==========================================================================
# 01 · Health & metadata
#==========================================================================

# Health check
#   Liveness probe. Returns { ok: true }.
curl -sS "$BASE/api/health"

# Options — values for the form dropdowns
#   Compact value lists: assignees, sprints, statuses, priorities. Backs the four dropdowns in the web form.
curl -sS "$BASE/api/options"

# Options — force a cache refresh
#   Assignee/sprint values are cached for 5 minutes. refresh=1 rebuilds the directory immediately — use after adding a sprint or a teammate.
curl -sS "$BASE/api/options?refresh=1"

# Filter instructions — RUN THIS FIRST
#   The filter capability API. Self-describing: for every filterable field it returns the Notion property, the operators, the raw Notion filter template and the complete set of allowed values for assignee and sprint.
curl -sS "$BASE/api/filters"

# Filter instructions — force a cache refresh
#   Same document, rebuilt from Notion rather than served from the 5-minute cache.
curl -sS "$BASE/api/filters?refresh=1"

#==========================================================================
# 02 · Text search (q)
#==========================================================================

# All tasks — no filter at all
#   No parameters means no filter: every row, newest edit first. total is the real count, not the page size.
curl -sS "$BASE/api/search?page_size=25"

# Free text across all default fields
#   Case-insensitive contains over Assignee, Description, Summary, Sprint, Task Name, Dependencies, Story ID and the page body.
curl -sS "$BASE/api/search?q=supplier&page_size=5"

# Text that lives ONLY in the page body
#   "not-found response" appears in no property — only inside the body of task #4.
curl -sS "$BASE/api/search?q=not-found%20response"

# Same term with page_content OFF — proves Notion alone cannot find it
#   Identical search minus the page_content field, i.e. pure Notion-side behaviour. Returns 0 results — this is exactly why a property-only search was missing rows.
curl -sS "$BASE/api/search?q=not-found%20response&fields=summary%2Cdescription%2Cassignee%2Csprint%2Ctask_name%2Cstory_id%2Cdependencies"

# Restrict text to Summary + Description
#   fields narrows what q searches. Allowed keys: assignee, description, summary, sprint, task_name, dependencies, story_id, source_team, source_type, page_content.
curl -sS "$BASE/api/search?q=order&fields=summary%2Cdescription&page_size=5"

# Search the assignee column by name
#   Notion cannot text-match a people column. The term is resolved against the user directory first, then filtered by user id. text_matching.notion_filter_equivalent shows the id-based filter that was actually evaluated.
curl -sS "$BASE/api/search?q=Lucas%20Luu&fields=assignee&page_size=5"

# Search the sprint column by name
#   Same trick for the relation column: sprint name → page id → relation.contains.
curl -sS "$BASE/api/search?q=Sprint%201&fields=sprint&page_size=5"

# Search page bodies only
#   Only the indexed page-body text. Useful for acceptance criteria and API details, which live in the body rather than in any property.
curl -sS "$BASE/api/search?q=barcode&fields=page_content&page_size=5"

# Search by Story ID
#   Prefix search over the Story ID column.
curl -sS "$BASE/api/search?q=STORY-03&fields=story_id"

# Include the opt-in fields (Source Team / Source Type)
#   source_team and source_type are off by default; name them explicitly to search them.
curl -sS "$BASE/api/search?q=FE&fields=source_team%2Csource_type&page_size=5"

# Case-insensitivity check (UPPERCASE term)
#   Matching is case-insensitive on both the Notion side and in the body index — this returns the same total as the lowercase supplier search.
curl -sS "$BASE/api/search?q=SUPPLIER&page_size=3"

# Term that matches nothing
#   Empty result set, total: 0, HTTP 200 — not an error.
curl -sS "$BASE/api/search?q=zzzz-no-such-text"

#==========================================================================
# 03 · Assignee filter
#==========================================================================

# By partial name
#   Accepts a partial, case-insensitive name. Resolved to a user id before filtering.
curl -sS "$BASE/api/search?assignee=Lucas%20Luu&page_size=5"

# By user id (uuid)
#   The exact form Notion itself uses: { property: "Assignees", people: { contains: <uuid> } }.
curl -sS "$BASE/api/search?assignee=330d872b-594c-816a-a1ac-0002597e2470&page_size=5"

# By email
#   Emails resolve through the same directory lookup as names.
curl -sS "$BASE/api/search?assignee=lucas.luu%40innostaas.com&page_size=5"

# Unassigned tasks
#   none (or unassigned) maps to people.is_empty: true.
curl -sS "$BASE/api/search?assignee=none&page_size=5"

# Two assignees at once (OR)
#   Repeated/comma-separated values inside one parameter are OR-ed together.
curl -sS "$BASE/api/search?assignee=Lucas%20Luu%2C330d872b-594c-816a-a1ac-0002597e2470&page_size=5"

# Unknown assignee → notice, not a crash
#   Unresolvable value returns HTTP 200 with an empty result set and a notice pointing at /api/filters.
curl -sS "$BASE/api/search?assignee=nobody-here"

#==========================================================================
# 04 · Sprint filter
#==========================================================================

# By sprint name
curl -sS "$BASE/api/search?sprint=Sprint%201&page_size=5"

# By sprint page id (uuid)
#   { property: "Sprint", relation: { contains: <page_id> } }. Requires Filter instructions to have run first.
curl -sS "$BASE/api/search?sprint=113ea2c0-4eb3-8334-b164-81030f0bd00a&page_size=5"

# Two sprints at once (OR)
#   Comma-separated values are OR-ed.
curl -sS "$BASE/api/search?sprint=Sprint%201%2CSprint%202&page_size=5"

# Tasks with no sprint
#   Maps to relation.is_empty: true.
curl -sS "$BASE/api/search?sprint=none&page_size=5"

# Unknown sprint → notice
#   Same graceful handling as an unknown assignee.
curl -sS "$BASE/api/search?sprint=Sprint%2099"

#==========================================================================
# 05 · Status, priority & combined
#==========================================================================

# By status
#   Exact status name. Full list comes from /api/options.
curl -sS "$BASE/api/search?status=Dev%20Completed&page_size=5"

# Several statuses (OR)
curl -sS "$BASE/api/search?status=Backlog%2CTo%20Do%2CIn%20Progress&page_size=5"

# By priority
curl -sS "$BASE/api/search?priority=P0%20-%20Critical&page_size=5"

# Status AND priority
#   Different parameters are AND-ed; values inside one parameter are OR-ed.
curl -sS "$BASE/api/search?status=Dev%20Completed&priority=P0%20-%20Critical&page_size=5"

# Everything combined
#   Text AND assignee AND sprint AND status. Inspect notion_filter in the response to see the exact filter object sent to Notion.
curl -sS "$BASE/api/search?q=order&assignee=Lucas%20Luu&sprint=Sprint%201&status=Backlog&page_size=5"

# Unassigned AND no sprint (backlog hygiene)
#   Finds rows that slipped through triage.
curl -sS "$BASE/api/search?assignee=none&sprint=none&page_size=10"

#==========================================================================
# 06 · Pagination
#==========================================================================

# Page 1 — five per page
#   Take next_cursor from the response and pass it as offset for the next page.
curl -sS "$BASE/api/search?page_size=5"

# Page 2 — using the captured cursor
#   offset and start_cursor are accepted interchangeably.
curl -sS "$BASE/api/search?page_size=5&offset=5"

# Page 2 — explicit offset
curl -sS "$BASE/api/search?page_size=5&offset=5"

# Maximum page size
#   100 is the ceiling.
curl -sS "$BASE/api/search?page_size=100"

# Over-large page_size is clamped to 100
#   No error — the value is clamped.
curl -sS "$BASE/api/search?page_size=500"

#==========================================================================
# 07 · POST (JSON body)
#==========================================================================

# POST — same options as the query string
#   POST /api/search accepts the identical keys as JSON. Arrays are OR-ed, which avoids escaping commas in values.
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{"q": "barcode", "sprint": ["Sprint 1"], "page_size": 5}'

# POST — arrays for assignee and status
#   fields may also be an array here.
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{"assignee": ["Lucas Luu"], "status": ["Backlog", "To Do"], "fields": ["summary", "description", "page_content"], "q": "order", "page_size": 5}'

# POST — empty body returns everything
#   No keys means no filter.
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{}'

#==========================================================================
# 08 · Edge cases
#==========================================================================

# Unknown field names are ignored
#   Unrecognised keys in fields are dropped; the valid ones still apply.
curl -sS "$BASE/api/search?q=supplier&fields=bogus_field%2Csummary"

# Empty q behaves as no text filter
#   A blank q is ignored, leaving only the structured filters.
curl -sS "$BASE/api/search?q=&status=Backlog"

# Unknown route → 404
#   Express default 404 — confirms you are hitting the right server.
curl -sS "$BASE/api/does-not-exist"
