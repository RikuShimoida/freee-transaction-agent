export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "40px auto", padding: "0 16px", lineHeight: 1.7 }}>
      <h1>freee 取引エージェント</h1>
      <p>
        freeeの未処理明細を毎月末に分析し、自動登録ルールを拡充して確定申告を楽にするエージェントです。
      </p>
      <ul>
        <li>未処理明細(status=1)を全口座から取得</li>
        <li>カード引き落とし合計行を除外（二重計上防止）</li>
        <li>既存の自動登録ルールと照合、未マッチはClaudeで費目推定</li>
        <li>確度の高いものは自動登録ルールを作成（登録・消込はfreeeに委譲）</li>
        <li>グレー案件はLINEに通知</li>
      </ul>
      <p style={{ color: "#888", fontSize: 14 }}>
        実行は Vercel Cron（毎月末）または <code>/api/run?token=…</code> の手動トリガー。
      </p>
    </main>
  );
}
