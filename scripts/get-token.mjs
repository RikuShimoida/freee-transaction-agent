#!/usr/bin/env node
/**
 * freee OAuth トークン取得スクリプト（対話式）
 *
 * 流れ:
 *   1. 認可URLを表示 → あなたがブラウザで開いて「許可する」
 *   2. 画面に出た認可コードを貼る
 *   3. アクセストークン / リフレッシュトークンに交換し .env.local へ保存
 *
 * 前提: .env.local に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET を記入済み
 *      freeeアプリの Callback URL に urn:ietf:wg:oauth:2.0:oob を設定済み
 *
 * 使い方: node scripts/get-token.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENV_PATH = join(ROOT, ".env.local");
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

// --- .env.local 読み込み ---
function readEnvRaw() {
  try { return readFileSync(ENV_PATH, "utf8"); }
  catch { console.error("⚠️  .env.local がありません。"); process.exit(1); }
}
function parseEnv(raw) {
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

// --- .env.local の1キーを更新（他行は保持） ---
function upsertEnv(raw, key, value) {
  const lines = raw.split("\n");
  let found = false;
  const out = lines.map((line) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) { found = true; return `${key}=${value}`; }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  return out.join("\n");
}

async function main() {
  const raw = readEnvRaw();
  const env = parseEnv(raw);
  const clientId = env.FREEE_CLIENT_ID;
  const clientSecret = env.FREEE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("⚠️  FREEE_CLIENT_ID / FREEE_CLIENT_SECRET が .env.local に未設定です。");
    process.exit(1);
  }

  const authUrl =
    "https://accounts.secure.freee.co.jp/public_api/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    "&response_type=code";

  console.log("\n" + "=".repeat(64));
  console.log("STEP 1: 下のURLをブラウザで開き、「許可する」を押してください:");
  console.log("=".repeat(64));
  console.log("\n" + authUrl + "\n");
  console.log("STEP 2: 許可後に画面へ表示される「認可コード」をコピーしてください。\n");

  const rl = createInterface({ input, output });
  const code = (await rl.question("認可コードを貼り付けて Enter ▶ ")).trim();
  rl.close();

  if (!code) { console.error("❌ 認可コードが空です。"); process.exit(1); }

  console.log("\n⏳ トークンに交換中...");
  const res = await fetch("https://accounts.secure.freee.co.jp/public_api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("❌ トークン取得失敗:", res.status);
    console.error(JSON.stringify(body, null, 2));
    console.error("\nよくある原因: 認可コードの期限切れ(10分)/コールバックURL不一致/コード貼り間違い。");
    process.exit(1);
  }

  console.log("✅ トークン取得成功！");
  console.log(`   expires_in=${body.expires_in}s (約${Math.round((body.expires_in || 0) / 3600)}時間)`);

  let updated = raw;
  updated = upsertEnv(updated, "FREEE_ACCESS_TOKEN", body.access_token);
  updated = upsertEnv(updated, "FREEE_REFRESH_TOKEN", body.refresh_token);
  writeFileSync(ENV_PATH, updated);
  console.log("\n💾 .env.local に FREEE_ACCESS_TOKEN / FREEE_REFRESH_TOKEN を保存しました。");
  console.log("\n次はこれを実行してください:");
  console.log("   node scripts/verify-freee.mjs");
}

main().catch((e) => { console.error("予期せぬエラー:", e); process.exit(1); });
