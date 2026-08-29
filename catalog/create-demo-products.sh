#!/bin/sh
# 초기 데모 상품 3종 (무료 공개 API → 유료 툴). weather는 db seed에 있음.
# 사용법: sh catalog/create-demo-products.sh [게이트웨이URL(기본 http://localhost:8402)]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GW="${1:-http://localhost:8402}"
TOKEN_FILE="$ROOT/.demo-seller-token.$(echo "$GW" | sed 's|[^a-zA-Z0-9]|_|g').txt"

if [ ! -f "$TOKEN_FILE" ]; then
  curl -s -X POST "$GW/v1/sellers" -H 'content-type: application/json' \
    -d '{"email":"demo-catalog@hawker.dev","name":"Hawker Demo"}' \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > "$TOKEN_FILE"
fi
TOKEN=$(cat "$TOKEN_FILE")
create() { curl -s -X POST "$GW/v1/products" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @- ; echo; }

echo "--- fx-rates (환율, Frankfurter/ECB) ---"
create <<'EOF'
{
  "slug": "fx-rates", "name": "fx-rates", "defaultPriceUsdMicros": 2000,
  "description": "Live and historical foreign exchange rates (ECB reference data via Frankfurter). Paid per call.",
  "openapi": {
    "openapi": "3.0.3", "info": {"title": "FX Rates", "version": "1.0.0"},
    "servers": [{"url": "https://api.frankfurter.dev"}],
    "paths": {"/v1/latest": {"get": {"operationId": "get_latest_rates", "summary": "Latest exchange rates for a base currency",
      "parameters": [
        {"name": "base", "in": "query", "required": true, "schema": {"type": "string", "description": "Base currency code, e.g. USD"}},
        {"name": "symbols", "in": "query", "schema": {"type": "string", "description": "Comma-separated targets, e.g. KRW,JPY,EUR"}}
      ]}}}
  }
}
EOF

echo "--- geocode (지명 검색, Open-Meteo) ---"
create <<'EOF'
{
  "slug": "geocode", "name": "geocode", "defaultPriceUsdMicros": 2000,
  "description": "Search places worldwide and get coordinates, timezone, population (Open-Meteo geocoding). Paid per call.",
  "openapi": {
    "openapi": "3.0.3", "info": {"title": "Geocode", "version": "1.0.0"},
    "servers": [{"url": "https://geocoding-api.open-meteo.com"}],
    "paths": {"/v1/search": {"get": {"operationId": "search_places", "summary": "Search for places by name, returns coordinates and metadata",
      "parameters": [
        {"name": "name", "in": "query", "required": true, "schema": {"type": "string", "description": "Place name, e.g. Seoul"}},
        {"name": "count", "in": "query", "schema": {"type": "integer"}},
        {"name": "language", "in": "query", "schema": {"type": "string"}}
      ]}}}
  }
}
EOF

echo "--- wiki-summary (위키 요약, Wikipedia REST) ---"
create <<'EOF'
{
  "slug": "wiki-summary", "name": "wiki-summary", "defaultPriceUsdMicros": 1000,
  "description": "Concise English Wikipedia summaries for any topic — title, extract, thumbnail. Paid per call.",
  "openapi": {
    "openapi": "3.0.3", "info": {"title": "Wiki Summary", "version": "1.0.0"},
    "servers": [{"url": "https://en.wikipedia.org"}],
    "paths": {"/api/rest_v1/page/summary/{title}": {"get": {"operationId": "get_summary", "summary": "Get the lead summary of an English Wikipedia article",
      "parameters": [{"name": "title", "in": "path", "required": true, "schema": {"type": "string", "description": "Article title, e.g. Model_Context_Protocol"}}]}}}
  }
}
EOF
echo "✅ 완료."
