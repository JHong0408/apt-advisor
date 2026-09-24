import {
	getSessionUser,
	createSession,
	destroySessionFromRequest,
	verifyPassword,
	sessionCookieHeader,
	clearCookieHeader,
} from "./auth.js";

function jsonError(message, status) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "content-type": "application/json" },
	});
}

async function handleLogin(request, env) {
	let body;
	try {
		body = await request.json();
	} catch {
		return jsonError("잘못된 요청입니다", 400);
	}

	const email = body.email?.trim();
	const password = body.password;
	if (!email || !password) return jsonError("이메일/비밀번호를 입력하세요", 400);

	const user = await env.DB.prepare("SELECT id, password_hash, salt FROM users WHERE email = ?").bind(email).first();
	if (!user || !(await verifyPassword(password, user.salt, user.password_hash))) {
		return jsonError("이메일 또는 비밀번호가 올바르지 않습니다", 401);
	}

	const sessionId = await createSession(env, user.id);
	return new Response(JSON.stringify({ ok: true }), {
		headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(sessionId) },
	});
}

async function handleLogout(request, env) {
	await destroySessionFromRequest(request, env);
	return new Response(JSON.stringify({ ok: true }), {
		headers: { "content-type": "application/json", "set-cookie": clearCookieHeader() },
	});
}

// apt-subscription-advisor의 GitHub Actions(src/site_sync.py)가 분석을 마친 공고 1건을
// 밀어 넣는 엔드포인트. 로그인 세션이 아니라 고정 공유 토큰(SYNC_TOKEN)으로 인증한다 - 이
// 호출은 사람이 브라우저로 하는 게 아니라 CI 러너가 서버 대 서버로 하는 것이기 때문.
async function handleSync(request, env) {
	const authHeader = request.headers.get("authorization") || "";
	const token = authHeader.replace(/^Bearer\s+/i, "").trim();
	if (!env.SYNC_TOKEN || token !== env.SYNC_TOKEN) {
		return jsonError("Unauthorized", 401);
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return jsonError("잘못된 요청입니다", 400);
	}

	const {
		notice_id: noticeId,
		house_name: houseName,
		address,
		region,
		supply_type: supplyType,
		reception_start_date: receptionStartDate,
		reception_end_date: receptionEndDate,
		notice_url: noticeUrl,
		recommendation,
		references,
		types,
	} = body;

	if (!noticeId || !Array.isArray(types) || types.length === 0) {
		return jsonError("notice_id와 types가 필요합니다", 400);
	}

	// first_synced_at은 여기서 명시적으로 갱신하지 않는다 - ON CONFLICT DO UPDATE의 SET
	// 목록에 없으면 기존 행의 값이 그대로 유지된다(=최초 동기화 시각 보존, "신규" 배지의 기준).
	await env.DB.prepare(
		`INSERT INTO notices (notice_id, house_name, address, region, supply_type, reception_start_date, reception_end_date, notice_url, recommendation, references_json, first_synced_at, synced_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
		 ON CONFLICT(notice_id) DO UPDATE SET
			house_name = excluded.house_name,
			address = excluded.address,
			region = excluded.region,
			supply_type = excluded.supply_type,
			reception_start_date = excluded.reception_start_date,
			reception_end_date = excluded.reception_end_date,
			notice_url = excluded.notice_url,
			recommendation = excluded.recommendation,
			references_json = excluded.references_json,
			synced_at = datetime('now')`,
	)
		.bind(
			noticeId,
			houseName ?? null,
			address ?? null,
			region ?? null,
			supplyType ?? null,
			receptionStartDate ?? null,
			receptionEndDate ?? null,
			noticeUrl ?? null,
			recommendation ?? null,
			JSON.stringify(references ?? []),
		)
		.run();

	for (const t of types) {
		const variantId = t.variant_id ?? `${noticeId}:${t.house_ty ?? "unknown"}`;
		await env.DB.prepare(
			`INSERT INTO notice_types (notice_id, house_ty, area_sqm, price_manwon, margin_json, loan_json, variant_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(variant_id) DO UPDATE SET
				area_sqm = excluded.area_sqm,
				price_manwon = excluded.price_manwon,
				margin_json = excluded.margin_json,
				loan_json = excluded.loan_json`,
		)
			.bind(
				noticeId,
				t.house_ty ?? null,
				t.area_sqm ?? null,
				t.price_manwon ?? null,
				JSON.stringify(t.margin ?? null),
				JSON.stringify(t.loan ?? null),
				variantId,
			)
			.run();
	}

	return new Response(JSON.stringify({ ok: true }), {
		headers: { "content-type": "application/json" },
	});
}

