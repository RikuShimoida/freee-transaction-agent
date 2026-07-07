"use client";

import { useState } from "react";

const yen = (n) => "¥" + Number(n).toLocaleString("ja-JP");

const CONF_COLOR = { high: "#15803d", medium: "#b45309", low: "#6b7280" };

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/analyze");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "分析に失敗しました");
      setData(json);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function createRules(auto) {
    const mode = auto ? "確度high=自動登録(act=1)" : "提案ルール(act=0)";
    if (!confirm(`${mode} でfreeeにルールを作成します。よろしいですか？`)) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, auto }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "作成に失敗しました");
      setData(json);
      setNotice(`ルールを ${json.counts.created} 件作成しました。`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setApplying(false);
    }
  }

  const c = data?.counts;

  return (
    <main style={S.main}>
      <header style={S.header}>
        <h1 style={S.h1}>freee 取引エージェント</h1>
        <p style={S.sub}>未処理明細を分析し、自動登録ルールを拡充します。まずは分析（ドライラン）から。</p>
      </header>

      <div style={S.actions}>
        <button onClick={analyze} disabled={loading} style={S.btnPrimary}>
          {loading ? "分析中…（1〜2分かかります）" : "① 分析する（安全・書き込みなし）"}
        </button>
        {data && (
          <>
            <button onClick={() => createRules(false)} disabled={applying} style={S.btn}>
              {applying ? "作成中…" : "② 提案ルールを作成"}
            </button>
            <button onClick={() => createRules(true)} disabled={applying} style={S.btnWarn}>
              ③ 自動登録ルールを作成
            </button>
          </>
        )}
      </div>

      {error && <div style={S.error}>⚠️ {error}</div>}
      {notice && <div style={S.notice}>✅ {notice}</div>}

      {c && (
        <>
          <section style={S.cards}>
            <Card label="未処理明細" value={c.totalUnprocessed} />
            <Card label="既存ルール一致" value={c.matched} color="#15803d" />
            <Card label="事業主貸候補" value={c.ownerDraw} color="#7c3aed" />
            <Card label="カード引落等 除外" value={c.excluded} color="#6b7280" />
            <Card label="ルール作成" value={c.created} color="#2563eb" />
            <Card label="要確認（グレー）" value={c.gray} color="#b45309" />
          </section>

          {data.createdRules.length > 0 && (
            <section style={S.section}>
              <h2 style={S.h2}>作成したルール（{data.createdRules.length}）</h2>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>キーワード</th>
                    <th style={S.th}>費目</th>
                    <th style={S.th}>税区分</th>
                    <th style={S.th}>口座</th>
                    <th style={S.th}>種別</th>
                  </tr>
                </thead>
                <tbody>
                  {data.createdRules.map((r, i) => (
                    <tr key={i}>
                      <td style={S.td}>{r.keyword}</td>
                      <td style={S.td}>{r.accountItem}</td>
                      <td style={S.td}>{r.taxName}</td>
                      <td style={S.td}>{r.wallet}</td>
                      <td style={S.td}>{r.act === 1 ? "自動登録" : "提案"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section style={S.section}>
            <h2 style={S.h2}>要確認（グレー） {data.gray.length}件 — 金額が大きい順</h2>
            <p style={S.hint}>
              AI推定は目安です。freeeの明細画面で確認して登録してください。
              事業主貸候補（投信・年金など）はfreee側で事業主貸ルールを登録すると次回から自動仕分けされます。
            </p>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>日付</th>
                  <th style={{ ...S.th, textAlign: "right" }}>金額</th>
                  <th style={S.th}>摘要</th>
                  <th style={S.th}>口座</th>
                  <th style={S.th}>AI推定費目</th>
                  <th style={S.th}>確度</th>
                  <th style={S.th}>コメント</th>
                </tr>
              </thead>
              <tbody>
                {data.gray.map((g) => (
                  <tr key={g.id}>
                    <td style={S.tdSm}>{g.date}</td>
                    <td style={{ ...S.td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{yen(g.amount)}</td>
                    <td style={S.td}>{g.description}</td>
                    <td style={S.tdSm}>{g.wallet}</td>
                    <td style={S.td}>
                      {g.ai ? (
                        <span>
                          {g.ai.accountItem}
                          {g.ai.isOwnerDraw && <span style={S.tag}>事業主貸</span>}
                        </span>
                      ) : (
                        <span style={{ color: "#9ca3af" }}>—（AI未実行）</span>
                      )}
                    </td>
                    <td style={S.tdSm}>
                      {g.ai && (
                        <span style={{ color: CONF_COLOR[g.ai.confidence] || "#6b7280", fontWeight: 600 }}>
                          {g.ai.confidence}
                        </span>
                      )}
                    </td>
                    <td style={{ ...S.tdSm, color: "#6b7280", maxWidth: 240 }}>{g.ai?.comment || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {!c && !loading && (
        <p style={S.empty}>「① 分析する」を押すと、freeeの未処理明細を取得して分析します。</p>
      )}
    </main>
  );
}

function Card({ label, value, color = "#111827" }) {
  return (
    <div style={S.card}>
      <div style={S.cardLabel}>{label}</div>
      <div style={{ ...S.cardValue, color }}>{value}</div>
    </div>
  );
}

const S = {
  main: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", maxWidth: 1080, margin: "0 auto", padding: "32px 20px", color: "#111827" },
  header: { marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, margin: 0 },
  sub: { color: "#6b7280", marginTop: 6, fontSize: 14 },
  actions: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 },
  btnPrimary: { padding: "12px 20px", fontSize: 15, fontWeight: 600, color: "#fff", background: "#2563eb", border: "none", borderRadius: 8, cursor: "pointer" },
  btn: { padding: "12px 20px", fontSize: 15, fontWeight: 600, color: "#2563eb", background: "#fff", border: "1px solid #2563eb", borderRadius: 8, cursor: "pointer" },
  btnWarn: { padding: "12px 20px", fontSize: 15, fontWeight: 600, color: "#b45309", background: "#fff", border: "1px solid #d97706", borderRadius: 8, cursor: "pointer" },
  error: { background: "#fef2f2", color: "#b91c1c", padding: "12px 16px", borderRadius: 8, marginBottom: 16, fontSize: 14 },
  notice: { background: "#f0fdf4", color: "#15803d", padding: "12px 16px", borderRadius: 8, marginBottom: 16, fontSize: 14 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 28 },
  card: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px" },
  cardLabel: { fontSize: 12, color: "#6b7280" },
  cardValue: { fontSize: 26, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  section: { marginBottom: 32 },
  h2: { fontSize: 17, fontWeight: 700, marginBottom: 8 },
  hint: { fontSize: 13, color: "#6b7280", marginBottom: 12, lineHeight: 1.6 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #e5e7eb", color: "#374151", fontWeight: 600, whiteSpace: "nowrap" },
  td: { padding: "8px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" },
  tdSm: { padding: "8px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top", fontSize: 12, color: "#4b5563", whiteSpace: "nowrap" },
  tag: { marginLeft: 6, fontSize: 11, background: "#ede9fe", color: "#7c3aed", padding: "1px 6px", borderRadius: 4 },
  empty: { color: "#9ca3af", textAlign: "center", padding: "48px 0" },
};
