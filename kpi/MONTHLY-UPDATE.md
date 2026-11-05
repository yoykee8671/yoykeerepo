# KPI 월간 갱신 런북 (매월 1일)

목표: 지난달 + 아직 덜 기장됐던 과거 월의 데이터를 클로브에서 수확해 원가 집계와 자동채움을 갱신한다.
정책·검증 원칙은 `CLAUDE.md`를 따른다. 예상: 서브에이전트 2개, 30분 내외.

## 0. 사전 확인
- clobe get_my_context → 우프컴퍼니 companyId `336kMOHso30afzMqeUqbi`
- get_scraping_status: 은행·전표(기장) 수집 시각이 지난달 말 이후인지 확인. 오래됐으면 사용자에게 app.clobe.ai 「데이터 최신화」를 요청하고 중단.

## 1. 원가 (매입전표) — 서브에이전트 권장
- 대상: 지난달 전체 + 하단 실행 로그에 "부분월"로 남은 과거 월 재수확.
- get_journal_ledger(journalType=PURCHASE) 완주 → `purchase-ledger-YYYYMM.jsonl` (조건: DEBIT이고 accountCode≠13500, 음수 포함, 필드: date/month/account/accountCode/amount/partner/desc).
- 분류 규칙은 `costs-monthly-clobe.json` _comment의 확정 규칙 그대로. 재집계해서 months에 추가/갱신.
- 재수확한 과거 월이 기존 값과 다르면 월별 차이를 보고 (자동 갱신 — CLAUDE.md 정책).
- 규칙에 없는 신규 거래처 → other로 두고 질문 목록에 올림.

## 2. 매출 (은행 실입금) — 서브에이전트 권장
- 대상: 지난달 + 전전달(클로브 라벨 보완분) 재수확.
- 규칙 (autofill-raw.json 기존 월과 동일하게): IN 거래 중 카테고리 176(매출)/177(매출 취소·환불), 금액은 labelAmountKrw, labelId로 중복 제거, 키 = customLabel이면 `label:` > businessEntityName이면 `entity:` > `desc:`(transactionName, 비면 적요).
- `autofill-raw.json`에 months·revenueTotalCheck 추가/갱신. 기존 월은 재수확 값이 다를 때만 교체하고 차이 보고. 백업(.bak) 먼저.
- entity:픽키파크의 월 2.2M 대행료 분리는 generate-autofill.py가 처리 — raw에는 그대로 기록.
- CHANNEL_MAP에 없는 신규 채널키 → 질문 목록에 올림 (임의 매핑 금지).

## 3. 재생성·검증
- `python3 generate-autofill.py` 실행 → unmapped 키·경고 확인.
- 메인 세션에서 JSONL 재집계로 서브에이전트 결과 재현 검증 + 스팟체크.

## 4. AI_CFO 분류규칙 diff
- `cd ~/AI_CFO && git log --oneline -5 -- 분류규칙.csv` 로 최근 변경 확인.
- CHANNEL_MAP과 어긋나는 항목이 있으면 자동 수정하지 말고 보고 + SSOT 절차(KPI 먼저 수정 → 재이관) 안내.

## 5. 마무리
- `feat/kpi-monthly-YYYYMM` 브랜치에 커밋 (push는 사용자 확인 후).
- 보고 내용: 갱신된 월별 집계표 / 바뀐 과거 월과 변경폭 / 신규 거래처 질문 목록 / 수집 기준일.
- 사용자 액션 안내: kpi.html 해당 월에서 「⚡ clobe 자동값 적용」 클릭 (수동 수정 칸은 보호됨).
- 아래 실행 로그에 1줄 추가 (날짜, 커버 범위, 부분월 여부, 특이사항).

## 실행 로그
- 2026-10-29: 1~10월 초기 구축. 10월은 부분월(기장 10/13까지) — 11월 갱신 때 10월 재수확 필요. 8월 소일베이커 1.1M은 포괄 라벨이라 컨설팅 칸 수동 입력 필요.
