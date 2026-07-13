#!/usr/bin/env node
/**
 * 🛑 封印済み・使用禁止（2026-07-13 事故のため）
 *
 * このスクリプトは「GET /api/1/deals は walletable_id で口座を絞れる」という
 * 誤った前提で書かれていた。実際には deals API は walletable_id を無視し、
 * 全口座横断の deal を返す。そのため「イオン口座のみ削除」のつもりで実行した結果、
 * 2026年の全口座の expense deal 574件を誤削除する事故を起こした。
 * 詳細はメモリ aeon-deal-cleanup / freee-api-facts を参照。
 *
 * deals を口座で絞りたい場合は、取得後に payments[].from_walletable_id で
 * クライアント側フィルタが必須（このスクリプトは未対応）。
 *
 * 破壊的操作を防ぐため、--i-understand-this-deletes-ALL-accounts を明示しない限り
 * 起動時に中断する。安易に外さないこと。
 *
 * ⚠️ 本番データを変更する破壊的操作を含む。既定は dry-run（読み取り専用）。
 *
 * 使い方:
 *   node scripts/aeon-deals.mjs                    # dry-run: 対象dealを一覧表示するだけ
 *   node scripts/aeon-deals.mjs --delete           # 実削除（一覧表示 → 各dealをDELETE）
 *   node scripts/aeon-deals.mjs --expense-only     # expense(支出)のみに絞る（income(入金)は除外）
 *
 * オプション環境変数:
 *   AEON_WALLET_NAME  口座名の判定キーワード（既定: "イオン"）
 *   AEON_YEAR         対象年（既定: 2026）
 */

import { FreeeClient } from "../lib/freee.mjs";

const DO_DELETE = process.argv.includes("--delete");
const EXPENSE_ONLY = process.argv.includes("--expense-only");
const WALLET_KEYWORD = process.env.AEON_WALLET_NAME || "イオン";
const YEAR = Number(process.env.AEON_YEAR || 2026);
const START_DATE = `${YEAR}-01-01`;
const END_DATE = `${YEAR}-12-31`;

function yen(n) {
  return typeof n === "number" ? n.toLocaleString("ja-JP") + "円" : String(n);
}

const SAFETY_OPT_IN = process.argv.includes("--i-understand-this-deletes-ALL-accounts");

async function main() {
  // 🛑 封印ガード: 削除は口座を絞れず全口座に及ぶため、明示オプトインが無ければ中断
  if (DO_DELETE && !SAFETY_OPT_IN) {
    console.error("🛑 このスクリプトの削除は口座を絞れず、全口座のdealを消す危険があります。");
    console.error("   2026-07-13に全口座574件を誤削除した事故のため封印中です。");
    console.error("   仕組みを理解した上でどうしても実行するなら:");
    console.error("     node scripts/aeon-deals.mjs --delete --i-understand-this-deletes-ALL-accounts");
    process.exit(1);
  }
  const client = new FreeeClient();

  // --- 1. イオンクレジット口座を特定 ---
  const wallets = await client.getWalletables();
  const aeon = wallets.filter((w) => (w.name || "").includes(WALLET_KEYWORD));
  if (aeon.length === 0) {
    console.error(`❌ 口座名に「${WALLET_KEYWORD}」を含む口座が見つかりません。`);
    console.error("   全口座:");
    for (const w of wallets) console.error(`   - type=${w.type} id=${w.id} ${w.name}`);
    process.exit(1);
  }
  console.log(`✅ 対象口座 ${aeon.length} 件:`);
  for (const w of aeon) console.log(`   - type=${w.type} id=${w.id} ${w.name}`);
  console.log(`   対象期間: ${START_DATE} 〜 ${END_DATE}\n`);

  // --- 2. 各口座の期間内 deal を取得 ---
  // GET /api/1/deals は walletable_type/walletable_id で口座を絞れる。
  const targets = [];
  for (const w of aeon) {
    let offset = 0;
    while (true) {
      const r = await client.request("/api/1/deals", {
        params: {
          company_id: client.companyId,
          walletable_type: w.type,
          walletable_id: w.id,
          start_issue_date: START_DATE,
          end_issue_date: END_DATE,
          limit: 100,
          offset,
        },
      });
      const deals = r.deals || [];
      for (const d of deals) targets.push({ ...d, _walletName: w.name });
      if (deals.length < 100) break;
      offset += 100;
    }
  }

  // --- 2.5 expense のみに絞る（--expense-only 指定時） ---
  let filtered = targets;
  if (EXPENSE_ONLY) {
    const before = targets.length;
    filtered = targets.filter((d) => d.type === "expense");
    const removed = before - filtered.length;
    console.log(`🔎 --expense-only: income(入金) ${removed} 件を対象から除外しました。\n`);
  }

  if (filtered.length === 0) {
    console.log("該当する登録済み取引(deal)はありませんでした。削除するものはありません。");
    return;
  }

  // --- 3. 一覧表示 ---
  console.log(`📋 対象の登録済み取引(deal) ${filtered.length} 件:`);
  let sum = 0;
  for (const d of filtered) {
    sum += d.amount || 0;
    const desc = (d.details && d.details[0] && d.details[0].description) || d.ref_number || "";
    console.log(
      `   - id=${d.id} ${d.issue_date} ${d.type} ${yen(d.amount)} ` +
        `[${d._walletName}] status=${d.status} ${desc}`
    );
  }
  console.log(`   合計金額: ${yen(sum)}\n`);

  if (!DO_DELETE) {
    console.log("👀 dry-run のため削除は実行していません。");
    console.log("   この一覧で問題なければ、--delete を付けて再実行すると削除します。");
    return;
  }

  // --- 4. 実削除 ---
  console.log("🗑  削除を実行します...\n");
  let ok = 0;
  const failed = [];
  for (const d of filtered) {
    try {
      await client.request(`/api/1/deals/${d.id}`, {
        method: "DELETE",
        params: { company_id: client.companyId },
      });
      ok++;
      console.log(`   ✅ deleted id=${d.id} ${d.issue_date} ${yen(d.amount)}`);
    } catch (e) {
      failed.push({ id: d.id, error: e.message });
      console.error(`   ❌ failed id=${d.id}: ${e.message}`);
    }
  }
  console.log(`\n完了: 成功 ${ok} 件 / 失敗 ${failed.length} 件`);
  if (failed.length) {
    console.log("失敗した明細は freee 管理画面で個別に確認してください。");
  } else {
    console.log("dealの削除が完了しました。明細(wallet_txn)自体の削除は freee の管理画面から行ってください。");
    console.log("（freee APIには wallet_txn を削除するエンドポイントがありません）");
  }
}

main().catch((e) => {
  console.error("予期せぬエラー:", e);
  process.exit(1);
});
