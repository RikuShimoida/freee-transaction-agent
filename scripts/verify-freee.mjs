#!/usr/bin/env node
/**
 * freee API 読み取り専用検証スクリプト
 *
 * このスクリプトはデータを一切変更しません（GET のみ）。
 * 目的: 認証 / 未処理明細取得 / 自動登録ルール取得 / 事業主貸の特定 が
 *       あなたの freee で実際に動くかを確かめる。
 *
 * 使い方:
 *   1. .env.local.example を .env.local にコピーし FREEE_ACCESS_TOKEN を記入
 *   2. node scripts/verify-freee.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// --- .env.local を読み込む（依存ゼロの簡易パーサ） ---
function loadEnv() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.error("⚠️  .env.local が見つかりません。.env.local.example をコピーして作成してください。");
    process.exit(1);
  }
}
loadEnv();

const BASE = "https://api.freee.co.jp";
const TOKEN = process.env.FREEE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("⚠️  FREEE_ACCESS_TOKEN が未設定です。.env.local に記入してください。");
  process.exit(1);
}

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "X-Api-Version": "2020-06-15",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, headers: res.headers };
}

function section(title) {
  console.log("\n" + "=".repeat(60));
  console.log("▶ " + title);
  console.log("=".repeat(60));
}

async function main() {
  // --- 1. 認証確認 + 事業所ID取得 ---
  section("1. 認証確認 / 事業所一覧 (GET /api/1/companies)");
  const companies = await api("/api/1/companies");
  if (!companies.ok) {
    console.error("❌ 認証失敗:", companies.status, JSON.stringify(companies.body, null, 2));
    console.error("   → アクセストークンが正しいか・期限切れ(6時間)でないか確認してください。");
    process.exit(1);
  }
  const list = companies.body.companies || [];
  console.log(`✅ 認証成功。事業所 ${list.length} 件:`);
  for (const c of list) console.log(`   - id=${c.id}  ${c.display_name || c.name}  (role=${c.role})`);

  const companyId = process.env.FREEE_COMPANY_ID || (list[0] && list[0].id);
  if (!companyId) { console.error("❌ company_id が取れませんでした。"); process.exit(1); }
  console.log(`\n👉 以降 company_id=${companyId} を使用` +
    (process.env.FREEE_COMPANY_ID ? "（.env.localで指定）" : "（先頭の事業所を自動採用）"));

  // --- 2. 勘定科目一覧 → 事業主貸の特定 ---
  section("2. 勘定科目一覧 / 事業主貸の特定 (GET /api/1/account_items)");
  const items = await api("/api/1/account_items", { company_id: companyId });
  if (!items.ok) {
    console.error("❌ 取得失敗:", items.status, JSON.stringify(items.body, null, 2));
  } else {
    const all = items.body.account_items || [];
    console.log(`✅ 勘定科目 ${all.length} 件取得。`);
    const nushikashi = all.filter((a) => a.name && a.name.includes("事業主貸"));
    if (nushikashi.length) {
      console.log("   🎯 「事業主貸」を発見:");
      for (const a of nushikashi) console.log(`      - id=${a.id}  name=${a.name}  category=${a.account_category}`);
    } else {
      console.log("   ⚠️  name に「事業主貸」を含む科目が見つかりませんでした（個人事業主アカウントでない可能性）。");
    }
  }

  // --- 3. 口座一覧（walletables） ---
  section("3. 口座一覧 (GET /api/1/walletables)");
  const wallets = await api("/api/1/walletables", { company_id: companyId });
  if (!wallets.ok) {
    console.error("❌ 取得失敗:", wallets.status, JSON.stringify(wallets.body, null, 2));
  } else {
    const ws = wallets.body.walletables || [];
    console.log(`✅ 口座 ${ws.length} 件:`);
    for (const w of ws) console.log(`   - type=${w.type}  id=${w.id}  ${w.name}  残高=${w.last_balance}`);
  }

  // --- 4. 未処理明細（wallet_txns, status=unregistered） ---
  section("4. 未処理明細 (GET /api/1/wallet_txns?status=unregistered)");
  const txns = await api("/api/1/wallet_txns", {
    company_id: companyId,
    status: "unregistered",
    limit: 10,
  });
  if (!txns.ok) {
    console.error("❌ 取得失敗:", txns.status, JSON.stringify(txns.body, null, 2));
    console.error("   → status パラメータの仕様が異なる可能性。status を外して再試行します...");
    const txns2 = await api("/api/1/wallet_txns", { company_id: companyId, limit: 10 });
    console.log("   再試行 status:", txns2.status);
    console.log("   再試行 body(先頭):", JSON.stringify(txns2.body, null, 2).slice(0, 1500));
  } else {
    const t = txns.body.wallet_txns || [];
    console.log(`✅ 未処理明細 ${t.length} 件（最大10件表示）:`);
    for (const x of t) {
      console.log(`   - id=${x.id} date=${x.date} amount=${x.amount} entry=${x.entry_side} ` +
        `desc="${x.description || ""}" status=${x.status}`);
    }
    if (t[0]) {
      console.log("\n   📋 1件目の生データ（全フィールド確認用）:");
      console.log(JSON.stringify(t[0], null, 2));
    }
  }

  // --- 5. 自動登録ルール（user_matchers） ---
  section("5. 自動登録ルール (GET /api/1/user_matchers) ※2026年4月公開の新API");
  const rules = await api("/api/1/user_matchers", { company_id: companyId, limit: 5 });
  if (!rules.ok) {
    console.error(`⚠️  取得不可: status=${rules.status}`);
    console.error("   body:", JSON.stringify(rules.body, null, 2).slice(0, 800));
    console.error("   → このAPIが使えない場合、ルール判定ロジックは自前定義に切り替える必要があります。");
  } else {
    const r = rules.body.user_matchers || rules.body.matchers || rules.body;
    console.log("✅ 自動登録ルール取得成功。レスポンス構造:");
    console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  }

  section("検証完了");
  console.log("この結果（特に 4 と 5 の生データ）を Claude に共有してください。");
  console.log("それを元に、二重計上を避けた最終的な処理ロジックを確定します。");
}

main().catch((e) => {
  console.error("予期せぬエラー:", e);
  process.exit(1);
});
