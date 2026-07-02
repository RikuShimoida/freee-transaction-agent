/**
 * 月末バッチのオーケストレーション。
 *
 * 流れ:
 *   1. freeeから未処理明細(status=1)・ルール・費目・税区分を取得
 *   2. 分析: カード引落除外 / 既存ルール照合 / 分類
 *   3. 未マッチ明細をClaudeで費目推定
 *   4. 確度高のものは自動登録ルールを作成（dryRunなら作らない）
 *   5. グレー明細＋結果をLINE通知
 */
import { FreeeClient } from "./freee.mjs";
import { analyze } from "./analyzer.mjs";
import { classifyUnmatched } from "./classifier.mjs";
import { buildTaxResolver, buildRuleCandidates, createRules } from "./rule-creator.mjs";
import { sendLine } from "./line.mjs";

/**
 * @param opts.dryRun          true: ルールを実際に作らない・LINEも本文プレビューのみ
 * @param opts.autoRegister    true: 確度highのルールを act=1(自動登録) で作る
 * @param opts.notify          true: LINE送信する（dryRunでも送りたい時用）
 */
export async function run({ dryRun = true, autoRegister = false, notify = true } = {}) {
  const freee = new FreeeClient();
  const log = (...a) => console.log("[run]", ...a);

  // 1. データ取得
  log("freeeからデータ取得中...");
  const [txns, rules, accountItems, taxCodeToName, ownerDrawItemNames] = await Promise.all([
    freee.getUnprocessedTxns(),
    freee.getUserMatchers(),
    freee.getAccountItems(),
    freee.getTaxCodeToName(),
    freee.getOwnerDrawItemNames(),
  ]);
  log(`未処理明細 ${txns.length}件 / ルール ${rules.length}件 / 費目 ${accountItems.length}件`);

  // 2. 分析
  const { matched, ownerDraw, unmatched, excluded } = analyze(txns, rules, ownerDrawItemNames);
  log(`既存ルール一致 ${matched.length} / 事業主貸 ${ownerDraw.length} / 未マッチ ${unmatched.length} / 除外 ${excluded.length}`);

  // 3. AI費目推定（未マッチのみ）
  const accountItemNames = accountItems.map((a) => a.name);
  let clsMap = new Map();
  if (unmatched.length > 0 && process.env.ANTHROPIC_API_KEY) {
    log(`Claudeで${unmatched.length}件を費目推定中...`);
    clsMap = await classifyUnmatched(unmatched, accountItemNames);
  } else if (unmatched.length > 0) {
    log(`⚠️ ANTHROPIC_API_KEY未設定のためAI費目推定をスキップ（${unmatched.length}件は全てグレー扱い）`);
  }

  // 未マッチにAI結果を付与
  const aiClassified = unmatched.map(({ txn, ambiguous }) => ({
    txn,
    ambiguous,
    cls: clsMap.get(txn.id) || null,
  }));

  // 4. ルール候補の組み立て＆作成
  const resolveTaxName = buildTaxResolver(accountItems, taxCodeToName, rules);
  const matchedByAI = aiClassified.filter((x) => x.cls);
  const { create, skip } = buildRuleCandidates({
    matchedByAI,
    existingRules: rules,
    resolveTaxName,
    autoRegisterHighConfidence: autoRegister,
  });
  log(`ルール作成候補 ${create.length}件（スキップ ${skip.length}件）`);

  const { created, failed } = await createRules(freee, create, { dryRun });
  log(`ルール作成 ${created.length}件${dryRun ? "(dryRun)" : ""} / 失敗 ${failed.length}件`);

  // 5. グレーリスト = ルール化しなかった未マッチ全部（確認が必要なもの）
  const createdTxnIds = new Set(created.map((c) => c.txn.id));
  const grayList = aiClassified
    .filter((x) => !createdTxnIds.has(x.txn.id))
    .sort((a, b) => b.txn.amount - a.txn.amount);

  const summary = {
    dryRun,
    totalUnprocessed: txns.length,
    matchedCount: matched.length,
    ownerDrawCount: ownerDraw.length,
    excludedCount: excluded.length,
    createdRules: created,
    failedRules: failed,
    grayList,
  };

  // 6. 通知
  if (notify) {
    const r = await sendLine(summary);
    log("LINE:", JSON.stringify(r).slice(0, 200));
  }

  return summary;
}
