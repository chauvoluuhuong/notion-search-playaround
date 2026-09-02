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
| Resource Discovery (Pages & Databases) | `GET /api/resources` (supports `?type=page`, `?type=database`, `?q=...`) |
| Deep Page Content & Inline DBs | `GET /api/pages/:id` or `GET /api/resources/:id/content` |
| Database Discovery | `GET /api/databases` |
| Filter Instructions / Capabilities | `GET /api/filter-instructions/:id` or `GET /api/filter-instructions` |
| Filter Capability & Schema API | `GET /api/filters/:id` or `GET /api/filters?database_id=<id>` |
| Dropdown & Option Values | `GET /api/options?database_id=<id>` |
| Universal Search & Filter API | `POST /api/search` |

---

## 1. Resource Discovery (`GET /api/resources`)

Discovers all pages and databases accessible to your Notion integration token:

```bash
# List all resources (pages and databases)
curl -s http://localhost:3100/api/resources

# Filter by type
curl -s "http://localhost:3100/api/resources?type=page"
curl -s "http://localhost:3100/api/resources?type=database"
```

Example response:
```json
{
  "resources": [
    {
      "id": "276800dd-8789-81bc-a8b5-000b0f9f30b9",
      "type": "page",
      "title": "The Notion Basics",
      "url": "https://app.notion.com/276800dd878981bca8b5000b0f9f30b9",
      "is_inline": false,
      "properties_count": 1
    },
    {
      "id": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
      "type": "database",
      "title": "IT Epics",
      "url": "https://app.notion.com/bdaec82f21424cf9a017ba7b47678e6c",
      "is_inline": false,
      "properties_count": 6
    }
  ],
  "count": 2,
  "pages_count": 1,
  "databases_count": 1
}
```

---

## 2. Deep Page Content & Inline Databases (`GET /api/pages/:id`)

Fetches the complete content of a page (or database), recursively traversing block trees, detecting inline databases (`child_database`), querying their records, and converting everything into clean **Markdown** and structured **JSON**:

```bash
# Get page content by ID, raw 32-hex, or Notion URL
curl -s http://localhost:3100/api/pages/276800dd-8789-81bc-a8b5-000b0f9f30b9

# Include unresolved comments
curl -s "http://localhost:3100/api/pages/276800dd-8789-81bc-a8b5-000b0f9f30b9?include_comments=1"
```

Example response:
```json
{
  "id": "276800dd-8789-81bc-a8b5-000b0f9f30b9",
  "type": "page",
  "title": "The Notion Basics",
  "properties": {},
  "markdown": "# The Notion Basics\n\nWelcome to Notion!\n\n### Tasks (Inline Database)\n| Task | Status | Assignee |\n| :--- | :--- | :--- |\n| Setup repo | Done | Huong |\n",
  "inline_databases": [
    {
      "id": "inline-db-uuid",
      "title": "Tasks",
      "columns": ["Task", "Status", "Assignee"],
      "row_count": 1,
      "rows": [...]
    }
  ],
  "blocks_count": 12,
  "inline_databases_count": 1
}
```

---

## 3. Database Discovery (`GET /api/databases`)

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

## 4. Schema Discovery & Filter Instructions (`GET /api/filter-instructions/:id`)

Returns a simple, self-describing capability document tailored for AI Agents and API clients, detailing:
- Available fields and their accepted values / formats
- `how_to_search` body format for `POST /api/search`
- Example request payloads

```json
{
  "database": {
    "id": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
    "name": "IT Epics"
  },
  "how_to_search": {
    "method": "POST",
    "endpoint": "/api/search",
    "body_format": {
      "databaseId": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
      "searchText": "Case-insensitive search across all fields, page body, and comments",
      "filter": "Map of field names to values. Pass an array of values to match any (OR).",
      "pageSize": 25,
      "offset": 0
    }
  },
  "filters": {
    "Owner": {
      "type": "array of values",
      "accepted_values": ["chauvoluuhuong", "huong", "none"]
    },
    "Goal": {
      "type": "free text"
    },
    "Status": {
      "type": "array of values",
      "accepted_values": ["Planned", "In progress", "Done", "none"]
    },
    "Start": {
      "type": "date (YYYY-MM-DD or relative keyword)",
      "accepted_values": ["YYYY-MM-DD", "past_week", "this_week", "next_week", "past_month"]
    },
    "Epic": {
      "type": "free text"
    }
  },
  "examples": [
    {
      "description": "Free text search across all fields",
      "request": {
        "databaseId": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
        "searchText": "access"
      }
    },
    {
      "description": "Filter by Status",
      "request": {
        "databaseId": "bdaec82f-2142-4cf9-a017-ba7b47678e6c",
        "filter": {
          "Status": "Planned"
        }
      }
    }
  ]
}
```

```bash
curl "http://localhost:3100/api/filter-instructions/9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"
```

---

## 5. Universal Search & Filtering (`POST /api/search`)

The search endpoint accepts a JSON object with:
- `databaseId`: Database ID or title (optional if using default database)
- `searchText`: Case-insensitive text search across all fields, page content, and comments
- `filter`: Object mapping field names to value(s) (multiple values for a field are OR-ed)
- `pageSize`: Number of results (default: 25)
- `offset`: Pagination offset (default: 0)

### Free Text Search (`searchText`)
```bash
curl -X POST "http://localhost:3100/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "searchText": "access"
  }'
```

### Structured Filtering (`filter`)
```bash
# Filter by Priority and Status
curl -X POST "http://localhost:3100/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "filter": {
      "Priority": ["P0", "P1"],
      "Status": "In progress"
    }
  }'
```

### Combined Search and Filter (`searchText` + `filter`)
```bash
curl -X POST "http://localhost:3100/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "searchText": "access",
    "filter": {
      "Priority": ["P0", "P1"],
      "Sprint": "Sprint 1",
      "Epic": "Identity & access cleanup"
    },
    "pageSize": 10
  }'
```

---

## 6. Web UI Features

- **Database Switcher:** Dropdown in the header to switch between any discovered database on the fly.
- **Dynamic Filter Controls:** Form inputs automatically generate according to the selected database's schema (Select / Multi-select / Status with Notion colors and counts, People user pickers, Relation target pickers, Number comparisons, Date selectors, and Checkboxes).
- **Active Filter Chips:** Shows active filters with individual `×` removal and a "Clear all" button.
- **Dynamic Result Cards:** Displays all properties of each result with Notion colors, people avatars, relation links, page body excerpts, and comment threads.
- **Query Inspector:** Collapsible debugger displaying the generated Notion API filter and text search metadata.

---

## 7. Running Tests

```bash
npm test
```

Runs the test suite verifying:
- Resource discovery & type filtering (`listResources`)
- Single page & inline database content extraction (`getResourceContent`)
- Database discovery (`listDatabases`)
- Schema and filter options discovery
- Relation target page title resolution
- Generic search query execution across multiple databases
- Comment and page body in-process matching
