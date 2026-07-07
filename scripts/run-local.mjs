#!/usr/bin/env node
/**
 * ローカル実行スクリプト。
 *
 *   npm run analyze              # ドライラン（ルール作成しない・LINE本文プレビュー）
 *   node --env-file=.env.local scripts/run-local.mjs --apply          # 実際にルール作成
 *   node --env-file=.env.local scripts/run-local.mjs --apply --auto   # 確度highをact=1(自動登録)で作成
 *
 * デフォルトは安全なドライラン。
 */
import { run } from "../lib/run.mjs";

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const autoRegister = args.includes("--auto");
const notify = !args.includes("--no-notify");

console.log(`\n=== 実行モード: ${dryRun ? "ドライラン（作成しない）" : "本番（ルール作成）"}` +
  `${autoRegister ? " / 確度high=自動登録(act=1)" : " / 全て提案(act=0)"} ===\n`);

const summary = await run({ dryRun, autoRegister, notify });

console.log("\n=== 結果サマリー ===");
console.log(`未処理明細: ${summary.totalUnprocessed}件`);
console.log(`既存ルール一致: ${summary.matchedCount}件`);
console.log(`事業主貸候補: ${summary.ownerDrawCount}件`);
console.log(`除外(カード引落等): ${summary.excludedCount}件`);
console.log(`ルール作成: ${summary.createdRules.length}件`);
console.log(`グレー(要確認): ${summary.grayList.length}件`);

if (summary.createdRules.length) {
  console.log("\n--- 作成したルール ---");
  for (const r of summary.createdRules) {
    console.log(`  「${r.candidate.description}」→ ${r.candidate.account_item_name} / ${r.candidate.tax_name} / act=${r.candidate.act} (${r.candidate.walletable})`);
  }
}
if (summary.failedRules.length) {
  console.log("\n--- 作成失敗 ---");
  for (const f of summary.failedRules) console.log(`  ${f.candidate.description}: ${f.error}`);
}
