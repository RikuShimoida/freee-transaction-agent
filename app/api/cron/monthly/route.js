/**
 * 月末自動実行エンドポイント（Vercel Cron から叩かれる）。
 *
 * Vercel Cron は Authorization: Bearer $CRON_SECRET を付けてくる。
 * これを検証してから run() を実行する。
 *
 * 本番の既定動作:
 *   dryRun=false（実際にルール作成）, autoRegister=false（提案ルール act=0）, notify=true
 * autoRegister を有効化したい場合はクエリ ?auto=1 で。
 */
import { run } from "../../../../lib/run.mjs";
import { CONFIG } from "../../../../lib/config.mjs";

export const maxDuration = 300; // Fluid Compute 上限に合わせる
export const dynamic = "force-dynamic";

export async function GET(request) {
  // Cron認証: Vercel Cron は Bearer $CRON_SECRET を付与する
  const auth = request.headers.get("authorization");
  if (CONFIG.cronSecret && auth !== `Bearer ${CONFIG.cronSecret}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const autoRegister = url.searchParams.get("auto") === "1";
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const summary = await run({ dryRun, autoRegister, notify: true });
    return Response.json({
      ok: true,
      dryRun,
      autoRegister,
      totalUnprocessed: summary.totalUnprocessed,
      matchedCount: summary.matchedCount,
      ownerDrawCount: summary.ownerDrawCount,
      excludedCount: summary.excludedCount,
      createdRules: summary.createdRules.length,
      failedRules: summary.failedRules.length,
      grayCount: summary.grayList.length,
    });
  } catch (e) {
    console.error("[cron] error:", e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
