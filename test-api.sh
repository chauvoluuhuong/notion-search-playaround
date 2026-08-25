#!/usr/bin/env bash
#
# Smoke-test / examples for the notion-search API.
#
#   ./test-api.sh              # summary line per request
#   RAW=1 ./test-api.sh        # full JSON for every request
#   BASE=http://host:port ./test-api.sh
#   ./test-api.sh filters      # only run cases whose label matches "filters"
#
set -uo pipefail

BASE="${BASE:-http://localhost:3100}"
RAW="${RAW:-0}"
ONLY="${1:-}"

if [ -t 1 ]; then B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; RED=$'\033[31m'; CYA=$'\033[36m'; N=$'\033[0m'
else B=''; DIM=''; GRN=''; RED=''; CYA=''; N=''; fi

PASS=0; FAIL=0

pretty() { python3 -m json.tool 2>/dev/null || cat; }

# One-line digest of a response; falls back to raw text if it is not JSON.
# Kept in a variable so `python3 -c` still reads the piped response on stdin.
read -r -d '' PY_SUMMARIZE <<'PY' || true
import json,sys
raw=sys.stdin.read()
try: d=json.loads(raw)
except Exception:
    print("non-JSON:", raw[:200]); sys.exit(0)

if isinstance(d,dict) and "results" in d and "total" in d:
    print(f"total={d['total']}  returned={d['count']}  has_more={d['has_more']}  next={d['next_cursor']}")
    if d.get("notice"): print(f"notice: {d['notice']}")
    tm=d.get("text_matching")
    if tm and tm.get("page_content"):
        print(f"page bodies indexed: {tm['page_content']['pages_indexed']} (matched in-process)")
    for r in d["results"][:3]:
        who=", ".join(a["label"] for a in r["assignees"]) or "-"
        spr=", ".join(s["label"] for s in r["sprint"]) or "-"
        print(f"#{r['task_id']:<4} {r['task_name'][:50]:<50} [{who} | {spr}]")
        if r.get("matched_fields"): print(f"     matched: {', '.join(r['matched_fields'])}")
        if r.get("page_content"):   print(f"     body:    {r['page_content'][:105]}")
    if len(d["results"])>3: print(f"... {len(d['results'])-3} more in this response")
elif isinstance(d,dict) and "filters" in d:
    print(f"database: {d['database']['name']}   rows scanned: {d['rows_scanned_for_values']}")
    for f in d["filters"]:
        print(f"{f['field']:<9} -> {f['notion_property']:<10} ({f['notion_type']})  {len(f['values'])} values")
        for v in f["values"][:4]:
            print(f"     {v['label'][:36]:<36} {v['id']}  tasks={v['task_count']}")
    print("text fields: " + ", ".join(x["key"] for x in d["text_search"]["fields"]))
elif isinstance(d,dict) and "assignees" in d:
    print(f"assignees={len(d['assignees'])}  sprints={len(d['sprints'])}  "
          f"statuses={len(d['statuses'])}  priorities={len(d['priorities'])}")
else:
    print(json.dumps(d)[:300])
PY

summarize() { python3 -c "$PY_SUMMARIZE"; }

# case <label> <method> <path> [json-body]
case_() {
  local label="$1" method="$2" path="$3" body="${4:-}"
  # case-insensitive label match (macOS ships bash 3.2, so no ${var,,})
  if [ -n "$ONLY" ]; then
    local l o
    l=$(printf '%s' "$label" | tr '[:upper:]' '[:lower:]')
    o=$(printf '%s' "$ONLY"  | tr '[:upper:]' '[:lower:]')
    case "$l" in *"$o"*) ;; *) return 0 ;; esac
  fi

  local url="$BASE$path" out code
  if [ "$method" = POST ]; then
    printf '%s\n' "${B}▸ $label${N}"
    printf '%s\n' "${DIM}  curl -sS -X POST '$url' -H 'Content-Type: application/json' -d '$body'${N}"
    out=$(curl -sS -w $'\n%{http_code}' -X POST "$url" -H 'Content-Type: application/json' -d "$body" 2>&1)
  else
    printf '%s\n' "${B}▸ $label${N}"
    printf '%s\n' "${DIM}  curl -sS '$url'${N}"
    out=$(curl -sS -w $'\n%{http_code}' "$url" 2>&1)
  fi

  code="${out##*$'\n'}"
  out="${out%$'\n'*}"

  if [ "$code" = 200 ]; then printf '  %s\n' "${GRN}HTTP $code${N}"; PASS=$((PASS+1))
  else printf '  %s\n' "${RED}HTTP $code${N}"; FAIL=$((FAIL+1)); fi

  if [ "$RAW" = 1 ]; then printf '%s\n' "$out" | pretty | sed 's/^/  /'
  else printf '%s' "$out" | summarize | sed 's/^/  /'; fi
  echo
}

printf '%s\n\n' "${CYA}notion-search API — $BASE${N}"

if ! curl -sS -o /dev/null --max-time 5 "$BASE/api/health" 2>/dev/null; then
  printf '%s\n' "${RED}Server not reachable at $BASE — start it with: npm start${N}"; exit 1
fi

# ---------------------------------------------------------------- basics
case_ "health"                       GET "/api/health"
case_ "options — dropdown values"    GET "/api/options"

# ------------------------------------------- the filter instruction API
case_ "filters — capabilities and allowed values for assignee + sprint" \
                                     GET "/api/filters"

# ---------------------------------------------------------------- search
case_ "search — no params (everything)" \
                                     GET "/api/search?page_size=3"

case_ "search — free text across all default fields" \
                                     GET "/api/search?q=supplier&page_size=3"

case_ "search — text that lives in the PAGE BODY only" \
                                     GET "/api/search?q=not-found%20response"

case_ "search — same term, page_content disabled (proves Notion alone cannot find it)" \
                                     GET "/api/search?q=not-found%20response&fields=summary,description,assignee,sprint,task_name,story_id,dependencies"

case_ "search — restrict text to Summary + Description" \
                                     GET "/api/search?q=order&fields=summary,description&page_size=3"

# --------------------------------------------------------------- filters
case_ "search — assignee by partial name" \
                                     GET "/api/search?assignee=Lucas&page_size=3"

case_ "search — two sprints at once (OR)" \
                                     GET "/api/search?sprint=Sprint%201,Sprint%202&page_size=3"

case_ "search — unassigned AND no sprint" \
                                     GET "/api/search?assignee=none&sprint=none&page_size=3"

case_ "search — status + priority" \
                                     GET "/api/search?status=Dev%20Completed&priority=P0%20-%20Critical&page_size=3"

case_ "search — everything combined (AND across params)" \
                                     GET "/api/search?q=order&assignee=Lucas&sprint=Sprint%201&status=Backlog&page_size=3"

# ------------------------------------------------------------ pagination
case_ "search — page 1 of 5" \
                                     GET "/api/search?page_size=5"
case_ "search — page 2 of 5 (offset from next_cursor)" \
                                     GET "/api/search?page_size=5&offset=5"

# ------------------------------------------------------------------ POST
case_ "search — POST with a JSON body" \
                                     POST "/api/search" \
                                     '{"q":"barcode","sprint":["Sprint 1"],"page_size":3}'

# --------------------------------------------------------- error handling
case_ "search — unknown assignee (returns a notice, not a crash)" \
                                     GET "/api/search?assignee=nobody-here"

printf '%s\n' "${B}$PASS ok, $FAIL failed${N}"
[ "$FAIL" -eq 0 ]
