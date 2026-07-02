#!/usr/bin/env node
/**
 * ドライラン・シミュレーション（読み取りのみ・登録しない）
 *
 * 目的: status=1（消込待ち=未処理）の明細を全口座から集め、
 *       あなたの自動登録ルール(user_matchers)と照合したら
 *       「自動登録できる件数」「グレー件数」がどうなるかを可視化する。
 *
 * 使い方: node scripts/simulate.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const TOKEN = process.env.FREEE_ACCESS_TOKEN;
const COMPANY = process.env.FREEE_COMPANY_ID || "3139320";
const BASE = "https://api.freee.co.jp";

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "X-Api-Version": "2020-06-15" } });
  return r.json();
}

// カタカナ全角＋記号を正規化して素朴に部分一致で照合
function norm(s) {
  return (s || "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー―]/g, "-").toLowerCase().replace(/\s+/g, "");
}

async function main() {
  // 1. ルール取得
  const rulesResp = await api("/api/1/user_matchers", { company_id: COMPANY, limit: 100 });
  const rules = (rulesResp.data || []).filter((r) => r.active);
  console.log(`�規則: 有効な自動登録ルール ${rules.length} 件`);

  // 2. 口座一覧
  const wResp = await api("/api/1/walletables", { company_id: COMPANY });
  const wallets = wResp.walletables || [];

  // 3. 全口座の未処理明細(status=1)を集める
  const unprocessed = [];
  for (const w of wallets) {
    let offset = 0;
    while (true) {
      const resp = await api("/api/1/wallet_txns", {
        company_id: COMPANY, walletable_type: w.type, walletable_id: w.id, limit: 100, offset,
      });
      const txns = resp.wallet_txns || [];
      for (const t of txns) if (t.status === 1) unprocessed.push({ ...t, _wallet: w.name });
      if (txns.length < 100) break;
      offset += 100;
    }
  }
  console.log(`📋 未処理明細(status=1・消込待ち): ${unprocessed.length} 件\n`);

  // 4. 各明細をルールと照合
  const auto = [], gray = [];
  for (const t of unprocessed) {
    const desc = norm(t.description);
    const matched = rules.filter((r) => {
      if (r.entry_side_str && r.entry_side_str !== t.entry_side) return false;
      if (r.walletable && norm(r.walletable) !== norm(t._wallet)) return false;
      if (r.min_amount != null && t.amount < r.min_amount) return false;
      if (r.max_amount != null && t.amount > r.max_amount) return false;
      const kw = norm(r.description);
      return kw && desc.includes(kw);
    });
    const uniqueItems = [...new Set(matched.map((m) => m.account_item_name))];
    if (matched.length === 0) gray.push({ t, reason: "ルール未マッチ" });
    else if (uniqueItems.length > 1) gray.push({ t, reason: `複数候補(${uniqueItems.join("/")})` });
    else if (uniqueItems[0] === "事業主貸") gray.push({ t, reason: "事業主貸" });
    else auto.push({ t, item: uniqueItems[0], rule: matched[0] });
  }

  console.log("=".repeat(64));
  console.log(`✅ 自動登録できそう: ${auto.length} 件`);
  console.log("=".repeat(64));
  for (const a of auto.slice(0, 20))
    console.log(`   [${a.item}] ${a.t.amount}円  "${a.t.description}"  (${a.t._wallet})`);
  if (auto.length > 20) console.log(`   ...他 ${auto.length - 20} 件`);

  console.log("\n" + "=".repeat(64));
  console.log(`🔶 グレー（登録せず通知）: ${gray.length} 件`);
  console.log("=".repeat(64));
  const byReason = {};
  for (const g of gray) byReason[g.reason.replace(/\(.*/, "")] = (byReason[g.reason.replace(/\(.*/, "")] || 0) + 1;
  console.log("   内訳:", JSON.stringify(byReason));
  console.log("\n   グレー明細サンプル（金額大きい順・上位25件）:");
  for (const g of gray.sort((a, b) => b.t.amount - a.t.amount).slice(0, 25))
    console.log(`   [${g.reason}] ${g.t.amount}円  "${g.t.description}"  (${g.t._wallet})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
