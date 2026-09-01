# notion-search

A universal, generic search and dynamic filtering engine for any Notion database in your workspace.

Automatically discovers:
1. **All databases** shared with the integration (`POST /v1/search`).
2. **Schema & filter capabilities** for any database (discovers properties, types, select/multi-select/status options, workspace people, relations with automatic target page title resolution, dates, numbers, checkboxes, and text).
3. **In-process page body and comment indexing** for text search over content Notion's native database filters cannot reach.

```bash
npm install
npm start        # http://localhost:3100
```

| What | Where |
|---|---|
| Web Interface | http://localhost:3100/ |
| Database Discovery | `GET /api/databases` |
| Filter Capability & Schema API | `GET /api/filters?database_id=<id>` |
| Dropdown & Option Values | `GET /api/options?database_id=<id>` |
| Universal Search & Filter API | `GET /api/search` / `POST /api/search` |

---

## 1. Database Discovery (`GET /api/databases`)

Discovers all databases accessible to your Notion integration token:

```json
{
  "databases": [
    {
      "id": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
      "title": "IT Epics",
      "icon": { "type": "emoji", "emoji": "🗂️" },
      "properties_count": 6,
      "property_names": ["Owner", "Goal", "Status", "Start", "Target end", "Epic"],
      "url": "https://app.notion.com/p/bdaec82f21424cf9a017ba7b47678e6c"
    },
    {
      "id": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
      "title": "IT User Stories",
      "icon": { "type": "emoji", "emoji": "🧩" },
      "properties_count": 11,
      "property_names": ["Priority", "Sprint", "Due", "Status", "Epic", "Created", "Description", "Assignee", "Last edited", "Estimate (pts)", "Story"],
      "url": "https://app.notion.com/p/9d483ce427474ea3a741bc9a2bc98c4e"
    }
  ],
  "count": 2
}
```

Force a cache refresh: `GET /api/databases?refresh=1`.

---

## 2. Schema Discovery & Filter Capabilities (`GET /api/filters`)

Given any database ID or title, returns a self-describing capability document with:
- All properties and their Notion types (`select`, `multi_select`, `status`, `people`, `relation`, `number`, `date`, `checkbox`, `rich_text`, `title`, etc.)
- Supported filter operators for each field
- Allowed values, counts, and Notion colors
- Automatically resolved target page titles for relations
- Searchable text fields including page body and unresolved comments

```bash
curl "http://localhost:3100/api/filters?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"
```

---

## 3. Universal Search & Filtering (`GET /api/search` and `POST /api/search`)

Filter any field on any database dynamically:

### By Select / Status / Multi-select
```bash
# Filter by Priority
curl "http://localhost:3100/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Priority=P0"

# Multiple options (OR)
curl "http://localhost:3100/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Priority=P0,P1"

# Filter by Status
curl "http://localhost:3100/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Status=In%20progress"
```

### By Relation (Auto Title Resolution)
Pass the human title of the related page; the engine automatically resolves it to the page UUID:
```bash
curl "http://localhost:3100/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Epic=Identity%20%26%20access%20cleanup"
```

### Free Text Search (`q`) Across Properties, Page Body & Comments
```bash
curl "http://localhost:3100/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&q=automated%20checklist"
```

### POST JSON API
```bash
curl -X POST "http://localhost:3100/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "database_id": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "Priority": ["P0", "P1"],
    "Sprint": "Sprint 1",
    "q": "access"
  }'
```

---

## 4. Web UI Features

- **Database Switcher:** Dropdown in the header to switch between any discovered database on the fly.
- **Dynamic Filter Controls:** Form inputs automatically generate according to the selected database's schema (Select / Multi-select / Status with Notion colors and counts, People user pickers, Relation target pickers, Number comparisons, Date selectors, and Checkboxes).
- **Active Filter Chips:** Shows active filters with individual `×` removal and a "Clear all" button.
- **Dynamic Result Cards:** Displays all properties of each result with Notion colors, people avatars, relation links, page body excerpts, and comment threads.
- **Query Inspector:** Collapsible debugger displaying the generated Notion API filter and text search metadata.

---

## 5. Running Tests

```bash
npm test
```

Runs the test suite verifying:
- Database discovery (`listDatabases`)
- Schema and filter options discovery
- Relation target page title resolution
- Generic search query execution across multiple databases
- Comment and page body in-process matching
