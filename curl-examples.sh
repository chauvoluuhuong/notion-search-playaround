#!/usr/bin/env bash
# Universal Search & Filter API — curl examples
#
# Postman: Import > Raw text, paste ONE command, Continue.
#

BASE="${BASE:-http://localhost:3100}"

#==========================================================================
# 01 · Resource Discovery & Deep Content Retrieval
#==========================================================================

# Discover all workspace resources (pages and databases)
curl -sS "$BASE/api/resources"

# Discover pages only
curl -sS "$BASE/api/resources?type=page"

# Discover databases only
curl -sS "$BASE/api/resources?type=database"

# Search resources by title keyword
curl -sS "$BASE/api/resources?q=Basics"

# Get full content of a page (including nested blocks, inline databases, markdown)
# Can pass dashed UUID, 32-hex ID, or full Notion URL
curl -sS "$BASE/api/pages/276800dd-8789-81bc-a8b5-000b0f9f30b9"

# Get full content including comments
curl -sS "$BASE/api/pages/276800dd-8789-81bc-a8b5-000b0f9f30b9?include_comments=1"

#==========================================================================
# 02 · Database Discovery & Filter Instructions
#==========================================================================

# Discover all databases shared with the integration
curl -sS "$BASE/api/databases"

# Force a refresh of the database discovery cache
curl -sS "$BASE/api/databases?refresh=1"

# Get dynamic filter instructions (for AI agents and clients)
curl -sS "$BASE/api/filter-instructions"

# Get dynamic filter instructions for a specific database (by ID)
# e.g., IT User Stories: 9d483ce4-2747-4ea3-a741-bc9a2bc98c4e
curl -sS "$BASE/api/filter-instructions/9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"

# Get dropdown option values for frontend select controls
curl -sS "$BASE/api/options?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"

# Health check
curl -sS "$BASE/api/health"

#==========================================================================
# 03 · POST Search API (searchText + filter)
#==========================================================================

# Free text search across all fields, page body, and comments
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "searchText": "access",
    "pageSize": 5
  }'

# Filter by single field (e.g. Priority = P0)
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "filter": {
      "Priority": "P0"
    }
  }'

# Filter with multiple OR values for a field
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "filter": {
      "Priority": ["P0", "P1"]
    }
  }'

# Filter by relation title (automatically resolved)
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "filter": {
      "Epic": "Identity & access cleanup"
    }
  }'

# Combined: free text search (searchText) + multiple filters
curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "searchText": "access",
    "filter": {
      "Priority": ["P0", "P1"],
      "Status": "In progress"
    },
    "pageSize": 10,
    "offset": 0
  }'
