#!/usr/bin/env bash
# v2 테스트 사이트(v2.gnuol.com → 127.0.0.1:4174)를 올린다.
#
#   scripts/v2test-up.sh            # 지금 코드로 다시 빌드해 올린다(데이터는 그대로)
#   scripts/v2test-up.sh --reset    # 운영 DB 를 새로 복사해 오고 v2 자료를 다시 넣는다
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

if [ "${1:-}" = "--reset" ]; then
  echo "[v2test] 운영 DB 복사"
  docker stop wooofpay-v2test-app >/dev/null
  psql_test -c "drop schema public cascade; create schema public;"
  docker exec wooofpay-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    | docker exec -i wooofpay-v2test-db pg_restore -U wooofpay -d wooofpay --no-owner
  psql_test -c "update app_state set state = jsonb_set(jsonb_set(state,'{clobe}','{}'::jsonb),'{cafe24}','{}'::jsonb) where id='primary'"
  docker start wooofpay-v2test-app >/dev/null
  for _ in $(seq 1 30); do curl -sf "$BASE/api/health" >/dev/null && break; sleep 2; done

  echo "[v2test] v2 자료 넣기(임시 오너 계정으로)"
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
  # 임시 오너는 지운다(기록은 이력에 'v2 자료 넣기'로 남는다).
  psql_test -c "update app_state set state = jsonb_set(state,'{admins}', (select coalesce(jsonb_agg(a),'[]'::jsonb) from jsonb_array_elements(state->'admins') a where a->>'id' <> 'admin_v2seed')) where id='primary'"
  docker restart wooofpay-v2test-app >/dev/null
fi

for _ in $(seq 1 30); do curl -sf "$BASE/api/health" >/dev/null && break; sleep 2; done
echo "[v2test] $(curl -s "$BASE/api/health") → $BASE (https://v2.gnuol.com)"
