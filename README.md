# notion-search

Search form + filter API over the Notion database
**🛠️ Engineering Issue Tracker** (`f30ea2c04eb3824082c081891bee91a1`), including the
body text of each task page — which Notion's own database filters cannot reach.

```bash
npm install
npm start        # http://localhost:3100
```

| What | Where |
|---|---|
| Search form | http://localhost:3100/ |
| Search API | `GET /api/search` |
| Filter capability / instruction API | `GET /api/filters` |
| Dropdown values only | `GET /api/options` |

Credentials live in `.env` (git-ignored). Port is 3100 because 3000 was already
taken on this machine.

### Testing the API

**Postman:** import [`postman_collection.json`](postman_collection.json)
(*Import → File*). 45 requests in 8 folders, every one a read — safe to run with
the Collection Runner.

Set the `baseUrl` variable if you are not on `http://localhost:3100`, then run
**01 · Health & metadata → Filter instructions** first: its test script captures
`{{assigneeId}}`, `{{assigneeName}}`, `{{assigneeEmail}}`, `{{sprintId}}` and
`{{sprintName}}`, which the *by id* and *by email* requests use.

| Folder | Covers |
|---|---|
| 01 · Health & metadata | health, options, the filter instruction API, cache refresh |
| 02 · Text search | free text, field-limited text, page-body-only text, opt-in fields, case-insensitivity, no-match |
| 03 · Assignee filter | by name, id, email, `none`, OR of two, unknown value |
| 04 · Sprint filter | by name, page id, OR of two, `none`, unknown value |
| 05 · Status, priority & combined | single, OR, AND across parameters |
| 06 · Pagination | cursor chaining, max page size, clamping |
| 07 · POST | JSON body, arrays, empty body |
| 08 · Edge cases | unknown field keys, empty `q`, 404 |

Two requests in *02* are deliberately paired: `q=not-found response` returns 1
result, and the same term with `page_content` disabled returns 0 — a live
demonstration of what Notion's own filters cannot reach.

**Plain curl:** [`curl-examples.sh`](curl-examples.sh) has the same 45 calls as
copy-pasteable commands with real ids filled in. Postman's *Import → Raw text*
takes one cURL command at a time, so use the collection for the whole suite.

### Shell smoke test

[`test-api.sh`](test-api.sh) exercises every endpoint and doubles as a set of
worked examples — it prints the exact `curl` for each case next to a digest of
the response.

```bash
./test-api.sh                    # summary line per request
RAW=1 ./test-api.sh              # full JSON for every request
./test-api.sh sprint             # only cases whose label matches "sprint"
BASE=http://host:port ./test-api.sh
```

17 cases: health, options, the filter instruction API, free text, field-limited
text, page-body-only text (plus the same term with `page_content` disabled, which
returns 0 and shows why Notion alone cannot find it), assignee/sprint/status/
priority filters, `none` handling, pagination, `POST`, and the unknown-value
path. Exits non-zero if any request does not return 200.

### Using the form

- **Every match is shown**, not a first page — the form keeps requesting pages
  until the result set is exhausted, and the count reads e.g. *"45 results — all
  shown"*. Past 500 rows it stops and offers a button for the rest, so a huge
  filter cannot lock up the browser.
- **Filters clear at three levels**: the `×` on any chip in the *Filtering by*
  bar removes that one value, the **clear** link above a column empties that
  column, and **Clear all filters** resets everything including the search box
  and the field selection.
- Changing any filter re-runs the search immediately; a superseded request is
  discarded, so fast clicking cannot interleave stale results.

---

## Field names — corrections

You asked for *assignee, description, summary, command, sprint*. Here is what the
table actually has:

