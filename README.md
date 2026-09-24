# apt-advisor

[apt-subscription-advisor](https://github.com/JHong0408/apt-subscription-advisor)가 매일 아침
분석한 청약 공고 결과를 로그인해서 검색하고, 신규 공고를 배지로 확인하는 대시보드입니다.

home-main과 같은 방식으로 만들었습니다: 별도 프레임워크 없이 순수 HTML/CSS/JS(`public/`)를
**Cloudflare Workers**의 정적 자산 기능으로 서빙하고, 데이터는 **D1**(Cloudflare가 제공하는
SQLite)에 저장합니다.

## 아키텍처

데이터 수집/분석/Claude 웹검색은 전부 apt-subscription-advisor의 GitHub Actions(Python)가
담당합니다. 이 Worker는 **cron이 없습니다** - `POST /api/sync`로 받은 결과를 저장하고 보여주기만
합니다.

```
[GitHub Actions: daily-check.yml, 매일 KST 10시]
        │  apt-subscription-advisor의 기존 수집/분석/Claude 웹검색은 그대로
        │  POST /api/sync  (Authorization: Bearer SYNC_TOKEN)
        ▼
[Cloudflare Worker: src/index.js]  ──▶  [D1: apt-advisor-db]
        │
        ▼ (로그인 세션 확인 후)
[public/index.html]  ──  GET /api/notices?q=...&status=...&new=1  ──▶  D1에서 조회
```

- **알림 채널이 이 사이트 하나뿐입니다.** Slack은 쓰지 않습니다. 로그인해서 들어오면 "신규 N건"
  배지와 함께 전체 공고를 검색할 수 있습니다.
- **"신규" 판단**: `notices.first_synced_at`은 그 공고가 처음 동기화된 시각으로, 이후 갱신
  (같은 공고가 다시 sync되어도)되지 않습니다. 최근 2일 이내면 "신규" 배지가 붙습니다
  (`src/index.js`의 `NEW_WINDOW_SQL`).
- **인증**: 이메일/비밀번호 로그인 + 세션 쿠키(`src/auth.js`, home-main과 동일한 PBKDF2 방식).
  회원가입 화면은 없고, `scripts/create-user.mjs`로 본인 계정만 직접 만듭니다.

## 1. 배포 준비

```bash
npm install
npx wrangler login
```

## 2. D1 데이터베이스 생성

```bash
npx wrangler d1 create apt-advisor-db
```

출력되는 `database_id`를 [wrangler.jsonc](wrangler.jsonc)의 `d1_databases[0].database_id`에
붙여넣으세요.

```bash
npx wrangler d1 execute apt-advisor-db --remote --file=./schema.sql
```

## 3. 동기화 토큰(SYNC_TOKEN) 등록

apt-subscription-advisor의 GitHub Actions가 `/api/sync`를 호출할 때 쓸 임의의 비밀 문자열을
하나 만들어서 Worker에 등록합니다.

```bash
# 예: openssl rand -hex 32 로 생성한 값을 사용
npx wrangler secret put SYNC_TOKEN
```

## 4. 로그인 계정 생성

```bash
node scripts/create-user.mjs
```

## 5. 배포

```bash
npm run deploy
```

배포가 끝나면 `https://apt-advisor.<your-subdomain>.workers.dev` 같은 URL이 출력됩니다.

## 6. apt-subscription-advisor에 연결

`apt-subscription-advisor` 저장소 Settings → Secrets and variables → Actions에 아래 두 개를
추가하세요.

| Secret | 값 |
| --- | --- |
| `SITE_URL` | 5번에서 배포된 Worker URL |
| `SITE_SYNC_TOKEN` | 3번에서 등록한 `SYNC_TOKEN`과 동일한 값 |

다음 스케줄(또는 Actions 탭에서 수동 실행)부터 새로 잡힌 공고가 자동으로 이 사이트에 동기화됩니다.

## 로컬 개발

```bash
cp .dev.vars.example .dev.vars   # SYNC_TOKEN 값을 채워넣기
npm run dev
```

```bash
npx wrangler d1 execute apt-advisor-db --file=./schema.sql   # --remote 없이 = 로컬 DB
```
