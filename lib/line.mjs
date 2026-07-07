/**
 * LINE Messaging API による通知。
 *
 * 月末バッチの結果を push message で送る。
 * - 作成した自動登録ルールの件数
 * - グレー明細（確認が必要なもの）のリスト＋AIコメント
 *
 * LINEの1メッセージは5000文字上限。長い場合は分割送信する。
 */
import { CONFIG } from "./config.mjs";

const PUSH_URL = "https://api.line.me/v2/bot/message/push";
const MAX_LEN = 4800; // 5000上限に余裕を持たせる

function yen(n) {
  return "¥" + Number(n).toLocaleString("ja-JP");
}

/**
 * バッチ結果からLINEメッセージ本文（文字列配列＝複数バブル）を組み立てる。
 * @param summary run() が返す結果オブジェクト
 */
export function buildMessages(summary) {
  const { createdRules, grayList, excludedCount, ownerDrawCount, totalUnprocessed, dryRun } = summary;

  const lines = [];
  lines.push(`📊 freee未処理明細の自動処理レポート${dryRun ? "（ドライラン）" : ""}`);
  lines.push(`対象未処理: ${totalUnprocessed}件`);
  lines.push("");
  lines.push(`✅ ルール作成: ${createdRules.length}件`);
  for (const r of createdRules.slice(0, 15)) {
    const mode = r.candidate.act === 1 ? "自動登録" : "提案";
    lines.push(`　・「${r.candidate.description}」→ ${r.candidate.account_item_name}（${mode}）`);
  }
  if (createdRules.length > 15) lines.push(`　…他 ${createdRules.length - 15}件`);
  lines.push("");
  lines.push(`🏠 事業主貸候補: ${ownerDrawCount}件（freee側でルール登録推奨）`);
  lines.push(`🚫 カード引落等の除外: ${excludedCount}件`);
  lines.push("");
  lines.push(`🔶 要確認（グレー）: ${grayList.length}件`);
  lines.push("── 金額が大きい順・上位20件 ──");
  for (const g of grayList.slice(0, 20)) {
    const item = g.cls ? `${g.cls.account_item_name}?(${g.cls.confidence})` : "不明";
    const comment = g.cls?.comment ? ` ${g.cls.comment}` : "";
    lines.push(`・${yen(g.txn.amount)} ${g.txn.description}（${g.txn._walletName}）→ ${item}${comment}`);
  }
  if (grayList.length > 20) lines.push(`…他 ${grayList.length - 20}件`);
  lines.push("");
  lines.push("👉 グレー案件はfreeeの明細画面で確認・登録してください。");

  // 文字数で分割
  const text = lines.join("\n");
  const chunks = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if ((buf + "\n" + line).length > MAX_LEN) {
      chunks.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + "\n" + line : line;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/** LINEにpush送信。最大5メッセージ/回なので分割。 */
export async function sendLine(summary) {
  const chunks = buildMessages(summary);
  if (!CONFIG.line.channelAccessToken || !CONFIG.line.toUserId) {
    console.warn("⚠️ LINE未設定のため送信スキップ。本文プレビュー:\n" + chunks.join("\n---\n"));
    return { skipped: true, chunks };
  }

  // LINEは1リクエスト最大5メッセージ
  for (let i = 0; i < chunks.length; i += 5) {
    const messages = chunks.slice(i, i + 5).map((text) => ({ type: "text", text }));
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.line.channelAccessToken}`,
      },
      body: JSON.stringify({ to: CONFIG.line.toUserId, messages }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LINE送信失敗 (${res.status}): ${body}`);
    }
  }
  return { sent: chunks.length };
}
