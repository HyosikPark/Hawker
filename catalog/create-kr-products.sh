#!/bin/sh
# 한국 공공데이터 상품 3종 개점 스크립트.
# 선행조건: 리포 루트에 .datago.key (공공데이터포털 일반 인증키 Decoding 원문)
# 사용법: sh catalog/create-kr-products.sh [게이트웨이URL(기본 http://localhost:8402)]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GW="${1:-http://localhost:8402}"
KEY_FILE="$ROOT/.datago.key"
TOKEN_FILE="$ROOT/.kr-seller-token.txt"

[ -f "$KEY_FILE" ] || { echo "❌ $KEY_FILE 없음 — 공공데이터포털 인증키를 저장하세요."; exit 1; }
SERVICE_KEY=$(cat "$KEY_FILE" | tr -d '\n')

if [ ! -f "$TOKEN_FILE" ]; then
  curl -s -X POST "$GW/v1/sellers" -H 'content-type: application/json' \
    -d '{"email":"kr-catalog@hawker.dev","name":"Hawker Korea Data"}' \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" > "$TOKEN_FILE"
  echo "판매자 생성 → 토큰 저장: $TOKEN_FILE"
fi
TOKEN=$(cat "$TOKEN_FILE")

create() { # $1=파일명(설명용) / stdin=상품 JSON
  curl -s -X POST "$GW/v1/products" -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' -d @- ; echo
}

echo "--- ① kr-apt-trades: 아파트 매매 실거래가 (국토교통부) ---"
create <<EOF
{
  "slug": "kr-apt-trades",
  "name": "kr-apt-trades",
  "description": "Official Korean apartment sale transaction records (Ministry of Land, MOLIT). Actual prices, not listings — data global models cannot know. Response is XML.",
  "defaultPriceUsdMicros": 5000,
  "upstreamAuth": { "in": "query", "name": "serviceKey", "value": "$SERVICE_KEY" },
  "openapi": {
    "openapi": "3.0.3",
    "info": {"title": "KR Apartment Trades", "version": "1.0.0"},
    "servers": [{"url": "https://apis.data.go.kr"}],
    "paths": {
      "/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade": {
        "get": {
          "operationId": "get_apt_trades",
          "x-hawker": { "responseTransform": "xml-to-json", "responseUnwrap": "response.body" },
          "summary": "Actual apartment sale transactions for a Korean district and month. Returns clean JSON: dealAmount is in 만원 (10,000 KRW units), plus area (m²), floor, dong, apartment name. Use find_district_code (kr-district-codes product) to get LAWD_CD.",
          "parameters": [
            {"name": "LAWD_CD", "in": "query", "required": true, "schema": {"type": "string", "description": "5-digit Korean legal district code. Examples: 11680 Gangnam-gu Seoul, 11110 Jongno-gu Seoul, 41135 Bundang-gu Seongnam, 26350 Haeundae-gu Busan"}},
            {"name": "DEAL_YMD", "in": "query", "required": true, "schema": {"type": "string", "description": "Transaction month, YYYYMM (e.g. 202608)"}},
            {"name": "numOfRows", "in": "query", "schema": {"type": "integer", "description": "Rows per page (default 10, max 1000)"}},
            {"name": "pageNo", "in": "query", "schema": {"type": "integer"}}
          ]
        }
      }
    }
  }
}
EOF

echo "--- ② kr-biz-check: 사업자등록 상태조회 (국세청) ---"
create <<EOF
{
  "slug": "kr-biz-check",
  "name": "kr-biz-check",
  "description": "Verify Korean business registration numbers against the National Tax Service. Returns operating status (active/closed/suspended) and taxation type — essential for KYB on Korean counterparties.",
  "defaultPriceUsdMicros": 3000,
  "upstreamAuth": { "in": "query", "name": "serviceKey", "value": "$SERVICE_KEY" },
  "openapi": {
    "openapi": "3.0.3",
    "info": {"title": "KR Business Registration Check", "version": "1.0.0"},
    "servers": [{"url": "https://api.odcloud.kr"}],
    "paths": {
      "/api/nts-businessman/v1/status": {
        "post": {
          "operationId": "check_business_status",
          "summary": "Check the status of Korean business registration numbers (사업자등록번호). Accepts up to 100 numbers per call.",
          "requestBody": {
            "required": true,
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["b_no"],
                  "properties": {
                    "b_no": {"type": "array", "items": {"type": "string"}, "description": "Business registration numbers, digits only (10 digits each), e.g. [\\"1208800767\\"]"}
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
EOF

echo "--- ③ kr-holidays: 공휴일/특일 정보 (한국천문연구원) ---"
create <<EOF
{
  "slug": "kr-holidays",
  "name": "kr-holidays",
  "description": "Official Korean public holidays including substitute holidays (대체공휴일), from Korea Astronomy and Space Science Institute. Authoritative — substitute holidays change yearly and models get them wrong.",
  "defaultPriceUsdMicros": 1000,
  "upstreamAuth": { "in": "query", "name": "serviceKey", "value": "$SERVICE_KEY" },
  "openapi": {
    "openapi": "3.0.3",
    "info": {"title": "KR Holidays", "version": "1.0.0"},
    "servers": [{"url": "https://apis.data.go.kr"}],
    "paths": {
      "/B090041/openapi/service/SpcdeInfoService/getRestDeInfo": {
        "get": {
          "operationId": "get_holidays",
          "summary": "Official public holidays of South Korea for a given year/month, including substitute holidays.",
          "parameters": [
            {"name": "solYear", "in": "query", "required": true, "schema": {"type": "string", "description": "Year, YYYY"}},
            {"name": "solMonth", "in": "query", "schema": {"type": "string", "description": "Month, MM (01-12); omit for whole year"}},
            {"name": "numOfRows", "in": "query", "schema": {"type": "integer", "description": "Set 100 for a full year"}},
            {"name": "_type", "in": "query", "schema": {"type": "string", "description": "Set to 'json' for JSON response"}}
          ]
        }
      }
    }
  }
}
EOF

echo "--- ④ kr-district-codes: 법정동코드 조회 (무료 미끼 툴, 자체 데이터셋) ---"
create <<EOF
{
  "slug": "kr-district-codes",
  "name": "kr-district-codes",
  "description": "Free lookup of Korean 5-digit district codes (LAWD_CD) needed by kr-apt-trades. Search by Korean or English district name. Seoul covered; more regions coming.",
  "defaultPriceUsdMicros": 0,
  "openapi": {
    "openapi": "3.0.3",
    "info": {"title": "KR District Codes", "version": "1.0.0"},
    "servers": [{"url": "$GW"}],
    "paths": {
      "/datasets/lawd-cd": {
        "get": {
          "operationId": "find_district_code",
          "summary": "Find the 5-digit Korean legal district code (LAWD_CD) by district name, e.g. 'Gangnam' or '강남'. Free. Use the code with kr-apt-trades.get_apt_trades.",
          "parameters": [
            {"name": "q", "in": "query", "required": true, "schema": {"type": "string", "description": "District name in Korean or English, or code prefix"}}
          ]
        }
      }
    }
  }
}
EOF

echo "✅ 완료. tools/list로 확인: curl -X POST $GW/mcp/kr-holidays ..."
