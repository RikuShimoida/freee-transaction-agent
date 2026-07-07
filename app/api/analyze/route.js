/**
 * ダッシュボード用の分析API。
 *
 * GET  /api/analyze              → ドライラン分析（何も書き込まない）。画面表示用の詳細を返す
 * POST /api/analyze { apply, auto } → ルール作成を実行
 *
 * run() の結果を、画面で扱いやすいプレーンなJSONに整形して返す。
 */
import { run } from "../../../lib/run.mjs";
import { CONFIG } from "../../../lib/config.mjs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** run()のsummaryを画面向けJSONに整形 */
function toView(summary) {
  return {
    dryRun: summary.dryRun,
    counts: {
      totalUnprocessed: summary.totalUnprocessed,
      matched: summary.matchedCount,
      ownerDraw: summary.ownerDrawCount,
      excluded: summary.excludedCount,
      created: summary.createdRules.length,
      gray: summary.grayList.length,
    },
    createdRules: summary.createdRules.map((c) => ({
      keyword: c.candidate.description,
      accountItem: c.candidate.account_item_name,
      taxName: c.candidate.tax_name,
      wallet: c.candidate.walletable,
      act: c.candidate.act, // 0=提案, 1=自動登録
    })),
    gray: summary.grayList.map((g) => ({
      id: g.txn.id,
      date: g.txn.date,
      amount: g.txn.amount,
      description: g.txn.description,
      wallet: g.txn._walletName,
      entrySide: g.txn.entry_side,
      ai: g.cls
        ? {
            accountItem: g.cls.account_item_name,
            isOwnerDraw: g.cls.is_owner_draw,
            confidence: g.cls.confidence,
            comment: g.cls.comment,
          }
        : null,
    })),
  };
}

function authorized(request) {
  if (!CONFIG.cronSecret) return true; // 未設定ならローカル運用として許可
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("x-token");
  return token === CONFIG.cronSecret;
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    // 画面表示のみ。ルール作成もLINE送信もしない
    const summary = await run({ dryRun: true, autoRegister: false, notify: false });
    return Response.json({ ok: true, ...toView(summary) });
  } catch (e) {
    console.error("[analyze] error:", e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const apply = body.apply === true;
    const auto = body.auto === true;
    const notify = body.notify === true; // 画面からは既定で通知しない
    const summary = await run({ dryRun: !apply, autoRegister: auto, notify });
    return Response.json({ ok: true, applied: apply, ...toView(summary) });
  } catch (e) {
    console.error("[analyze] error:", e);
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
