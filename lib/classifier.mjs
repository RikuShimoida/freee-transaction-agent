/**
 * Claude API による未マッチ明細の費目推定。
 *
 * ルール未マッチの明細について、店名(description)と既存費目リストから
 * 「適切な費目」「確度」「事業主貸かどうか」「ルール化に使えるキーワード」を推定する。
 *
 * 出力は structured outputs (zod) で型を保証。
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CONFIG } from "./config.mjs";

const ClassificationSchema = z.object({
  results: z.array(
    z.object({
      txn_id: z.number().describe("入力で与えた明細のtxn_id"),
      account_item_name: z
        .string()
        .describe("提案する勘定科目名。必ず与えた費目候補リストの中から選ぶ"),
      is_owner_draw: z
        .boolean()
        .describe("事業と無関係の私的支出（投信/年金/税金/家族への振込/生活費など）なら true"),
      confidence: z
        .enum(["high", "medium", "low"])
        .describe("推定の確度。店名から明確に判断できるものだけ high"),
      rule_keyword: z
        .string()
        .describe("この明細をルール化する際のキーワード。descriptionの安定部分（店名等）を抜き出す。ルール化に適さないなら空文字"),
      comment: z.string().describe("判断理由を日本語で一言"),
    })
  ),
});

/**
 * 未マッチ明細をClaudeで分類する。
 * @param unmatched analyzer.analyze() の unmatched 配列
 * @param accountItemNames 選択可能な費目名の配列（freeeのaccount_items.name）
 * @returns Map<txn_id, 分類結果>
 */
export async function classifyUnmatched(unmatched, accountItemNames) {
  if (unmatched.length === 0) return new Map();

  const client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });

  // 明細を軽量な形に整形（トークン節約）
  const items = unmatched.map(({ txn, ambiguous }) => ({
    txn_id: txn.id,
    description: txn.description,
    amount: txn.amount,
    entry_side: txn.entry_side,
    wallet: txn._walletName,
    ...(ambiguous ? { ambiguous_candidates: ambiguous } : {}),
  }));

  const system = [
    "あなたは日本の個人事業主の経理アシスタントです。",
    "クレジットカード/銀行口座の未処理明細について、店名や摘要から最も適切な勘定科目を推定します。",
    "重要な原則:",
    "- account_item_name は必ず与えられた「費目候補リスト」の中の名称と完全一致させること。",
    "- 投資信託積立・国民年金・国民年金基金・住民税・所得税・家族への振込・ATM出金・生活費など、",
    "  事業と無関係の私的支出は is_owner_draw=true とし、費目は「事業主貸」を選ぶこと。",
    "- 店名から費目が明確に判断できるものだけ confidence=high。曖昧なものは medium/low。",
    "- rule_keyword は description の中で繰り返し現れそうな安定部分（店名など）を抜き出す。",
    "  日付や連番など変動する部分は含めない。ルール化に適さなければ空文字。",
  ].join("\n");

  const user = [
    "## 費目候補リスト（この中から必ず選ぶ）",
    accountItemNames.join(", "),
    "",
    "## 分類する明細（JSON）",
    JSON.stringify(items, null, 2),
    "",
    "各明細について results 配列で分類結果を返してください。txn_id は入力のものをそのまま使うこと。",
  ].join("\n");

  const response = await client.messages.parse({
    model: CONFIG.anthropic.model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(ClassificationSchema) },
  });

  const parsed = response.parsed_output;
  const map = new Map();
  if (parsed && parsed.results) {
    for (const r of parsed.results) map.set(r.txn_id, r);
  }
  return map;
}
