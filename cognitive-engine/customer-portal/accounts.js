import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  isValidTier, isValidEmail, isValidCustomerId, nowIso,
} from "./types.js";

/**
 * Customer account store.
 *
 * D167: per-customer sandbox directory. Layout under `<root>/_customer-portal/`:
 *   _seq                           monotonic counter
 *   index.jsonl                    newest-last manifest (id, email, display_name, tier, created_at)
 *   token-index.json               {token_hash → customer_id} lookup
 *   customers/<customer_id>/
 *     account.json                 full record (incl. token_hashes[])
 *     submissions/                 populated by submissions.js
 *     timeline/                    populated by timeline.js
 *
 * D168: opaque bearer tokens. Plaintext returned once at creation or rotation;
 * only SHA-256 hashes stored. Token lookup is O(1) via `token-index.json`.
 */

const INDEX_FILE = "index.jsonl";
const TOKEN_INDEX_FILE = "token-index.json";
const SEQ_FILE = "_seq";

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf-8").digest("hex");
}

function generateToken() {
  // 32 bytes → 64 hex chars. Plenty of entropy.
  return `cpt_${crypto.randomBytes(32).toString("hex")}`;
}

async function atomicWriteJSON(destPath, data) {
  const tmp = destPath + ".tmp." + crypto.randomBytes(4).toString("hex");
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf-8");
  await fs.rename(tmp, destPath);
}

