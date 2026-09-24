-- 인증 (home-main과 동일한 PBKDF2 + 세션 쿠키 패턴)
CREATE TABLE IF NOT EXISTS users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	email TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	salt TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL
);

-- apt-subscription-advisor(GitHub Actions)가 POST /api/sync로 보낸 신규 공고 1건.
-- notice_id는 청약홈 공고관리번호(PBLANC_NO).
--
-- first_synced_at은 INSERT 시점에만 설정되고 이후 갱신(UPDATE)에서는 절대 바뀌지 않는다 -
-- "신규" 배지는 이 값을 기준으로 판단한다(예: 최근 2일 이내). synced_at은 매 sync마다 갱신되는
-- "마지막으로 확인된 시각"이다.
CREATE TABLE IF NOT EXISTS notices (
	notice_id TEXT PRIMARY KEY,
	house_name TEXT,
	address TEXT,
	region TEXT,
	supply_type TEXT,
	reception_start_date TEXT,
	reception_end_date TEXT,
	notice_url TEXT,
	recommendation TEXT,
	references_json TEXT,
	first_synced_at TEXT NOT NULL DEFAULT (datetime('now')),
	synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notices_first_synced_at ON notices (first_synced_at);

-- 공고 하나 안의 주택형(면적/분양가)별 분석 결과. apt-subscription-advisor의
-- main.py/analyzer.py가 계산한 값을 그대로 저장한다(margin_json/loan_json은
-- analyzer.py의 snake_case 필드명을 그대로 유지한 JSON 문자열).
CREATE TABLE IF NOT EXISTS notice_types (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	notice_id TEXT NOT NULL REFERENCES notices(notice_id) ON DELETE CASCADE,
	house_ty TEXT,
	area_sqm REAL,
	price_manwon INTEGER,
	margin_json TEXT,
	loan_json TEXT,
	variant_id TEXT NOT NULL UNIQUE -- `${notice_id}:${house_ty ?? 'unknown'}`
);

CREATE INDEX IF NOT EXISTS idx_notice_types_notice_id ON notice_types (notice_id);
