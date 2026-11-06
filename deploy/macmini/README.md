# wooofpay 맥미니 자가 호스팅 가이드

Render(싱가포르) 대신 맥미니에서 wooofpay 를 직접 돌리는 구성.
사용자는 지금처럼 `pay.wooof.co.kr` 로 접속하고, Cloudflare Tunnel 이
그 요청을 맥미니로 전달한다. 서버가 한국에 있으므로 체감 속도가 크게 좋아진다.

구성 요소 (전부 `docker compose` 하나로 뜬다):

| 서비스 | 역할 |
|---|---|
| app | wooofpay 서버 (기존 Dockerfile 그대로) |
| db | Postgres 17 (Supabase 를 대체) |
| backup | 매일 자동 DB 백업 → `./backups` |
| cloudflared | pay.wooof.co.kr ↔ 맥미니 연결 터널 |

---

## 0. 맥미니 기본 설정 (한 번만)

서버는 24시간 깨어 있어야 한다.

- 시스템 설정 → **에너지**: "디스플레이가 꺼져 있을 때 자동으로 잠자기 방지" 켜기,
  "정전 후 자동으로 시작" 켜기
- 시스템 설정 → 사용자 및 그룹 → **자동 로그인** 켜기
  (정전 후 재부팅 시 로그인 없이 Docker 가 뜨도록)

## 1. Docker 설치 (한 번만)

[OrbStack](https://orbstack.dev) 설치를 권장한다 (Docker Desktop 보다 가볍다).

```bash
brew install orbstack
```

brew 가 없으면 orbstack.dev 에서 받아 설치해도 된다.
설치 후 OrbStack 실행 → 설정에서 **"Start at login"** 켜기.

## 2. 코드 받기

zip 으로 옮겼다면 그 폴더를 써도 되지만, 이후 업데이트를 위해 git clone 을 권장:

```bash
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/yoykee8671/yoykeerepo.git
cd yoykeerepo/deploy/macmini
```

(zip 을 쓸 경우: zip 푼 폴더에서 `cd deploy/macmini`)

## 3. Cloudflare Tunnel 만들기 (한 번만)

1. [one.dash.cloudflare.com](https://one.dash.cloudflare.com) 로그인
   (wooof.co.kr 이 등록된 그 Cloudflare 계정. Zero Trust 첫 진입이면
   무료 플랜 선택 절차가 한 번 나온다)
2. **Networks → Tunnels → Create a tunnel → Cloudflared** 선택
3. 터널 이름: `wooofpay-macmini`
4. 다음 화면에 설치 명령이 보이는데 **설치하지 말고**, 명령 안의
   `--token` 뒤 긴 문자열만 복사한다 → 이것이 `CLOUDFLARE_TUNNEL_TOKEN`
5. **Public Hostname 은 아직 추가하지 않는다** — 앱이 다 뜬 뒤
   마지막 "전환" 단계(7번)에서 추가한다.

## 4. 환경변수 채우기

```bash
cp .env.example .env
open -e .env   # 또는 아무 편집기
```

- `POSTGRES_PASSWORD`: 새로 만든다 — `openssl rand -hex 24` 결과 붙여넣기
- `CLOUDFLARE_TUNNEL_TOKEN`: 3단계에서 복사한 토큰
- 나머지: Render 대시보드 → wooofpay → Environment 의 값을 그대로 복사

## 5. 실행

```bash
docker compose up -d --build
```

첫 빌드는 LibreOffice 설치 때문에 10~20분 걸린다. 끝나면 확인:

```bash
curl http://localhost:4173/api/health
docker compose ps        # 네 서비스 모두 Up/healthy 인지
```

브라우저에서 http://localhost:4173 열어 로그인까지 되는지 본다.
(아직 데이터가 비어 있는 게 정상 — 다음 단계에서 가져온다)

## 6. 데이터 이전 (Supabase → 맥미니)

Supabase 접속 문자열(지금 Render 의 `DATABASE_URL` 값)이 필요하다.

```bash
# 1) Supabase 에서 덤프 (따옴표 안에 실제 URL 붙여넣기)
docker compose exec db pg_dump "postgres://...supabase.co:5432/postgres?sslmode=require" \
  --no-owner --no-privileges --table=app_state --clean --if-exists > app_state.sql

# 2) 맥미니 DB 에 복원
docker compose exec -T db psql -U wooofpay -d wooofpay < app_state.sql

# 3) 앱 재시작 후 확인
docker compose restart app
```

브라우저에서 기존 계정으로 로그인해 데이터가 다 보이는지 확인한다.

> pg_dump 버전 오류가 나면 Supabase 쪽 Postgres 가 더 최신인 것 —
> compose 의 `postgres:17` 을 그 버전으로 올리고 `docker compose up -d` 재실행.

## 7. 전환 (pay.wooof.co.kr 을 맥미니로)

여기부터 실제 트래픽이 옮겨온다. **직전에 6번(데이터 이전)을 한 번 더 실행**해서
그 사이 쌓인 데이터까지 가져온 뒤 진행할 것.

1. Cloudflare 대시보드 → wooof.co.kr → **DNS** 에서
   `pay` 레코드(Render 를 가리키는 CNAME)를 **삭제**
2. Zero Trust → Networks → Tunnels → wooofpay-macmini → **Public Hostname 추가**:
   - Subdomain: `pay` / Domain: `wooof.co.kr`
   - Service: **HTTP** / URL: `app:4173`
3. 휴대폰 등 외부에서 https://pay.wooof.co.kr 접속 확인

**롤백**: 문제가 생기면 2번의 Public Hostname 을 삭제하고 1번의 CNAME 을
원래대로 되살리면 즉시 Render 로 돌아간다.

안정화 확인 후 (1~2주 권장):
- Render 대시보드에서 wooofpay 서비스 **Suspend**
- Supabase 프로젝트는 백업 겸 한 달쯤 두었다가 정리

## 8. 백업

- `backup` 서비스가 **매일 자동으로** `deploy/macmini/backups/` 에 덤프를 만든다
  (일 14개 / 주 8개 / 월 6개 보관, 그 이전 것은 자동 삭제)
- 맥미니 디스크가 통째로 죽는 경우를 대비해, backups 폴더를 iCloud Drive
  등으로 복사해두면 더 안전하다. 예: 폴더 자체를 iCloud 안에 두거나,
  주기적으로 복사.

복원이 필요할 때:

```bash
gunzip -c backups/daily/wooofpay-최신파일.sql.gz | \
  docker compose exec -T db psql -U wooofpay -d wooofpay
docker compose restart app
```

## 9. 평소 운영

```bash
# 코드 업데이트 반영 (= 배포)
git pull && docker compose up -d --build

# 상태 확인
docker compose ps
docker compose logs -f app   # 앱 로그 보기

# 전체 재시작 / 중지
docker compose restart
docker compose down          # (down 해도 DB 데이터는 보존된다)
```

맥미니를 재부팅해도 OrbStack 이 로그인 시 시작되고 모든 서비스에
`restart: unless-stopped` 가 걸려 있어 자동으로 다시 뜬다.

## 10. Claude Code 연동

맥미니에 Claude 데스크톱 앱을 설치하고 로그인 →
**설정 → Claude Code → Remote Control** 켜고 이 레포 폴더를 추가하면,
클라우드의 Claude Code 세션이 맥미니에 직접 연결해 위 작업들을
대신 실행해줄 수 있다.
