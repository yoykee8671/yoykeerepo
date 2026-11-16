# v2 → pay(운영) 이관 절차

리허설: `scripts/v2-cutover.sh rehearse` (운영 DB 복사본에 이관 → v2 코드로 띄워 주요 화면 확인 → 삭제).
2026-11-17 리허설: 데이터 이관 16초, 카페24·클로브·상품동기화 운영 값 유지 확인, 주요 API 11개 정상.

## 0. 미리 (대표 확인 후)
- `docs/v2/pending-decisions.md` 정리, v2 에서 연습으로 만든 기록 정리(결제 로그 등).
- 확인 필요의 `sync-conflict`(pay·v2 충돌) 질문이 0건인지.
- 직원 공지: 퇴근 뒤 30~60분 pay 사용 중지.

## 1. 코드 준비 (pay 는 계속 돌아가는 중, 멈춤 없음)
```bash
# ~/project/wooofpay: v2 → main PR, squash merge (main 직접 커밋 금지)
# 운영 빌드 폴더
cd ~/project/dev/yoykeerepo
git fetch origin && git checkout macmini-deploy && git merge --no-ff origin/main
cd deploy/macmini
export DOCKER_CONTEXT=colima
docker tag wooofpay-app:latest wooofpay-app:pre-v2   # 되돌리기용 지금 이미지
docker compose build app                              # 새 이미지(아직 안 띄움)
```

## 2. 멈춤 → 데이터 이관 (약 1분)
```bash
cd ~/project/dev/yoykeerepo/deploy/macmini && docker compose stop app
cd ~/project/wooofpay && V2_CUTOVER_CONFIRM=운영이관 scripts/v2-cutover.sh live
```
- 스크립트가 하는 일: 운영 DB 백업(`~/.cache/v2data/cutover/…/prod-before.dump`) → 마지막 합치기(충돌 있으면 중단) → v2 DB 를 운영 DB 로 → **카페24·클로브 연결과 상품동기화 상태는 운영 값 유지** → 건수·연결정보 확인.

## 3. 새 코드로 띄우기
```bash
cd ~/project/dev/yoykeerepo/deploy/macmini && docker compose up -d app
```
확인: https://pay.gnuol.com 로그인 → 대시보드 '오늘 할 일', 입금요청, 지급요청, 주문매칭(카페24 연결 표시), 자금(클로브 잔액), 정산, 상품동기화 예약.

## 4. 정리
- 새벽 합치기 끄기: `launchctl bootout gui/$(id -u)/com.yoykee.wooofpay-v2sync`
- v2 테스트 사이트(4174)는 다음 개발용으로 둘지 끌지 결정.
- 운영 메모리/문서의 운영 구성(브랜치·이미지) 갱신.

## 되돌리기 (약 10분)
```bash
cd ~/project/dev/yoykeerepo/deploy/macmini && docker compose stop app
docker exec -i wooofpay-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "drop schema public cascade; create schema public;"'
docker exec -i wooofpay-db-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < ~/.cache/v2data/cutover/<시각>-live/prod-before.dump
docker tag wooofpay-app:pre-v2 wooofpay-app:latest && docker compose up -d --no-build app
```
