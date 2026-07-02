/**
 * 設定と定数。環境変数から読む。
 * ローカルでは `node --env-file=.env.local` で読み込む前提。
 */

export const CONFIG = {
  freee: {
    clientId: process.env.FREEE_CLIENT_ID,
    clientSecret: process.env.FREEE_CLIENT_SECRET,
    companyId: Number(process.env.FREEE_COMPANY_ID || "3139320"),
    apiBase: "https://api.freee.co.jp",
    tokenUrl: "https://accounts.secure.freee.co.jp/public_api/token",
    apiVersion: "2020-06-15",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-opus-4-8",
  },
  line: {
    // LINE Messaging API のチャネルアクセストークンと送信先ユーザーID
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    toUserId: process.env.LINE_TO_USER_ID,
  },
  cronSecret: process.env.CRON_SECRET,
};

/**
 * 事業主貸の勘定科目カテゴリ名。
 * 明細がこのカテゴリの費目に割り当たる場合、自動登録せずグレー扱いにする。
 */
export const OWNER_DRAW_CATEGORY = "事業主貸";

/**
 * カード引き落とし合計行を判定するためのキーワード。
 * 銀行明細に現れる「楽天カードサービス」「PAYPAYカード」などは、
 * カード個別明細と二重計上になるため処理対象から除外する。
 */
export const CARD_SETTLEMENT_KEYWORDS = [
  "カ-ドサ-ビス", "カードサービス",
  "PAYPAYカ-ド", "PAYPAYカード", "ペイペイカ-ド",
  "ラクテンカ-ド", "楽天カード",
  "ミツイスミトモカ-ド", "三井住友カード",
  "セゾン", "トヨタフアイナンス", "トヨタファイナンス",
  "ジエ-シ-ビ-", "ＪＣＢ", "JCB",
  "イオンクレジット", "エポスカ-ド", "エポスカード",
];