| You said | Actual Notion property | Type | Note |
|---|---|---|---|
| assignee | **`Assignees`** | `people` | There are also unused `Assign`, `Assign QC`, `CS Owner`, `QC Owner` people columns — all empty on all 81 rows, so only `Assignees` is wired up. |
| description | **`Description`** | `rich_text` | ✅ exact match |
| summary | **`Summary`** | `rich_text` | ✅ exact match |
| **command** | **— does not exist —** | | No `Command` (or `Comment`) property exists, and the pages carry no Notion comments either. See below. |
| sprint | **`Sprint`** | `relation` → Sprint DB | Not a text column; it points at a separate Sprint table. |

**About "command":** there is no such column. Rather than guess, the search
covers *every* remaining text-bearing column, so whatever you meant is included:
`Task Name` (title), `Dependencies`, `Story ID`, and optionally `Source Team` and
`Source Type`. If "command" is a column you are about to add, add one line to
`SEARCH_FIELDS` in [src/config.js](src/config.js) and it appears in both the API
and the form automatically.

---

## Page body text (`page_content`)

**A Notion database query can only ever see properties — never the body of a
page.** Most of the real detail in this table (acceptance criteria, API
behaviour, edge cases) lives in the page body, so a property-only search misses
it. Example: `"not-found response"` appears in exactly one task, #4
*STORY-03.07*, inside the page body — no Notion filter can find it, and Notion's
own `/v1/search` endpoint does not match it either.

So the server indexes the body of every task page (`src/content.js`, one pass
over the block tree, 5-minute cache) and matches that text in-process. The
`page_content` field is on by default; matched rows come back with a highlighted
excerpt and a `match: page_content` chip.

Currently 73 of the 81 pages have body text (~36k characters), so the whole index
is trivial to hold in memory. The first search after a cold start pays ~6s to
build it; subsequent searches are ~1s.

Every response says exactly how the text was matched:

```jsonc
"text_matching": {
  "term": "not-found response",
  "fields": ["assignee", "description", "summary", "sprint", "task_name", "dependencies", "story_id", "page_content"],
  "notion_filter_equivalent": [ /* what Notion itself evaluates */ ],
  "page_content": {
    "matched_in_process": true,
    "reason": "Notion database filters cannot read page body text.",
    "pages_indexed": 81
  }
}
```

Drop `page_content` from `fields` to get pure Notion-side behaviour.

---

## The two Notion quirks this handles

Notion's query API **cannot do a text `contains` on a `people` or a `relation`
column** — those only filter by UUID. So a plain text search over "assignee" and
"sprint" is impossible in one call.

The server works around it in two steps:

1. Build a directory of every assignee (from `/v1/users` **plus** a scan of the
   rows, which catches guests the integration cannot read) and every sprint page.
2. Resolve the search term against those names → concrete ids → then filter with
   `people.contains: <user_id>` / `relation.contains: <page_id>`.

The directory is cached for 5 minutes; `?refresh=1` rebuilds it.

---

## `GET /api/search`

All parameters optional. Values inside one parameter are **OR**-ed; different
parameters are **AND**-ed.

| Param | Meaning |
|---|---|
| `q` | Free text, case-insensitive `contains`, across all default fields |
| `fields` | Restrict which fields `q` searches, e.g. `summary,description`. Include `page_content` to search page bodies |
| `assignee` | User id, partial name, email, or `none` (unassigned). Repeatable/comma-separated |
| `sprint` | Sprint page id, partial name, or `none` (no sprint) |
| `status` | Exact status name, e.g. `Dev Completed` |
| `priority` | Exact priority name, e.g. `P0 - Critical` |
| `page_size` | 1–100, default 25 |
| `start_cursor` / `offset` | `next_cursor` from the previous response (a row offset) |

`POST /api/search` accepts the same keys as a JSON body.

```bash
curl "http://localhost:3100/api/search?q=supplier"
curl "http://localhost:3100/api/search?assignee=Lucas&sprint=Sprint%201,Sprint%202"
curl "http://localhost:3100/api/search?q=portal&fields=summary,description"
curl "http://localhost:3100/api/search?assignee=none&sprint=none"
```

`total` is a real count, not a page count — the structured filters run on
Notion's side, then text matching and paging happen over the returned set (capped
at 1000 rows). Each response echoes the `notion_filter` it built and
`matched_fields` per row, so you can see *why* a row matched:

