# WooofPay

Google Sheets로 운영하던 선매입 브랜드 입금 요청 시트를 웹앱으로 옮긴 프로젝트입니다.

## 실행

```bash
npm start
```

기본 주소:

```text
http://127.0.0.1:4173
```

초기 로그인:

- 이메일은 `BOOTSTRAP_ADMIN_EMAIL` (기본 `owner@wooofpay.local`)
- 비밀번호는 `BOOTSTRAP_ADMIN_PASSWORD` 환경변수로 지정
- 미지정 시 개발 모드에서는 임시 비밀번호가 서버 콘솔에 1회 출력됩니다
- `NODE_ENV=production`에서는 `BOOTSTRAP_ADMIN_PASSWORD` 미지정 시 부트스트랩이 거부됩니다

운영 시작 전에 관리자 화면에서 새 owner 또는 manager 계정을 만든 뒤 초기 계정 비밀번호를 변경하세요.

## 기능

- 관리자 로그인
- 관리자 생성, 수정, 삭제
- 입금요청 생성, 수정, 삭제
- 브랜드별 정산유형, 수수료율, 채권액, 배송비 규정, 출고 기준, 사업자/계좌 정보 관리
- 브랜드별 품목 공급가 마스터와 개정 이력 관리
- 모든 관리자 작업 감사 로그 기록
- 전체/브랜드별 CSV, Excel 추출
- 브랜드별 읽기 전용 공유 링크
- Google Apps Script Webhook 기반 Google Sheets 아카이브 동기화

## 정산 유형

- `선매입-채권`
  - 제품매출 100% + 배송비를 입금요청
  - 미공제 수수료는 채권 차감액으로 누적
- `선매입-일반(수수료)`
  - 제품매출 - 수수료 + 배송비
- `선매입-일반(공급가)`
  - 공급가 합 + 배송비
- `위탁`
  - 제품매출 - 수수료 + 배송비
  - 상태는 `위탁-입금전`
  - 실시간 대시보드 대기금액에서는 제외

이제 `단가표` 탭에서 브랜드별 품목 공급가를 개정 이력 형태로 관리할 수 있고, 입금요청 폼에서 품목을 추가하면 최신 적용 단가 기준으로 `공급가 합`이 자동 계산됩니다.

## 데이터

로컬 실행 시에는 `data/db.json`을 사용합니다.

`DATABASE_URL`이 설정되면 앱은 PostgreSQL(Supabase 포함)의 `app_state` 테이블에 전체 상태를 `jsonb`로 저장합니다. 현재 운영 데이터가 이미 `data/db.json`에 있다면 아래 명령으로 한 번 밀어 넣을 수 있습니다.

```bash
DATABASE_URL=postgresql://... npm run push:db
```

운영 배포 시에는 다음 중 하나로 확장하는 것을 권장합니다.

- PostgreSQL 저장소 사용
- 관리자 비밀번호 정책과 HTTPS 적용
- Google Workspace OAuth 또는 Apps Script Webhook URL 설정

## 배포

배포용 기본 파일이 포함되어 있습니다.

- `Dockerfile`
- `render.yaml`
- `.env.example`

### Render + Supabase

1. Supabase 프로젝트를 만들고 `DATABASE_URL` 준비
2. 현재 로컬 데이터가 있다면 먼저 Supabase로 업로드

```bash
DATABASE_URL=postgresql://... npm run push:db
```

3. Render에 이 프로젝트를 연결
4. 환경변수 설정

```text
DATABASE_URL
BOOTSTRAP_ADMIN_NAME
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
GOOGLE_APPS_SCRIPT_WEBHOOK_URL (선택)
```

5. Render 웹 서비스 시작 후 `/api/health` 확인

## Google Sheets 연동

자세한 설정은 [docs/google-sheets-archive.md](docs/google-sheets-archive.md)를 참고하세요.

## 기존 시트 분석

분석한 컬럼, 탭, 이관 규칙은 [docs/sheet-analysis.md](docs/sheet-analysis.md)에 정리했습니다.
