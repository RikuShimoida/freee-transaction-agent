/**
 * 手動トリガー用エンドポイント。
 *
 * 初回動作確認や、任意タイミングで実行したいときに使う。
 * ?token=$CRON_SECRET で認証。既定はドライラン（安全）。
 *   /api/run?token=xxx           → ドライラン
 *   /api/run?token=xxx&apply=1   → ルール作成
 *   /api/run?token=xxx&apply=1&auto=1 → 確度high=自動登録(act=1)
 */
import { run } from "../../../lib/run.mjs";
import { CONFIG } from "../../../lib/config.mjs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (CONFIG.cronSecret && token !== CONFIG.cronSecret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dryRun = url.searchParams.get("apply") !== "1";
  const autoRegister = url.searchParams.get("auto") === "1";
  const notify = url.searchParams.get("notify") !== "0";

  try {
    const summary = await run({ dryRun, autoRegister, notify });
    return Response.json({
      ok: true,
      dryRun,
      autoRegister,
      totalUnprocessed: summary.totalUnprocessed,
      matchedCount: summary.matchedCount,
      ownerDrawCount: summary.ownerDrawCount,
      excludedCount: summary.excludedCount,
      createdRules: summary.createdRules.map((c) => ({
        keyword: c.candidate.description,
        item: c.candidate.account_item_name,
        act: c.candidate.act,
      })),
      grayCount: summary.grayList.length,
    });
  } catch (e) {
    console.error("[run] error:", e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