```json
{
  "results": [{
    "task_id": "80",
    "task_name": "[DevOps/Infra] Add Nginx reverse proxy …",
    "summary": "View and triage incoming purchase orders",
    "assignees": [{ "id": "330d…", "label": "Lucas Luu" }],
    "sprint":    [{ "id": "113e…", "label": "Sprint 1" }],
    "page_content": "…a safe not-found response without creating a product…",
    "matched_fields": ["description", "page_content"],
    "url": "https://app.notion.com/p/…"
  }],
  "count": 25,
  "total": 45,
  "has_more": true,
  "next_cursor": "25",
  "notion_filter": { "and": [ … ] },
  "text_matching": { … }
}
```

---

## `GET /api/filters` — the filter instruction API

This is the endpoint that tells a caller *how* to filter and *which values are
allowed*. It is self-describing: for each filterable field it returns the Notion
property, the operators, the raw filter template, and the complete value list.

```jsonc
{
  "how_to_call": { "endpoint": "GET /api/search", "parameters": { … } },
  "text_search": { "operator": "contains (case-insensitive)", "fields": [ … ] },
  "filters": [
    {
      "field": "assignee",
      "notion_property": "Assignees",
      "notion_type": "people",
      "operators": ["contains (by user id)", "is_empty (pass \"none\")"],
      "accepts": ["user id (uuid)", "name (partial)", "email", "\"none\""],
      "notion_filter_template": { "property": "Assignees", "people": { "contains": "<user_id>" } },
      "values": [
        { "id": "330d872b-…", "label": "Lucas Luu",  "email": "lucas.luu@innostaas.com", "task_count": 18, "filterable_by_name": true },
        { "id": "3bad872b-…", "label": "Unnamed member (3bad872b…)", "task_count": 18, "filterable_by_name": false,
          "note": "Workspace guest the integration cannot read; filter this one by id." },
        { "id": "32fd872b-…", "label": "Angus Sim", "task_count": 0, "filterable_by_name": true }
      ]
    },
    {
      "field": "sprint",
      "notion_property": "Sprint",
      "notion_type": "relation",
      "notion_filter_template": { "property": "Sprint", "relation": { "contains": "<sprint_page_id>" } },
      "values": [
        { "id": "113ea2c0-…", "label": "Sprint 1", "status": "Active",   "start_date": "2026-05-04", "end_date": "2026-05-15", "task_count": 37 },
        { "id": "eb8ea2c0-…", "label": "Sprint 2", "status": "Planning", "task_count": 15 }
        // … Sprint 3–5 and one untitled sprint
      ]
    }
  ],
  "examples": [ … ]
}
```

Heads-up on the values it currently returns:

- One assignee (18 tasks) is a **workspace guest the integration cannot read** —
  the API returns `name: null` for them. They are still listed and still
  filterable, but only by id (`filterable_by_name: false`). Inviting that person
  as a workspace member, or granting the integration user-read access, fixes the
  label.
- `Angus Sim` exists in the workspace but is on 0 tasks.
- The Sprint table has 6 pages; one has an empty title and shows as
  *"Untitled sprint (5b2ea2c0…)"*.
- 18 of the 81 tasks have no sprint, and 45 have no assignee — use
  `sprint=none` / `assignee=none` to find them.

---

## Layout

```
server.js            routes
src/config.js        env + the field map (edit SEARCH_FIELDS to add a column)
src/notion.js        Notion REST client + property readers
src/directory.js     assignee & sprint value discovery, name→id resolution, cache
src/content.js       page-body index (the part Notion cannot filter on)
src/search.js        Notion filter builder + text matching + result shaping
src/filters.js       the /api/filters instruction document
public/index.html    the search form (no build step)
test-api.sh          curl smoke-test / worked examples for every endpoint
postman_collection.json  importable Postman collection (45 requests)
curl-examples.sh     the same 45 calls as plain curl commands
```
