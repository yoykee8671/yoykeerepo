#!/usr/bin/env bash
# v2 → 운영(pay) 데이터 이관.
#
#   scripts/v2-cutover.sh rehearse   # 리허설: 운영 DB '복사본'에 이관해 보고 v2 코드로 띄워 확인한 뒤 지운다.
#                                    #   운영 DB 는 읽기(pg_dump)만 한다. v2 테스트 DB 에는 평소 새벽 합치기와 같은 쓰기를 한 번 한다.
#   V2_CUTOVER_CONFIRM=운영이관 scripts/v2-cutover.sh live
#                                    # 실제 이관: 운영 앱이 멈춘 상태에서 운영 DB 를 바꾼다(대표 승인 후에만).
#
# 이관 규칙
#   - 기본은 v2 DB 전체(app_state + erp_records + erp_files). 새벽 합치기로 운영 데이터가 이미 들어 있고,
#     직전에 한 번 더 합쳐 충돌이 0건일 때만 진행한다.
#   - 운영에서 그대로 유지하는 것: 카페24·클로브 연결(app_state.primary 의 cafe24 / clobe),
#     상품동기화 상태(app_state 'product_sync' 행). v2 는 이것들을 쓰지 않았거나 비워 두었다.
# 되돌리기: 이 스크립트가 처음에 남기는 운영 덤프(prod-before.dump)를 pg_restore 하면 이관 전 그대로.
set -euo pipefail
MODE="${1:-}"
export DOCKER_CONTEXT=colima
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$HOME/.cache/v2data/cutover/$STAMP-$MODE"
PROD_DB=wooofpay-db-1
V2_DB=wooofpay-v2test-db
REH_DB=wooofpay-rehearsal-db
REH_APP=wooofpay-rehearsal-app
REH_NET=wooofpay-rehearsal-net
T0=$(date +%s)
step() { echo "[$(date +%T) +$(( $(date +%s) - T0 ))s] $*"; }
die() { echo "중단: $*" >&2; exit 1; }

case "$MODE" in
  rehearse) ;;
  live) [ "${V2_CUTOVER_CONFIRM:-}" = "운영이관" ] || die "실제 이관은 V2_CUTOVER_CONFIRM=운영이관 을 붙여야 합니다." ;;
  *) die "사용법: scripts/v2-cutover.sh rehearse | live" ;;
esac
umask 077
mkdir -p "$WORK"

