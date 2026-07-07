/**
 * 明細分析エンジン。
 *
 * 未処理明細(status=1)を、既存の自動登録ルールと照合し、
 *   - matched:   ルールが一意にマッチ（費目が確定・事業主貸以外）
 *   - ownerDraw: マッチ結果が事業主貸カテゴリ
 *   - unmatched: ルール未マッチ（→AI費目推定へ）
 *   - excluded:  カード引き落とし合計行（二重計上防止で除外）
 * に分類する。
 */
import { CARD_SETTLEMENT_KEYWORDS } from "./config.mjs";

/** 全角英数記号・長音を正規化して素朴な部分一致照合に使う */
export function norm(s) {
  return (s || "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー―－]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** カード引き落とし合計行か判定（銀行口座の明細のみ対象） */
export function isCardSettlement(txn) {
  if (txn._walletType !== "bank_account") return false;
  const d = norm(txn.description);
  return CARD_SETTLEMENT_KEYWORDS.some((kw) => d.includes(norm(kw)));
}

/** 1明細に対しマッチするルール配列を返す */
export function matchRules(txn, rules) {
  const desc = norm(txn.description);
  return rules.filter((r) => {
    if (r.entry_side_str && r.entry_side_str !== txn.entry_side) return false;
    if (r.walletable && norm(r.walletable) !== norm(txn._walletName)) return false;
    if (r.min_amount != null && txn.amount < r.min_amount) return false;
    if (r.max_amount != null && txn.amount > r.max_amount) return false;
    const kw = norm(r.description);
    return kw && desc.includes(kw);
  });
}

/**
 * 明細群を分類する。
 * @param txns 未処理明細（_walletName/_walletType付き）
 * @param rules user_matchers（active想定）
 * @param ownerDrawItemNames 事業主貸カテゴリの費目名Set
 */
export function analyze(txns, rules, ownerDrawItemNames) {
  const activeRules = rules.filter((r) => r.active !== false);
  const matched = [];    // {txn, item, rule}
  const ownerDraw = [];  // {txn, item}
  const unmatched = [];  // {txn}
  const excluded = [];   // {txn, reason}

  for (const txn of txns) {
    if (isCardSettlement(txn)) {
      excluded.push({ txn, reason: "カード引き落とし合計行（二重計上防止）" });
      continue;
    }
    const hits = matchRules(txn, activeRules);
    const items = [...new Set(hits.map((h) => h.account_item_name))];

    if (hits.length === 0) {
      unmatched.push({ txn });
    } else if (items.length > 1) {
      // 複数候補で費目が一意に決まらない → グレー（未マッチ扱いでAIに委ねる）
      unmatched.push({ txn, ambiguous: items });
    } else if (ownerDrawItemNames.has(items[0])) {
      ownerDraw.push({ txn, item: items[0] });
    } else {
      matched.push({ txn, item: items[0], rule: hits[0] });
    }
  }

  return { matched, ownerDraw, unmatched, excluded };
}