export function createAccountStore(rootDir) {
  const baseDir = path.join(rootDir, "_customer-portal");

  async function ensureBase() {
    await fs.mkdir(baseDir, { recursive: true });
    const indexPath = path.join(baseDir, INDEX_FILE);
    try { await fs.access(indexPath); } catch { await fs.writeFile(indexPath, "", "utf-8"); }
  }

  function customerDir(customerId) {
    if (!isValidCustomerId(customerId)) throw new Error(`invalid customer_id: ${customerId}`);
    return path.join(baseDir, "customers", customerId);
  }

  async function nextId() {
    await ensureBase();
    const seqPath = path.join(baseDir, SEQ_FILE);
    let n = 0;
    try { n = parseInt(await fs.readFile(seqPath, "utf-8"), 10) || 0; } catch {}
    n += 1;
    await fs.writeFile(seqPath, String(n), "utf-8");
    return `CUST-${String(n).padStart(4, "0")}`;
  }

  async function readTokenIndex() {
    try { return JSON.parse(await fs.readFile(path.join(baseDir, TOKEN_INDEX_FILE), "utf-8")); }
    catch (err) { if (err.code === "ENOENT") return {}; throw err; }
  }

  async function writeTokenIndex(idx) {
    await atomicWriteJSON(path.join(baseDir, TOKEN_INDEX_FILE), idx);
  }

  async function readAccount(customerId) {
    try {
      const raw = await fs.readFile(path.join(customerDir(customerId), "account.json"), "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === "ENOENT") return null;
      throw err;
    }
  }

  async function writeAccount(account) {
    const dir = customerDir(account.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.join(dir, "submissions"), { recursive: true });
    await fs.mkdir(path.join(dir, "timeline"), { recursive: true });
    await atomicWriteJSON(path.join(dir, "account.json"), account);
  }

  return {
    rootDir, baseDir,

    /**
     * Create a new customer account. Returns `{ account, token }` — the
     * plaintext token is surfaced ONCE; store it. Only the SHA-256 hash is
     * retained. (D168)
     */
    async createAccount({ email, display_name, tier = "free", meta }) {
      if (!isValidEmail(email)) throw new Error(`invalid email: ${email}`);
      if (!display_name || typeof display_name !== "string") throw new Error("display_name required");
      if (!isValidTier(tier)) throw new Error(`invalid tier: ${tier}`);

      await ensureBase();

      // Enforce email uniqueness via linear index scan; OK at R&D scale.
      const allMeta = await this.list();
      if (allMeta.some(a => a.email === email)) {
        throw new Error(`email already registered: ${email}`);
      }

      const id = await nextId();
      const token = generateToken();
      const tokenHash = sha256Hex(token);

      const account = {
        id,
        email,
        display_name,
        tier,
        created_at: nowIso(),
        token_hashes: [tokenHash],
      };
      if (meta) account.meta = meta;

      await writeAccount(account);

      // Token index + public manifest index
      const tokenIdx = await readTokenIndex();
      tokenIdx[tokenHash] = id;
      await writeTokenIndex(tokenIdx);

      await fs.appendFile(
        path.join(baseDir, INDEX_FILE),
        JSON.stringify({ id, email, display_name, tier, created_at: account.created_at }) + "\n",
        "utf-8"
      );

      return { account: stripSecrets(account), token };
    },

    /**
     * Look up an account by bearer token. Returns null for invalid/unknown.
     */
    async authenticate(token) {
      if (typeof token !== "string" || !token) return null;
      const hash = sha256Hex(token);
      const tokenIdx = await readTokenIndex();
      const customerId = tokenIdx[hash];
      if (!customerId) return null;
      const account = await readAccount(customerId);
      if (!account || !account.token_hashes?.includes(hash)) return null;
      return stripSecrets(account);
    },

    async getById(customerId) {
      const account = await readAccount(customerId);
      return account ? stripSecrets(account) : null;
    },

    async list() {
      await ensureBase();
      try {
        const raw = await fs.readFile(path.join(baseDir, INDEX_FILE), "utf-8");
        if (!raw.trim()) return [];
        return raw.split("\n").filter(Boolean).map(l => JSON.parse(l));
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },

    /**
     * Rotate token: add a new one, optionally revoke all previous.
     * Returns plaintext of the new token.
     */
    async rotateToken(customerId, { revokePrevious = false } = {}) {
      const account = await readAccount(customerId);
      if (!account) throw new Error(`unknown customer: ${customerId}`);

      const token = generateToken();
      const tokenHash = sha256Hex(token);

      const tokenIdx = await readTokenIndex();

      if (revokePrevious) {
        for (const prev of account.token_hashes || []) {
          delete tokenIdx[prev];
        }
        account.token_hashes = [tokenHash];
      } else {
        account.token_hashes = [...(account.token_hashes || []), tokenHash];
      }

      tokenIdx[tokenHash] = customerId;
      await writeAccount(account);
      await writeTokenIndex(tokenIdx);

      return token;
    },

    async revokeToken(customerId, tokenPlaintext) {
      const account = await readAccount(customerId);
      if (!account) throw new Error(`unknown customer: ${customerId}`);
      const hash = sha256Hex(tokenPlaintext);
      if (!account.token_hashes?.includes(hash)) {
        return { ok: false, error: "token not found on this account" };
      }
      account.token_hashes = account.token_hashes.filter(h => h !== hash);
      const tokenIdx = await readTokenIndex();
      delete tokenIdx[hash];
      await writeAccount(account);
      await writeTokenIndex(tokenIdx);
      return { ok: true };
    },

    async setTier(customerId, tier) {
      if (!isValidTier(tier)) throw new Error(`invalid tier: ${tier}`);
      const account = await readAccount(customerId);
      if (!account) throw new Error(`unknown customer: ${customerId}`);
      account.tier = tier;
      await writeAccount(account);
      // Rewrite manifest index entry (simple approach: rewrite the whole file)
      const entries = await this.list();
      const updated = entries.map(e => e.id === customerId ? { ...e, tier } : e);
      const lines = updated.map(e => JSON.stringify(e)).join("\n");
      await fs.writeFile(path.join(baseDir, INDEX_FILE), lines + (updated.length ? "\n" : ""), "utf-8");
      return stripSecrets(account);
    },

    customerDir,
  };
}

function stripSecrets(account) {
  if (!account) return account;
  // token_hashes are hashes so leaking them isn't catastrophic, but the
  // returned record by convention is callable as a public account snapshot.
  const { token_hashes, ...rest } = account;
  return rest;
}
