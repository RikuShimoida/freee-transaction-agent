/**
 * 自動登録ルール(user_matchers)の作成。
 *
 * AIが確度高と判定した未マッチ明細について、freeeの自動登録ルールを作る。
 * ルールを作れば、freeeの「自動で経理」が実際の取引登録・消込を行うため、
 * APIで直接dealを作る場合のような二重計上が起きない。
 *
 * act の意味:
 *   1 = 取引を自動登録（明細が自動で消込される。確度highに使う）
 *   0 = 取引を推測（freeeが提案するだけ。確度mediumに使う）
 */

/** account_item名 → デフォルト税区分名 を解決するためのヘルパ群を構築 */
export function buildTaxResolver(accountItems, taxCodeToName, existingRules) {
  // 既存ルールで実際に使われている「費目→tax_name」を最優先で流用
  const fromRules = new Map();
  for (const r of existingRules) {
    if (r.account_item_name && r.tax_name && !fromRules.has(r.account_item_name)) {
      fromRules.set(r.account_item_name, r.tax_name);
    }
  }
  // account_item.default_tax_code → 税区分名
  const fromItems = new Map();
  for (const a of accountItems) {
    if (a.name && a.default_tax_code != null) {
      const nm = taxCodeToName.get(a.default_tax_code);
      if (nm) fromItems.set(a.name, nm);
    }
  }
  return (accountItemName) => fromRules.get(accountItemName) || fromItems.get(accountItemName) || null;
}

/** 既存ルールと重複するか（description×費目×口座が一致） */
function isDuplicate(candidate, existingRules) {
  const key = (r) => `${(r.description || "").trim()}|${r.account_item_name || ""}|${r.walletable || ""}`;
  const target = `${candidate.description.trim()}|${candidate.account_item_name}|${candidate.walletable || ""}`;
  return existingRules.some((r) => key(r) === target);
}

/**
 * 分類結果からルール作成候補を組み立てる（まだ作成はしない）。
 * @returns {create: [...ペイロード], skip: [{reason, candidate}]}
 */
export function buildRuleCandidates({ matchedByAI, existingRules, resolveTaxName, autoRegisterHighConfidence = false }) {
  const create = [];
  const skip = [];

  for (const { txn, cls } of matchedByAI) {
    // ルール化に適さない（キーワード無し / 事業主貸 / 確度low）は作らない
    if (!cls.rule_keyword || cls.rule_keyword.trim() === "") {
      skip.push({ reason: "ルール化キーワードなし", txn, cls });
      continue;
    }
    if (cls.is_owner_draw || cls.account_item_name === "事業主貸") {
      skip.push({ reason: "事業主貸（ユーザーがfreee側でルール登録する方針）", txn, cls });
      continue;
    }
    if (cls.confidence === "low") {
      skip.push({ reason: "確度low", txn, cls });
      continue;
    }

    const taxName = resolveTaxName(cls.account_item_name);
    if (!taxName) {
      skip.push({ reason: `税区分名を解決できず(${cls.account_item_name})`, txn, cls });
      continue;
    }

    const candidate = {
      description: cls.rule_keyword.trim(),
      account_item_name: cls.account_item_name,
      tax_name: taxName,
      walletable: txn._walletName,
      entry_side_str: txn.entry_side,
      condition: 0, // 部分一致
      // 確度highかつ自動登録ONなら act=1(自動登録)、それ以外は 0(推測=提案のみ)
      act: autoRegisterHighConfidence && cls.confidence === "high" ? 1 : 0,
      active: true,
      priority: 10,
      qualified_invoice_setting: "non_qualified",
    };

    if (isDuplicate(candidate, existingRules)) {
      skip.push({ reason: "既存ルールと重複", txn, cls });
      continue;
    }
    create.push({ candidate, txn, cls });
  }

  return { create, skip };
}

/**
 * ルールを実際にfreeeへ作成する。
 * @param dryRun true なら作成せず候補を返すだけ
 */
export async function createRules(freee, candidates, { dryRun = true } = {}) {
  const created = [];
  const failed = [];
  for (const { candidate, txn, cls } of candidates) {
    if (dryRun) {
      created.push({ candidate, txn, cls, dryRun: true });
      continue;
    }
    try {
      const res = await freee.createUserMatcher(candidate);
      created.push({ candidate, txn, cls, result: res });
    } catch (e) {
      failed.push({ candidate, txn, cls, error: e.message });
    }
  }
  return { created, failed };
}