// "신규" 배지 판단 기준. GitHub Actions가 하루 한 번(KST 10시) 도는 걸 감안해 이틀로 넉넉하게 잡는다.
const NEW_WINDOW_SQL = "datetime('now', '-2 days')";

async function handleGetNotices(url, env) {
	const statusFilter = url.searchParams.get("status") || "open";
	const onlyNew = url.searchParams.get("new") === "1";
	const q = url.searchParams.get("q")?.trim() || "";
	const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 300);

	const conds = ["1=1"];
	const binds = [];

	if (statusFilter === "open") {
		conds.push("(reception_end_date IS NULL OR reception_end_date >= ?)");
		binds.push(new Date().toISOString().slice(0, 10));
	}
	if (onlyNew) {
		conds.push(`first_synced_at >= ${NEW_WINDOW_SQL}`);
	}
	if (q) {
		conds.push("(house_name LIKE ? OR address LIKE ?)");
		binds.push(`%${q}%`, `%${q}%`);
	}

	const sql = `SELECT *, (first_synced_at >= ${NEW_WINDOW_SQL}) AS is_new
		FROM notices WHERE ${conds.join(" AND ")}
		ORDER BY first_synced_at DESC LIMIT ?`;
	binds.push(limit);

	const rows = (await env.DB.prepare(sql).bind(...binds).all()).results ?? [];

	const notices = [];
	for (const row of rows) {
		const types = await env.DB.prepare(
			"SELECT house_ty, area_sqm, price_manwon, margin_json, loan_json FROM notice_types WHERE notice_id = ? ORDER BY area_sqm ASC",
		)
			.bind(row.notice_id)
			.all();

		notices.push({
			notice_id: row.notice_id,
			house_name: row.house_name,
			address: row.address,
			region: row.region,
			supply_type: row.supply_type,
			reception_start_date: row.reception_start_date,
			reception_end_date: row.reception_end_date,
			notice_url: row.notice_url,
			recommendation: row.recommendation,
			references: row.references_json ? JSON.parse(row.references_json) : [],
			first_synced_at: row.first_synced_at,
			is_new: Boolean(row.is_new),
			types: (types.results ?? []).map((t) => ({
				house_ty: t.house_ty,
				area_sqm: t.area_sqm,
				price_manwon: t.price_manwon,
				margin: t.margin_json ? JSON.parse(t.margin_json) : null,
				loan: t.loan_json ? JSON.parse(t.loan_json) : null,
			})),
		});
	}

	const newCountRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM notices WHERE first_synced_at >= ${NEW_WINDOW_SQL}`).first();

	return new Response(JSON.stringify({ notices, new_count: newCountRow?.c ?? 0 }), {
		headers: { "content-type": "application/json" },
	});
}

function buildSharedHeader(user) {
	return `<header class="site-header">
	<a class="brand" href="/">청약 알리미</a>
	<nav>
		<span class="user-email">${user.email}</span>
		<button id="logout-btn" type="button">로그아웃</button>
	</nav>
</header>
<script>
	document.getElementById("logout-btn").addEventListener("click", async () => {
		await fetch("/api/logout", { method: "POST" });
		location.href = "/login";
	});
</script>`;
}

async function injectPageEnhancements(response, user) {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("text/html") || !user) return response;

	let html = await response.text();
	if (html.includes("<body>")) {
		html = html.replace("<body>", `<body>\n${buildSharedHeader(user)}`);
	}
	return new Response(html, response);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const { pathname } = url;

		if (pathname === "/api/sync" && request.method === "POST") return handleSync(request, env);
		if (pathname === "/api/login" && request.method === "POST") return handleLogin(request, env);
		if (pathname === "/api/logout" && request.method === "POST") return handleLogout(request, env);

		const user = await getSessionUser(request, env);

		if (!user) {
			if (pathname === "/login" || pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
			if (pathname.startsWith("/api/")) return jsonError("Unauthorized", 401);
			return Response.redirect(new URL("/login", url).toString(), 302);
		}

		if (pathname === "/login") return Response.redirect(new URL("/", url).toString(), 302);

		if (pathname === "/api/notices") {
			if (request.method !== "GET") return jsonError("Method not allowed", 405);
			return handleGetNotices(url, env);
		}

		return injectPageEnhancements(await env.ASSETS.fetch(request), user);
	},
};
