/**
 * freee API クライアント。
 *
 * - トークンストア(Redis/ファイル)からアクセストークンを読む
 * - 401(expired_access_token)を受けたら自動でリフレッシュしてストアに再保存、1回だけ再試行
 * - リフレッシュトークンは1回使い捨てなので、更新後は必ず保存し直す
 */
import { CONFIG, OWNER_DRAW_CATEGORY } from "./config.mjs";
import { getTokenStore } from "./token-store.mjs";

export class FreeeClient {
  constructor() {
    this.store = getTokenStore();
    this.companyId = CONFIG.freee.companyId;
    this._tokens = null;
  }

  async _getAccessToken() {
    if (!this._tokens) this._tokens = await this.store.getTokens();
    if (!this._tokens || !this._tokens.access_token) {
      throw new Error("freeeトークンが保存されていません。get-token.mjs で初期取得してください。");
    }
    return this._tokens.access_token;
  }

  /** リフレッシュトークンでアクセストークンを更新し、ストアへ保存 */
  async refresh() {
    const tokens = this._tokens || (await this.store.getTokens());
    const res = await fetch(CONFIG.freee.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CONFIG.freee.clientId,
        client_secret: CONFIG.freee.clientSecret,
        refresh_token: tokens.refresh_token,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`トークンリフレッシュ失敗 (${res.status}): ${body}`);
    }
    const data = await res.json();
    this._tokens = { access_token: data.access_token, refresh_token: data.refresh_token };
    await this.store.saveTokens(this._tokens);
    return this._tokens;
  }

  /** 低レベルAPI呼び出し（401時に自動リフレッシュ＆再試行） */
  async request(path, { method = "GET", params = {}, body, _retried = false } = {}) {
    const url = new URL(CONFIG.freee.apiBase + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);

    const token = await this._getAccessToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Api-Version": CONFIG.freee.apiVersion,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !_retried) {
      await this.refresh();
      return this.request(path, { method, params, body, _retried: true });
    }

    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = text; }
    if (!res.ok) {
      const err = new Error(`freee API ${method} ${path} → ${res.status}: ${JSON.stringify(parsed)}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  // --- 高レベルメソッド ---

  async getCompanies() {
    const r = await this.request("/api/1/companies");
    return r.companies || [];
  }

  async getWalletables() {
    const r = await this.request("/api/1/walletables", { params: { company_id: this.companyId } });
    return r.walletables || [];
  }

  async getAccountItems() {
    const r = await this.request("/api/1/account_items", { params: { company_id: this.companyId } });
    return r.account_items || [];
  }

  /** 税区分コード → 表示名 のMapを返す */
  async getTaxCodeToName() {
    const r = await this.request(`/api/1/taxes/companies/${this.companyId}`);
    const taxes = r.taxes || [];
    const map = new Map();
    for (const t of taxes) map.set(t.code, t.name_ja || t.name);
    return map;
  }

  /** 事業主貸カテゴリの勘定科目名の集合を返す（判定用） */
  async getOwnerDrawItemNames() {
    const items = await this.getAccountItems();
    return new Set(
      items.filter((a) => a.account_category === OWNER_DRAW_CATEGORY).map((a) => a.name)
    );
  }

  /**
   * 指定口座の全明細をページングして取得。
   * walletable_type と walletable_id は同時指定必須。
   */
  async getWalletTxnsForWallet(walletableType, walletableId) {
    const all = [];
    let offset = 0;
    while (true) {
      const r = await this.request("/api/1/wallet_txns", {
        params: {
          company_id: this.companyId,
          walletable_type: walletableType,
          walletable_id: walletableId,
          limit: 100,
          offset,
        },
      });
      const txns = r.wallet_txns || [];
      all.push(...txns);
      if (txns.length < 100) break;
      offset += 100;
    }
    return all;
  }

  /**
   * 全口座の未処理明細(status=1=消込待ち)を取得。
   * 各明細に口座名(_walletName)を付与して返す。
   */
  async getUnprocessedTxns() {
    const wallets = await this.getWalletables();
    const result = [];
    for (const w of wallets) {
      const txns = await this.getWalletTxnsForWallet(w.type, w.id);
      for (const t of txns) {
        if (t.status === 1) result.push({ ...t, _walletName: w.name, _walletType: w.type });
      }
    }
    return result;
  }

  /** 自動登録ルール(user_matchers)を取得（activeなもの） */
  async getUserMatchers() {
    const all = [];
    let offset = 0;
    while (true) {
      const r = await this.request("/api/1/user_matchers", {
        params: { company_id: this.companyId, limit: 100, offset },
      });
      const rules = r.data || [];
      all.push(...rules);
      if (rules.length < 100) break;
      offset += 100;
    }
    return all;
  }

  /** 自動登録ルールを作成 */
  async createUserMatcher(payload) {
    return this.request("/api/1/user_matchers", {
      method: "POST",
      params: { company_id: this.companyId },
      body: { company_id: this.companyId, ...payload },
    });
  }
}
