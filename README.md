# freee 取引エージェント

freeeの「未処理明細」を毎月末に自動で分析し、**自動登録ルールを拡充**して確定申告を楽にするエージェントです。

## これは何をするのか

1. freeeの全口座から**未処理明細（消込待ち = status 1）**を取得する
2. **カード引き落とし合計行**（銀行明細に出る「楽天カードサービス」等）を除外する（カード個別明細との二重計上を防ぐ）
3. あなたがfreeeに登録済みの**自動登録ルール**と照合し、費目が一意に決まるものを仕分ける
4. ルール未マッチの明細を **Claude（AI）が費目推定**する
5. 確度の高いものは**自動登録ルールを新規作成**する（実際の登録・消込はfreeeの「自動で経理」に任せる）
6. 判断が微妙な**グレー案件はLINEに通知**する

### なぜ「直接登録」ではなく「ルール作成」なのか

freee APIで取引（deal）を直接登録しても、**元の明細は未処理のまま残り二重計上**になります（明細を消し込むAPIが存在しないことを実データで確認済み）。そこで、freee本来の「自動で経理」に乗るよう**ルールを拡充する**方式にしています。これなら二重計上せず、未処理明細が減ります。

### グレー扱い（自動登録しない）になるもの

- **事業主貸**カテゴリの費目（投信積立・国民年金・住民税・家族への振込・ATM出金など私的支出）
- freeeのルールにも未マッチで、AIの確度も低いもの
- 同一明細に複数ルールがマッチし費目が一意に決まらないもの

---

## セットアップ

### 1. 依存インストール

```bash
npm install
```

### 2. 環境変数

`.env.local.example` を `.env.local` にコピーして値を埋めます（`.env.local` はGit管理外）。

```bash
cp .env.local.example .env.local
```

| 変数 | 用途 | 必須 |
|---|---|---|
| `FREEE_CLIENT_ID` / `FREEE_CLIENT_SECRET` | freeeアプリのOAuth認証情報 | ○ |
| `FREEE_ACCESS_TOKEN` / `FREEE_REFRESH_TOKEN` | freeeトークン（下記スクリプトで取得） | ○ |
| `FREEE_COMPANY_ID` | 事業所ID（空なら先頭の事業所を自動採用） | － |
| `ANTHROPIC_API_KEY` | AI費目推定に使用。未設定なら未マッチは全てグレー扱い | △ |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_TO_USER_ID` | LINE通知先。未設定なら本文をコンソール出力 | △ |
| `CRON_SECRET` | Cron/手動トリガーの認証 | 本番○ |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | 本番のトークン保存先。ローカルは未設定でOK | 本番○ |

### 3. freeeトークンの初回取得

```bash
node scripts/get-token.mjs
```

表示されるURLをブラウザで開いて「許可」し、認可コードを貼り付けると、トークンが `.env.local` に保存されます。
（トークンは6時間で失効しますが、実行時に自動でリフレッシュされます。手動更新は `node scripts/refresh-token.mjs`）

---

## 使い方

### ローカルで実行する

いきなり本番登録せず、**まずドライラン**（何も作成しない・LINE本文はコンソール表示）で結果を確認します。

```bash
# ① ドライラン（安全・デフォルト）— 分析結果とグレー一覧を表示するだけ
npm run analyze

# ② ルールを実際に作成する（act=0 = freeeが提案するだけ、あなたが確定）
node --env-file=.env.local scripts/run-local.mjs --apply

# ③ 確度highのものを act=1（freeeが今後自動で登録・消込）で作成
node --env-file=.env.local scripts/run-local.mjs --apply --auto

# LINEに送らず手元で確認だけしたい場合
node --env-file=.env.local scripts/run-local.mjs --no-notify
```

> **推奨の慣らし運用**: まず `npm run analyze` で全体像を見て、次に `--apply`（act=0=提案のみ）でルールを増やし、freeeの提案精度に納得したら `--auto`（act=1=自動登録）に切り替える。

### 本番（Vercel）で自動実行する

デプロイ後は **毎月28日に Vercel Cron が自動実行**します（`vercel.json` の `crons` で設定）。

手動で実行したいときは、ブラウザやcurlで:

```bash
# ドライラン
curl "https://<your-app>.vercel.app/api/run?token=$CRON_SECRET"

# ルール作成（act=0）
curl "https://<your-app>.vercel.app/api/run?token=$CRON_SECRET&apply=1"

# 確度high=自動登録(act=1)
curl "https://<your-app>.vercel.app/api/run?token=$CRON_SECRET&apply=1&auto=1"
```

---

## 実行後にあなたがすること

1. LINEに届いた**グレー案件**を見る
2. freeeの「自動で経理」画面を開く
3. 新しく作られたルールの提案を確認して登録（act=0の場合）／自動登録済みを確認（act=1の場合）
4. グレー案件は手動で費目を選んで登録、または新しいルールを自分で追加

事業主貸候補（投信・年金など）は、freee側で「事業主貸」の自動登録ルールを登録しておくと、次回から自動で仕分けされます。

---

## スクリプト一覧

| スクリプト | 用途 |
|---|---|
| `scripts/get-token.mjs` | freeeトークンの初回取得（OAuth） |
| `scripts/refresh-token.mjs` | アクセストークンの手動リフレッシュ |
| `scripts/verify-freee.mjs` | freee API接続の読み取り専用チェック |
| `scripts/simulate.mjs` | 未処理明細×既存ルールの照合シミュレーション |
| `scripts/run-local.mjs` | 本体をローカル実行（ドライラン/本番） |

## 安全設計

- 取引の直接登録は行わない（二重計上を防ぐため廃止）
- デフォルトは常にドライラン。作成は明示的な `--apply` が必要
- グレー案件は登録せず通知のみ
- トークン等の秘密情報は環境変数のみ。コード・Gitには含めない
