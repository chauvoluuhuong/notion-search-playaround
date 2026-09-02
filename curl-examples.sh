#!/usr/bin/env bash
# Notion Universal Search & Filter API — curl examples
#
# Postman: Import > Raw text, paste ONE command, Continue.
#

BASE="${BASE:-http://localhost:3100}"

#==========================================================================
# 01 · Database Discovery & Schema
#==========================================================================

# Discover all Notion databases shared with the integration
curl -sS "$BASE/api/databases"

# Force a refresh of the database discovery cache
curl -sS "$BASE/api/databases?refresh=1"

# Get dynamic filter capabilities for the default database
curl -sS "$BASE/api/filter-instructions"
curl -sS "$BASE/api/filters"

# Get dynamic filter instructions for a specific database (by ID in path or query)
# e.g., IT User Stories: 9d483ce4-2747-4ea3-a741-bc9a2bc98c4e
curl -sS "$BASE/api/filter-instructions/9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"
curl -sS "$BASE/api/filters?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"

# Get options and dropdown values for a specific database
curl -sS "$BASE/api/options?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e"

# Health check
curl -sS "$BASE/api/health"

#==========================================================================
# 02 · Dynamic Property Filtering
#==========================================================================

# Filter by Select property (e.g. Priority=P0)
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Priority=P0"

# Filter by multiple Select options (OR)
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Priority=P0,P1"

# Filter by Status (e.g. In progress)
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Status=In%20progress"

# Filter by Relation title (auto-resolved to target page ID)
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Epic=Identity%20%26%20access%20cleanup"

# Filter by Multi-select Assignee
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Assignee=Alex"

# Filter IT Epics by Status
curl -sS "$BASE/api/search?database_id=bdaec82f-2142-4cf9-a017-ba7b47678e6c&Status=Planned"

# Combined filters (Status + Priority + Relation)
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&Priority=P0&Sprint=Sprint%201"

#==========================================================================
# 03 · Free Text Search & In-Process Content Matching
#==========================================================================

# Free text search across title and text properties
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&q=checklist"

# Search in specific fields
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&q=access&fields=story,description"

# Search page bodies and comments
curl -sS "$BASE/api/search?database_id=9d483ce4-2747-4ea3-a741-bc9a2bc98c4e&q=MFA&fields=page_content,comment"

#==========================================================================
# 04 · POST JSON Search API
#==========================================================================

curl -sS -X POST "$BASE/api/search" \
  -H 'Content-Type: application/json' \
  -d '{
    "database_id": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "Priority": ["P0", "P1"],
    "Sprint": "Sprint 1",
    "q": "access"
  }'
