#!/usr/bin/env bash
# v2 테스트 사이트(v2.gnuol.com → 127.0.0.1:4174)를 올린다.
#
#   scripts/v2test-up.sh            # 지금 코드로 다시 빌드해 올린다(데이터는 그대로)
#   scripts/v2test-up.sh --reset    # 운영 DB 를 새로 복사해 오고 v2 자료를 다시 넣는다
#   scripts/v2test-up.sh --overrides  # 데이터는 그대로 두고 등록 제안·대출/브랜드 고침·회생계획표만 다시 적용
#
# 운영(4173)은 건드리지 않는다. 복사본의 클로브·카페24 토큰은 비운다.
# 비밀값은 ~/.cache/v2data/v2test.env (권한 600)에만 둔다.
set -euo pipefail
export DOCKER_CONTEXT=colima
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/deploy/v2test/docker-compose.yml" --env-file "$HOME/.cache/v2data/v2test.env")
DATA="$HOME/.cache/v2data"
BASE="http://127.0.0.1:4174"

mkdir -p "$DATA"
if [ ! -f "$DATA/v2test.env" ]; then
  umask 077
  printf 'V2TEST_DB_PASSWORD=%s\nV2TEST_CLOBE_SECRET=%s\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 24)" > "$DATA/v2test.env"
fi

"${COMPOSE[@]}" up -d --build db app
psql_test() { docker exec -i wooofpay-v2test-db psql -U wooofpay -d wooofpay -Atq "$@"; }
for _ in $(seq 1 30); do psql_test -c "select 1" >/dev/null 2>&1 && break; sleep 2; done

seed_login() {
  echo "[v2test] 임시 오너 계정으로 로그인"
  PW="$(openssl rand -hex 12)"
  HASH="$(node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" "$PW")"
  psql_test -c "update app_state set state = jsonb_set(state,'{admins}', (state->'admins') || jsonb_build_array(jsonb_build_object('id','admin_v2seed','name','v2 자료 넣기','email','v2seed@wooof.local','role','owner','isActive',true,'passwordHash','$HASH'))) where id='primary'"
  docker restart wooofpay-v2test-app >/dev/null
  for _ in $(seq 1 30); do curl -sf "$BASE/api/health" >/dev/null && break; sleep 2; done
  JAR="$(mktemp)"
  trap 'rm -f "$JAR"' EXIT
  curl -sf -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"v2seed@wooof.local\",\"password\":\"$PW\"}" "$BASE/api/login" >/dev/null
  post() {
    local body="${2:-}"
    [ -n "$body" ] || body='{}'
    echo "  $1: $(curl -s -b "$JAR" -X POST -H 'content-type: application/json' --data "$body" "$BASE$1" | head -c 160)"
  }
}
apply_overrides() {
  # 대표가 정해 준 대출 고침(예: 대위변제로 회생채권에 들어간 대출). 시트에 없는 사실이라 따로 둔다.
  if [ -f "$DATA/loan/overrides.json" ]; then
    curl -s -b "$JAR" "$BASE/api/loans" > "$DATA/.loans.json"
    node -e "
      const fs=require('fs');const d=process.argv[1];
      const loans=JSON.parse(fs.readFileSync(d+'/.loans.json','utf8')).loans||[];
      for (const o of JSON.parse(fs.readFileSync(d+'/loan/overrides.json','utf8')))
        for (const l of loans.filter((x)=>Object.entries(o.match).every(([k,v])=>String(x[k]||'')===v)))
          console.log(encodeURIComponent(l.id)+'\t'+JSON.stringify(o.set));" "$DATA" > "$DATA/.loan-overrides.tsv"
    while IFS=$'\t' read -r lid body; do
      echo "  loan $lid: $(curl -s -b "$JAR" -X PUT -H 'content-type: application/json' --data "$body" "$BASE/api/loans/item/$lid" | head -c 80)"
    done < "$DATA/.loan-overrides.tsv"
    rm -f "$DATA/.loans.json" "$DATA/.loan-overrides.tsv"
  fi
}
apply_brand_overrides() {
  # 대표가 정해 준 브랜드 채권 구분(회생채권/별도 변제/현금변제만/채권자 아님 등).
  if [ -f "$DATA/brand-overrides.json" ]; then
    curl -s -b "$JAR" "$BASE/api/brands" > "$DATA/.brands.json"
    node -e "
      const fs=require('fs');const d=process.argv[1];
      const brands=JSON.parse(fs.readFileSync(d+'/.brands.json','utf8')).brands||[];
      for (const o of JSON.parse(fs.readFileSync(d+'/brand-overrides.json','utf8'))) {
        const b=brands.find((x)=>x.name===o.name);
        if (b) console.log(b.id+'\t'+JSON.stringify(o.set)); else console.error('  (없는 브랜드) '+o.name);
      }" "$DATA" > "$DATA/.brand-overrides.tsv"
    while IFS=$'\t' read -r bid body; do
      echo "  brand $bid: $(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X PUT -H 'content-type: application/json' --data "$body" "$BASE/api/brands/$bid")"
    done < "$DATA/.brand-overrides.tsv"
    rm -f "$DATA/.brands.json" "$DATA/.brand-overrides.tsv"
  fi
}
seed_cleanup() {
  # 임시 오너는 지운다(기록은 이력에 'v2 자료 넣기'로 남는다).
  psql_test -c "update app_state set state = jsonb_set(state,'{admins}', (select coalesce(jsonb_agg(a),'[]'::jsonb) from jsonb_array_elements(state->'admins') a where a->>'id' <> 'admin_v2seed')) where id='primary'"
  docker restart wooofpay-v2test-app >/dev/null
}

