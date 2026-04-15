# 입금 요청 관리 웹앱 (MVP v2)

구글 스프레드시트 기반 입금 요청 업무를 웹앱으로 전환하기 위한 초기 버전입니다.

## 반영된 운영 규칙

- **필수값 없음**: 실무 입력 유연성을 유지
- **주문번호 중심 관리 권장**: 중복 감지 기준에서 핵심 키로 활용
- **이름 필드 이원화**: `고객명`, `입금자명` 분리 + `name_source` 선택
- **중복 처리 정책**: 동일 브랜드 + 주문번호 + 고객명 + 입금액이면 저장은 허용하고 경고
- **정산 변수 옵션화**: 수수료 계산 방식, 프로모션 유형, 할인액, 가변 JSON 필드
- **권한**: `super` / `general` 관리자 역할 분리
- **브랜드 공유**: 토큰 기반 읽기 전용 뷰어 링크 제공
- **동기화 방식**: 브랜드별 `immediate` 또는 `manual` 선택

## 핵심 기능

1. 관리자 생성/수정/삭제 + 감사 로그
2. 브랜드 생성 + 템플릿 가변 열 정의 + 공유용 읽기 전용 링크 생성
3. 입금 요청 생성/수정/삭제 + 중복 경고
4. 브랜드별 CSV 추출
5. 브랜드별 구글시트 아카이브 동기화 트리거

## 로컬 실행

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

브라우저에서 `http://127.0.0.1:8000` 접속.

## Docker 실행

```bash
docker build -t deposit-request-app .
docker run --rm -p 8000:8000 \
  -e GOOGLE_SHEETS_SYNC_ENABLED=false \
  -e APP_BASE_URL=http://localhost:8000 \
  deposit-request-app
```

## 배포 (Render 기준)

이 저장소에는 `render.yaml`이 포함되어 있어 바로 배포 가능합니다.

1. GitHub에 이 저장소를 push
2. Render 대시보드 → **New +** → **Blueprint** 선택
3. 저장소 연결 후 배포
4. 배포 완료 후 발급 URL 접속 (예: `https://deposit-request-app.onrender.com`)
5. 상태 확인: `https://<배포도메인>/healthz`

> 운영 권장: Render 환경변수 `APP_BASE_URL`를 실제 배포 도메인으로 설정

## 환경 변수

`GOOGLE_SHEETS_SYNC_ENABLED` (기본: `false`)
- `true`: Google API 동기화 로직 활성화 (현재는 인터페이스/샘플 구현)

`APP_BASE_URL` (선택)
- 예: `https://deposit.yourcompany.com`
- 설정 시 브랜드 공유 링크(`viewer_url`)를 절대 URL로 반환
- 미설정 시 현재 요청 도메인을 기준으로 자동 생성

## 주의

- 기존 시트의 업체별 수식 전체를 자동 이식하지는 않았습니다.
- 가변 수식/계산은 `extra_fields`(JSON) + 브랜드 템플릿 열 구조를 통해 단계적으로 이전하도록 설계했습니다.
