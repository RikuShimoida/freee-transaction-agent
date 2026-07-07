#!/usr/bin/env node
/**
 * 【検証】user_matchers のPOSTが実際に通るか、1件だけ作って確かめる。
 * act=0（提案のみ）の安全なルールを作成し、作成後に確認して DELETE できる。
 *
 *   node --env-file=.env.local scripts/test-create-rule.mjs         # 作成
 *   node --env-file=.env.local scripts/test-create-rule.mjs --delete <id>  # 削除
 */
import { FreeeClient } from "../lib/freee.mjs";

const freee = new FreeeClient();
const args = process.argv.slice(2);

if (args[0] === "--delete") {
  const id = args[1];
  const r = await freee.request(`/api/1/user_matchers/${id}`, {
    method: "DELETE",
    params: { company_id: freee.companyId },
  });
  console.log("削除:", JSON.stringify(r));
  process.exit(0);
}

// 税区分名の解決確認
const [accountItems, taxMap, rules] = await Promise.all([
  freee.getAccountItems(),
  freee.getTaxCodeToName(),
  freee.getUserMatchers(),
]);

const shohin = accountItems.find((a) => a.name === "消耗品費");
const taxName = taxMap.get(shohin.default_tax_code);
console.log(`消耗品費 default_tax_code=${shohin.default_tax_code} → tax_name="${taxName}"`);

// 既存ルールで消耗品費に使われているtax_nameも確認
const existing = rules.find((r) => r.account_item_name === "消耗品費");
console.log(`既存ルールの消耗品費 tax_name="${existing?.tax_name}"`);

// テスト用ルール（一意なキーワードで重複回避）
const payload = {
  description: "ZZ_TEST_ニトリ_DELETEME",
  account_item_name: "消耗品費",
  tax_name: existing?.tax_name || taxName,
  walletable: "イオンクレジットサービス",
  entry_side_str: "expense",
  condition: 0,
  act: 0, // 提案のみ（安全）
  active: true,
  priority: 10,
  qualified_invoice_setting: "non_qualified",
};

console.log("\n作成するペイロード:");
console.log(JSON.stringify(payload, null, 2));

try {
  const res = await freee.createUserMatcher(payload);
  const id = res?.data?.id || res?.user_matcher?.id || res?.id;
  console.log(`\n✅ ルール作成成功！ id=${id}`);
  console.log("レスポンス:", JSON.stringify(res).slice(0, 500));
  console.log(`\n確認後の削除: node --env-file=.env.local scripts/test-create-rule.mjs --delete ${id}`);
} catch (e) {
  console.error("\n❌ 作成失敗:", e.message);
}