if [ "${1:-}" = "--reset" ]; then
  # 대표가 v2 에 직접 넣은 자료(계좌 연결·확인 필요 답·현금흐름표 등)까지 모두 지워진다.
  if [ "${V2TEST_RESET_CONFIRM:-}" != "지워도됨" ]; then
    echo "[v2test] --reset 은 v2 에 넣은 자료를 모두 지웁니다. 정말이면 V2TEST_RESET_CONFIRM=지워도됨 을 붙여 다시 실행하세요." >&2
    exit 1
  fi
  echo "[v2test] 운영 DB 복사"
  docker stop wooofpay-v2test-app >/dev/null
  psql_test -c "drop schema public cascade; create schema public;"
  docker exec wooofpay-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    | docker exec -i wooofpay-v2test-db pg_restore -U wooofpay -d wooofpay --no-owner
  psql_test -c "update app_state set state = jsonb_set(jsonb_set(state,'{clobe}','{}'::jsonb),'{cafe24}','{}'::jsonb) where id='primary'"
  docker start wooofpay-v2test-app >/dev/null
  for _ in $(seq 1 30); do curl -sf "$BASE/api/health" >/dev/null && break; sleep 2; done

  seed_login
  post /api/production/import-sheet
  post /api/loans/import-sheet
  post /api/monthly/import-sheet
  post /api/pricing/seed
  if [ -f "$DATA/ledger_rows.json" ] && [ -f "$DATA/claims_final.json" ]; then
    node -e "
      const fs=require('fs');const d=process.argv[1];
      const tabs=JSON.parse(fs.readFileSync(d+'/ledger_rows.json','utf8'));
      const creditors=JSON.parse(fs.readFileSync(d+'/claims_final.json','utf8')).rows.filter((r)=>String(r.cat||'').startsWith('상거래'));
      fs.writeFileSync(d+'/.migration-body.json',JSON.stringify({tabs,creditors}));" "$DATA"
    post /api/setup/migration/run "@$DATA/.migration-body.json"
    rm -f "$DATA/.migration-body.json"
  fi
  [ -f "$DATA/ar/proposals.json" ] && post /api/setup/proposals "@$DATA/ar/proposals.json"
  apply_overrides
  apply_brand_overrides
  post /api/rehab/import-sheet
  post /api/cashflow/import-sheet
  seed_cleanup
fi

if [ "${1:-}" = "--overrides" ]; then
  seed_login
  [ -f "$DATA/ar/proposals.json" ] && post /api/setup/proposals "@$DATA/ar/proposals.json"
  post /api/loans/import-sheet
  apply_overrides
  apply_brand_overrides
  post /api/rehab/import-sheet
  post /api/cashflow/import-sheet
  seed_cleanup
fi

for _ in $(seq 1 30); do curl -sf "$BASE/api/health" >/dev/null && break; sleep 2; done
echo "[v2test] $(curl -s "$BASE/api/health") → $BASE (https://v2.gnuol.com)"
