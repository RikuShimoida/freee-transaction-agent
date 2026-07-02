#!/usr/bin/env node
/**
 * freee アクセストークンをリフレッシュトークンで更新する。
 * リフレッシュトークンは1回使い捨て（ローテーション）なので、
 * 新しい access_token / refresh_token の両方を .env.local に保存し直す。
 *
 * 使い方: node scripts/refresh-token.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = join(ROOT, ".env.local");
const raw = readFileSync(ENV, "utf8");
const env = {};
for (const line of raw.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const res = await fetch("https://accounts.secure.freee.co.jp/public_api/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.FREEE_CLIENT_ID,
    client_secret: env.FREEE_CLIENT_SECRET,
    refresh_token: env.FREEE_REFRESH_TOKEN,
  }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("❌ リフレッシュ失敗:", res.status, JSON.stringify(body));
  console.error("→ リフレッシュトークンも期限切れ/使用済みの可能性。get-token.mjs で取り直してください。");
  process.exit(1);
}

let updated = raw;
const set = (k, v) => {
  updated = new RegExp(`^${k}=.*$`, "m").test(updated)
    ? updated.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
    : updated + `\n${k}=${v}`;
};
set("FREEE_ACCESS_TOKEN", body.access_token);
set("FREEE_REFRESH_TOKEN", body.refresh_token);
writeFileSync(ENV, updated);
console.log(`✅ トークン更新完了（有効期限 約${Math.round((body.expires_in || 0) / 3600)}時間）`);
