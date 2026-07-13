#!/usr/bin/env node
/**
 * 復旧用リスト書き出し（読み取り専用・登録も削除も一切しない）
 *
 * 2026-07-13の誤削除で未処理(status=1)に戻った明細を全口座から集め、
 * user_matchers と照合して「自動マッチ分／手動判断分」に仕分けし、
 * それぞれCSVに書き出す。freee UI での復旧作業の手引き用。
 *
 * 使い方: node scripts/export-recovery-list.mjs
 * 出力: recovery-auto.csv / recovery-manual.csv （リポジトリ直下）
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const YEAR = Number(process.env.AEON_YEAR || 2026);

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, "X-Api-Version": "2020-06-15" } });
  return r.json();
}

function norm(s) {
  return (s || "").replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー―]/g, "-").toLowerCase().replace(/\s+/g, "");
}

// CSVの1セルをエスケープ
function cell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const rulesResp = await api("/api/1/user_matchers", { company_id: COMPANY, limit: 100 });
  const rules = (rulesResp.data || []).filter((r) => r.active);

  const wResp = await api("/api/1/walletables", { company_id: COMPANY });
  const wallets = wResp.walletables || [];

  // 当該年の未処理明細を全口座から収集
  const unprocessed = [];
  for (const w of wallets) {
    let offset = 0;
    while (true) {
      const resp = await api("/api/1/wallet_txns", {
        company_id: COMPANY, walletable_type: w.type, walletable_id: w.id,
        start_date: `${YEAR}-01-01`, end_date: `${YEAR}-12-31`, limit: 100, offset,
      });
      const txns = resp.wallet_txns || [];
      for (const t of txns) if (t.status === 1) unprocessed.push({ ...t, _wallet: w.name });
      if (txns.length < 100) break;
      offset += 100;
    }
  }

  const auto = [], manual = [];
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
    const items = [...new Set(matched.map((m) => m.account_item_name))];
    if (matched.length === 1 || (matched.length > 1 && items.length === 1)) {
      auto.push({ t, item: items[0], reason: `ルール一意マッチ` });
    } else if (items.length > 1) {
      manual.push({ t, item: "", reason: `複数候補(${items.join("/")})` });
    } else {
      manual.push({ t, item: "", reason: "ルール未マッチ" });
    }
  }

  const header = "date,entry_side,amount,wallet,description,suggested_item,reason,txn_id\n";
  const toRow = (x) => [
    x.t.date, x.t.entry_side, x.t.amount, x.t._wallet, x.t.description, x.item, x.reason, x.t.id,
  ].map(cell).join(",");

  const sortByAmt = (a, b) => (b.t.amount || 0) - (a.t.amount || 0);
  writeFileSync(join(ROOT, "recovery-auto.csv"), header + auto.sort(sortByAmt).map(toRow).join("\n") + "\n");
  writeFileSync(join(ROOT, "recovery-manual.csv"), header + manual.sort(sortByAmt).map(toRow).join("\n") + "\n");

  console.log(`対象年: ${YEAR}`);
  console.log(`未処理明細: ${unprocessed.length} 件`);
  console.log(`✅ 自動マッチ: ${auto.length} 件 → recovery-auto.csv`);
  console.log(`🔶 手動判断: ${manual.length} 件 → recovery-manual.csv`);
}
main().catch((e) => { console.error(e); process.exit(1); });