prod_sql() { docker exec -i "$PROD_DB" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atq'; }
target_sql() { docker exec -i "$TARGET" psql -U wooofpay -d wooofpay -v ON_ERROR_STOP=1 -Atq; }

if [ "$MODE" = "live" ]; then
  docker ps --format '{{.Names}}' | grep -qx wooofpay-app-1 && die "운영 앱(wooofpay-app-1)을 먼저 멈추세요(새 입력이 생기지 않게)."
fi

step "1. 운영 DB 백업(읽기만)"
docker exec "$PROD_DB" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$WORK/prod-before.dump"
[ -s "$WORK/prod-before.dump" ] || die "운영 백업 실패"
step "   $(du -h "$WORK/prod-before.dump" | cut -f1)"

step "2. 마지막 합치기(운영 → v2)"
"$ROOT/scripts/v2-sync.sh" | tail -1
node -e "const r=require(process.argv[1]); if(!r.ok) {console.error('합치기 실패'); process.exit(1)} if((r.conflicts||[]).length){console.error('충돌 '+r.conflicts.length+'건: 확인 필요에서 먼저 답하세요'); process.exit(1)}" "$HOME/.cache/v2data/sync/last-result.json" \
  || die "합치기 결과가 깨끗하지 않습니다."

step "3. v2 DB 덤프"
docker exec "$V2_DB" pg_dump -U wooofpay -d wooofpay -Fc > "$WORK/v2.dump"
V2_REQ=$(docker exec "$V2_DB" psql -U wooofpay -d wooofpay -Atc "select jsonb_array_length(state->'requests') from app_state where id='primary'")
V2_ERP=$(docker exec "$V2_DB" psql -U wooofpay -d wooofpay -Atc "select count(*) from erp_records")

if [ "$MODE" = "rehearse" ]; then
  step "4. 리허설 DB 만들기(운영 복사본)"
  docker rm -f "$REH_APP" "$REH_DB" >/dev/null 2>&1 || true
  docker network rm "$REH_NET" >/dev/null 2>&1 || true
  docker network create "$REH_NET" >/dev/null
  REH_PW="$(openssl rand -hex 16)"
  docker run -d --name "$REH_DB" --network "$REH_NET" -e POSTGRES_USER=wooofpay -e POSTGRES_DB=wooofpay -e POSTGRES_PASSWORD="$REH_PW" postgres:17 >/dev/null
  for _ in $(seq 1 30); do docker exec "$REH_DB" pg_isready -U wooofpay -d wooofpay >/dev/null 2>&1 && break; sleep 2; done
  sleep 2
  docker exec -i "$REH_DB" pg_restore -U wooofpay -d wooofpay --no-owner < "$WORK/prod-before.dump"
  TARGET="$REH_DB"
else
  TARGET="$PROD_DB"
fi

step "5. 운영에서 유지할 것 따로 두기(카페24·클로브 연결, 상품동기화 상태)"
target_sql <<'SQL'
drop schema if exists cutover_keep cascade;
create schema cutover_keep;
create table cutover_keep.app_state as select * from public.app_state;
SQL
KEEP_SIG=$(target_sql <<'SQL'
select md5(coalesce((select state->'cafe24' from cutover_keep.app_state where id='primary')::text,'') || '|' ||
           coalesce((select state->'clobe' from cutover_keep.app_state where id='primary')::text,'') || '|' ||
           coalesce((select state::text from cutover_keep.app_state where id='product_sync'),''));
SQL
)

step "6. v2 데이터 넣기"
target_sql <<'SQL'
drop schema public cascade;
create schema public;
SQL
docker exec -i "$TARGET" pg_restore -U wooofpay -d wooofpay --no-owner --schema=public < "$WORK/v2.dump"

step "7. 유지할 것 되돌려 놓기"
target_sql <<'SQL'
update public.app_state p
   set state = jsonb_set(jsonb_set(p.state, '{cafe24}', coalesce(k.state->'cafe24', '{}'::jsonb)), '{clobe}', coalesce(k.state->'clobe', '{}'::jsonb)),
       updated_at = now()
  from cutover_keep.app_state k
 where p.id = 'primary' and k.id = 'primary';
delete from public.app_state where id = 'product_sync';
insert into public.app_state select * from cutover_keep.app_state where id = 'product_sync';
SQL

step "8. 확인"
AFTER_SIG=$(target_sql <<'SQL'
select md5(coalesce((select state->'cafe24' from public.app_state where id='primary')::text,'') || '|' ||
           coalesce((select state->'clobe' from public.app_state where id='primary')::text,'') || '|' ||
           coalesce((select state::text from public.app_state where id='product_sync'),''));
SQL
)
T_REQ=$(echo "select jsonb_array_length(state->'requests') from app_state where id='primary'" | target_sql)
T_ERP=$(echo "select count(*) from erp_records" | target_sql)
[ "$KEEP_SIG" = "$AFTER_SIG" ] && echo "   카페24·클로브·상품동기화: 운영 값 유지 ✅" || die "운영 연결 정보가 바뀌었습니다(되돌리기 필요)"
[ "$T_REQ" = "$V2_REQ" ] && echo "   입금요청 ${T_REQ}건 = v2 ✅" || die "입금요청 수가 다릅니다: $T_REQ vs $V2_REQ"
[ "$T_ERP" = "$V2_ERP" ] && echo "   v2 자료(erp) ${T_ERP}건 = v2 ✅" || die "v2 자료 수가 다릅니다: $T_ERP vs $V2_ERP"
echo "drop schema cutover_keep cascade;" | target_sql

if [ "$MODE" = "rehearse" ]; then
  step "9. 리허설 앱 띄워 보기(v2 코드, 127.0.0.1:4175) — 실제 연결은 끊고"
  # 운영 토큰으로 카페24·클로브에 붙으면 운영 연결이 끊길 수 있으므로 리허설 DB 에서는 비운다.
  echo "update app_state set state = jsonb_set(jsonb_set(state,'{cafe24}','{}'::jsonb),'{clobe}','{}'::jsonb) where id='primary';" | target_sql
  docker run -d --name "$REH_APP" --network "$REH_NET" -p 127.0.0.1:4175:4173 \
    -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=4173 -e PRODUCT_SYNC_SCHEDULE=off \
    -e PUBLIC_BASE_URL=http://127.0.0.1:4175 -e CLOBE_TOKEN_SECRET="$(openssl rand -hex 24)" \
    -e DATABASE_URL="postgres://wooofpay:$REH_PW@$REH_DB:5432/wooofpay" wooofpay-app:v2test >/dev/null
  ok=""
  for _ in $(seq 1 40); do curl -sf http://127.0.0.1:4175/api/health >/dev/null && ok=1 && break; sleep 2; done
  [ -n "$ok" ] || { docker logs --tail 30 "$REH_APP"; die "리허설 앱이 뜨지 않았습니다"; }
  echo "   health: $(curl -s http://127.0.0.1:4175/api/health)"
  # 임시 오너로 로그인해 주요 목록을 받아 본다(리허설 DB 에만 만든다).
  PW="$(openssl rand -hex 12)"
  HASH="$(node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.scryptSync(process.argv[1],s,64).toString('hex'))" "$PW")"
  echo "update app_state set state = jsonb_set(state,'{admins}', (state->'admins') || jsonb_build_array(jsonb_build_object('id','admin_rehearsal','name','리허설','email','rehearsal@wooof.local','role','owner','isActive',true,'passwordHash','$HASH'))) where id='primary';" | target_sql
  docker restart "$REH_APP" >/dev/null
  for _ in $(seq 1 40); do curl -sf http://127.0.0.1:4175/api/health >/dev/null && break; sleep 2; done
  JAR="$WORK/jar"
  curl -sf -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"rehearsal@wooof.local\",\"password\":\"$PW\"}" http://127.0.0.1:4175/api/login >/dev/null
  Q="p=/api/requests&p=/api/brands&p=/api/partners&p=/api/payments&p=/api/monthly&p=/api/loans&p=/api/cashflow&p=/api/setup/questions&p=/api/todo&p=/api/closing&p=/api/notices"
  curl -s -b "$JAR" "http://127.0.0.1:4175/api/batch?$Q" | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s).results;let bad=0;
      for(const [p,v] of Object.entries(r)){const d=v.data||{};const n=Object.values(d).find(Array.isArray);
        console.log('   '+(v.status<400?'✅':'❌')+' '+p+' '+v.status+(n?' ('+n.length+'건)':''));if(v.status>=400)bad++;}
      process.exit(bad?1:0)})" || die "리허설 앱 화면 데이터에 오류가 있습니다"
  step "10. 리허설 정리(컨테이너·덤프 삭제)"
  docker rm -f "$REH_APP" "$REH_DB" >/dev/null
  docker network rm "$REH_NET" >/dev/null
  rm -f "$WORK/v2.dump" "$WORK/prod-before.dump" "$JAR"
  step "리허설 끝: 데이터 이관 $(( $(date +%s) - T0 ))초. 운영 DB 는 읽기만 했습니다."
else
  step "이관 끝. 다음: 운영 빌드 폴더에서 v2 코드로 빌드·실행(docs/v2/cutover.md 3단계)."
  echo "   되돌리기 덤프: $WORK/prod-before.dump"
fi
