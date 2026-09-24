// 사용자 계정 생성/비밀번호 변경 스크립트.
// 본인 터미널에서 직접 실행하세요: node scripts/create-user.mjs
// (비밀번호가 화면에 표시되지 않고, wrangler를 통해 D1에 바로 저장됩니다)

import readline from "node:readline";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const PBKDF2_ITERATIONS = 100000;

function toHex(buffer) {
	return Buffer.from(buffer).toString("hex");
}

async function hashPassword(password, saltHex) {
	const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
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

function ask(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

function askHidden(question) {
	if (!process.stdin.isTTY) {
		return ask(question);
	}

	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		const stdin = process.stdin;
		let input = "";

		process.stdout.write(question);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding("utf8");

		const onData = (char) => {
			if (char === "\r" || char === "\n") {
				stdin.setRawMode(false);
				stdin.removeListener("data", onData);
				process.stdout.write("\n");
				rl.close();
				resolve(input);
				return;
			}
			if (char === "") process.exit(1); // Ctrl+C
			if (char === "") {
				input = input.slice(0, -1);
				return;
			}
			input += char;
		};

		stdin.on("data", onData);
	});
}

const email = await ask("이메일: ");
const password = await askHidden("비밀번호: ");

if (!email || !password) {
	console.error("이메일/비밀번호는 비워둘 수 없습니다.");
	process.exit(1);
}

const { hash, salt } = await hashPassword(password);
const escapedEmail = email.replace(/'/g, "''");

const sql = `INSERT INTO users (email, password_hash, salt) VALUES ('${escapedEmail}', '${hash}', '${salt}')
ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, salt = excluded.salt;`;

const tmpFile = `.tmp-create-user-${Date.now()}.sql`;
writeFileSync(tmpFile, sql, "utf8");

try {
	execFileSync("npx", ["wrangler", "d1", "execute", "apt-advisor-db", "--remote", `--file=${tmpFile}`], {
		stdio: "inherit",
		shell: true,
	});
	console.log(`\n완료: ${email} 계정이 생성/갱신되었습니다.`);
} finally {
	unlinkSync(tmpFile);
}
