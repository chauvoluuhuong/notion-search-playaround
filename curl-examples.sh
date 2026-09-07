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

# Get full content of a page (all recursive blocks, inline databases, comments, markdown)
# Can pass dashed UUID, 32-hex ID, or full Notion URL
curl -sS "$BASE/api/pages/276800dd-8789-81bc-a8b5-000b0f9f30b9"

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

#==========================================================================
# 04 · Create Pages & Database Items (POST /api/pages)
#==========================================================================

# Create a new item in a database using intuitive schema-matched properties
curl -sS -X POST "$BASE/api/pages" \
  -H 'Content-Type: application/json' \
  -d '{
    "databaseId": "9d483ce4-2747-4ea3-a741-bc9a2bc98c4e",
    "properties": {
      "Story": "Implement Single Sign-On (SSO)",
      "Status": "In progress",
      "Priority": "P1",
      "Estimate (pts)": 5,
      "Due": "2026-09-20"
    },
    "content": "## Implementation Details\n- Configure SAML 2.0 provider\n- Test with Okta and Google Workspace\n- [Documentation](https://notion.so)",
    "icon": "🔐"
  }'

# Create a new item directly using the database-specific endpoint
curl -sS -X POST "$BASE/api/databases/9d483ce4-2747-4ea3-a741-bc9a2bc98c4e/pages" \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Story": "Audit user permissions",
      "Status": "Ready for review",
      "Priority": "P2"
    },
    "icon": "📋"
  }'

# Create a subpage under an existing page
curl -sS -X POST "$BASE/api/pages" \
  -H 'Content-Type: application/json' \
  -d '{
    "pageId": "276800dd-8789-81bc-a8b5-000b0f9f30b9",
    "title": "API Documentation Notes",
    "content": "# API Notes\nThis is a subpage created via the Notion Create API.",
    "icon": "📄"
  }'

#==========================================================================
# 05 · Edit / Update Pages & Items (PATCH /api/pages/:id)
#==========================================================================

# Update properties of an existing item (e.g. status, priority, estimate)
curl -sS -X PATCH "$BASE/api/pages/<PAGE_ID>" \
  -H 'Content-Type: application/json' \
  -d '{
    "properties": {
      "Status": "Done",
      "Priority": "P0",
      "Estimate (pts)": 8
    },
    "appendContent": "- Completed code review and QA testing",
    "icon": "✅"
  }'

# Archive (soft-delete) a page or database item
curl -sS -X DELETE "$BASE/api/pages/<PAGE_ID>"

# Restore an archived page
curl -sS -X PATCH "$BASE/api/pages/<PAGE_ID>" \
  -H 'Content-Type: application/json' \
  -d '{
    "archived": false
  }'
