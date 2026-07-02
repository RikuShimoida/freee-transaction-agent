/**
 * freeeトークンの永続化。
 *
 * freeeのアクセストークンは6時間で失効し、リフレッシュのたびに
 * access_token / refresh_token の両方が更新される（リフレッシュトークンは
 * 1回使い捨て）。そのため更新後のトークンを保存し直す場所が必要。
 *
 * - 本番(Vercel): Upstash Redis(Vercel KV)に保存
 * - ローカル: .env.local ファイルに書き戻す
 *
 * どちらも {getTokens, saveTokens} という同じインターフェースで扱う。
 */

const KEY = "freee:tokens";

// --- Redis バックエンド（本番） ---
function redisStore() {
  // 動的import: ローカルで@upstash/redisが無くても他機能に影響しないよう遅延
  let redis;
  async function client() {
    if (!redis) {
      const { Redis } = await import("@upstash/redis");
      redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / _TOKEN を読む
    }
    return redis;
  }
  return {
    async getTokens() {
      const r = await client();
      const v = await r.get(KEY);
      return v || null; // Upstashは自動でJSONパースする
    },
    async saveTokens(tokens) {
      const r = await client();
      await r.set(KEY, tokens);
    },
  };
}

// --- ファイルバックエンド（ローカル） ---
function fileStore() {
  return {
    async getTokens() {
      const { readFileSync } = await import("node:fs");
      try {
        const raw = readFileSync(".env.local", "utf8");
        const get = (k) => (raw.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1] || "";
        const access = get("FREEE_ACCESS_TOKEN");
        const refresh = get("FREEE_REFRESH_TOKEN");
        return access ? { access_token: access, refresh_token: refresh } : null;
      } catch {
        return null;
      }
    },
    async saveTokens(tokens) {
      const { readFileSync, writeFileSync } = await import("node:fs");
      let raw = readFileSync(".env.local", "utf8");
      const set = (k, v) => {
        raw = new RegExp(`^${k}=.*$`, "m").test(raw)
          ? raw.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`)
          : raw + `\n${k}=${v}`;
      };
      set("FREEE_ACCESS_TOKEN", tokens.access_token);
      set("FREEE_REFRESH_TOKEN", tokens.refresh_token);
      writeFileSync(".env.local", raw);
    },
  };
}

/**
 * 環境に応じたストアを返す。
 * Upstashの環境変数があればRedis、なければファイル。
 */
export function getTokenStore() {
  if (process.env.UPSTASH_REDIS_REST_URL) return redisStore();
  return fileStore();
}
