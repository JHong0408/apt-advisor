const PBKDF2_ITERATIONS = 100000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

function toHex(buffer) {
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

export async function hashPassword(password, saltHex) {
	const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
		"deriveBits",
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
		keyMaterial,
		256,
	);
	return { hash: toHex(bits), salt: toHex(salt) };
}

function timingSafeEqual(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
	const { hash } = await hashPassword(password, saltHex);
	return timingSafeEqual(hash, expectedHashHex);
}

function getCookie(request, name) {
	const header = request.headers.get("cookie") || "";
	const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : null;
}

export async function getSessionUser(request, env) {
	const sessionId = getCookie(request, "session");
	if (!sessionId) return null;

	const row = await env.DB.prepare(
		"SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?",
	)
		.bind(sessionId, new Date().toISOString())
		.first();

	return row ?? null;
}

export async function createSession(env, userId) {
	const sessionId = toHex(crypto.getRandomValues(new Uint8Array(32)));
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
	await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
		.bind(sessionId, userId, expiresAt)
		.run();
	return sessionId;
}

export async function destroySessionFromRequest(request, env) {
	const sessionId = getCookie(request, "session");
	if (!sessionId) return;
	await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export function sessionCookieHeader(sessionId) {
	return `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearCookieHeader() {
	return `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
