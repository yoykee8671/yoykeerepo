#!/usr/bin/env bash
# 운영(pay) → v2 테스트 하루 한 번 합치기. 운영 DB 는 읽기만 한다.
#
#   scripts/v2-sync.sh            # 합쳐서 v2 에 저장
#   scripts/v2-sync.sh --dry-run  # 무엇이 바뀌는지만 본다
#
# 기준점(base): ~/.cache/v2data/sync/base.json = 지난번 합칠 때의 운영 상태.
# 처음에는 v2 를 운영에서 복사하기 직전 백업(2026-11-14 09:00)으로 만든다.
# LaunchAgent com.yoykee.wooofpay-v2sync 가 매일 새벽 4시 10분에 부른다.
set -euo pipefail
export DOCKER_CONTEXT=colima
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$HOME/.cache/v2data/sync"
BACKUPS="$HOME/project/dev/yoykeerepo/deploy/macmini/backups/daily"
FIRST_BASE="$BACKUPS/wooofpay-20261114.sql.gz"
mkdir -p "$DIR"
chmod 700 "$DIR"
umask 077
log() { echo "$(date '+%F %T') $*"; }

if [ ! -s "$DIR/base.json" ]; then
  log "기준점 만들기: $(basename "$FIRST_BASE")"
  docker exec wooofpay-v2test-db sh -c 'dropdb -U wooofpay --if-exists v2syncbase && createdb -U wooofpay v2syncbase'
  gunzip -c "$FIRST_BASE" | docker exec -i wooofpay-v2test-db psql -U wooofpay -d v2syncbase -q >/dev/null 2>&1 || true
  docker exec wooofpay-v2test-db psql -U wooofpay -d v2syncbase -Atc "select state from app_state where id='primary'" > "$DIR/base.json.tmp"
  docker exec wooofpay-v2test-db dropdb -U wooofpay v2syncbase
  [ -s "$DIR/base.json.tmp" ] || { log "기준점을 만들지 못함"; exit 1; }
  mv "$DIR/base.json.tmp" "$DIR/base.json"
fi

docker exec wooofpay-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select state from app_state where id='"'"'primary'"'"'"' > "$DIR/prod.json.tmp"
[ -s "$DIR/prod.json.tmp" ] || { log "운영 상태를 읽지 못함"; exit 1; }

if [ "${1:-}" != "--dry-run" ]; then
  # 되돌릴 수 있게 합치기 전 v2 상태를 남긴다(7일치).
  docker exec wooofpay-v2test-db psql -U wooofpay -d wooofpay -Atc "select state from app_state where id='primary'" | gzip > "$DIR/v2-before-$(date +%Y%m%d-%H%M).json.gz"
  ls -1t "$DIR"/v2-before-*.json.gz | tail -n +8 | while read -r f; do rm -f -- "$f"; done
fi

node -e "
  const fs=require('fs');const d=process.argv[1];
  process.stdout.write(JSON.stringify({base:JSON.parse(fs.readFileSync(d+'/base.json','utf8')),prod:JSON.parse(fs.readFileSync(d+'/prod.json.tmp','utf8'))}));" "$DIR" \
  | docker exec -i wooofpay-v2test-app node scripts/v2-sync-apply.mjs "$@" > "$DIR/last-result.json"
RESULT="$(cat "$DIR/last-result.json")"
log "$RESULT"

if [ "${1:-}" != "--dry-run" ] && echo "$RESULT" | grep -q '"ok":true'; then
  # 다음 기준점 = 이번 운영 상태. v2 앱은 상태를 메모리에 잠깐 들고 있으므로 다시 띄운다.
  mv "$DIR/prod.json.tmp" "$DIR/base.json"
  if echo "$RESULT" | grep -q '"written":true'; then docker restart wooofpay-v2test-app >/dev/null; fi
else
  rm -f "$DIR/prod.json.tmp"
fi
