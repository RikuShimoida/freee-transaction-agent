#!/usr/bin/env node
/**
 * 【実験】deal を1件登録し、明細(wallet_txn)が消込済みになるか検証する。
 * 登録するのは 110円のセリア明細1件のみ。
 *
 * 検証内容:
 *   - 登録前: 対象明細の status を記録
 *   - POST /deals（payments で楽天カード口座を指定 = 明細と紐付け狙い）
 *   - 登録後: 対象明細の status が 1→2(消込済) に変わるか / 二重にならないか
 *
 * 使い方: node scripts/experiment-register.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const T = process.env.FREEE_ACCESS_TOKEN;
const C = Number(process.env.FREEE_COMPANY_ID || "3139320");
const BASE = "https://api.freee.co.jp";

const TARGET_TXN_ID = 2262517340; // 110円 セリア（楽天カード）
const WALLETABLE_TYPE = "credit_card";
const WALLETABLE_ID = 1337236; // 楽天カード
const ACCOUNT_ITEM_ID = 501100061; // 消耗品費
const TAX_CODE = 136; // 課対仕入10%

async function api(path, { method = "GET", body, params = {} } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${T}`,
      "X-Api-Version": "2020-06-15",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function findTxn() {
  const { body } = await api("/api/1/wallet_txns", {
    params: { company_id: C, walletable_type: WALLETABLE_TYPE, walletable_id: WALLETABLE_ID, limit: 100 },
  });
  return (body.wallet_txns || []).find((t) => t.id === TARGET_TXN_ID);
}

async function main() {
  console.log("── 登録前の対象明細 ──");
  const before = await findTxn();
  if (!before) { console.error("対象明細が見つかりません（既に処理済みかも）。中止。"); process.exit(1); }
  console.log(`  id=${before.id} status=${before.status}(1=消込待ち) amount=${before.amount} date=${before.date} "${before.description}"`);
  if (before.status !== 1) { console.error("status!=1 のため実験対象外。中止。"); process.exit(1); }

  const deal = {
    company_id: C,
    issue_date: before.date,
    type: "expense",
    details: [{ account_item_id: ACCOUNT_ITEM_ID, tax_code: TAX_CODE, amount: before.amount }],
    payments: [{
      amount: before.amount,
      from_walletable_type: WALLETABLE_TYPE,
      from_walletable_id: WALLETABLE_ID,
      date: before.date,
    }],
  };
  console.log("\n── POST /api/1/deals 送信 ──");
  console.log(JSON.stringify(deal, null, 2));
  const res = await api("/api/1/deals", { method: "POST", body: deal });
  console.log(`\nレスポンス status=${res.status}`);
  if (res.status >= 400) {
    console.error("❌ 登録失敗:", JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  const dealId = res.body.deal && res.body.deal.id;
  console.log(`✅ deal登録成功 deal_id=${dealId}`);

  console.log("\n── 登録後の対象明細を再取得（statusが変わったか）──");
  const after = await findTxn();
  if (!after) {
    console.log("  🎉 対象明細が status=1 の一覧から消えた → 消込済みになった可能性大！");
  } else {
    console.log(`  id=${after.id} status=${after.status} (${after.status === 1 ? "⚠️ まだ消込待ち＝二重計上リスク" : after.status === 2 ? "🎉 消込済みになった" : "他ステータス"})`);
  }
  console.log(`\n登録した deal_id=${dealId} は、確認後 freee 画面 または DELETE /api/1/deals/${dealId} で削除できます。`);
}
main().catch((e) => { console.error(e); process.exit(1); });
