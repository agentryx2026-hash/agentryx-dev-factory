/**
 * Phase 9-B HMAC verification for the Verify portal feedback webhook.
 *
 * The webhook endpoint at /api/factory-admin/verify/webhook accepts
 * FeedbackPayload posts from the Verify portal. Without authentication
 * any actor with reachability to the factory's telemetry HTTP server
 * can write user_note observations + trigger fix-route planning. Per
 * D213 we deferred auth in the substrate ship "until there's a
 * Verify-stg deploy to coordinate with"; this module is the
 * coordination contract.
 *
 * Contract:
 *   - Verify-side signer computes `signature = HMAC-SHA256(secret, raw_body_bytes)`
 *     and hex-encodes it
 *   - Header `X-Verify-Signature: <hex>` carries it
 *   - Factory-side verifier recomputes from `process.env.VERIFY_WEBHOOK_SECRET`
 *     and `timingSafeEqual`-compares
 *   - Missing header OR mismatched signature → reject (401)
 *
 * Dev / single-VM v0.0.1 posture (D218 below):
 *   - When `VERIFY_WEBHOOK_SECRET` is UNSET in the env, verification is
 *     skipped with a warn log on every request. This preserves the
 *     "webhook is live but unauthenticated" substrate behaviour from
 *     the 9-B initial ship, gated on an explicit opt-out (no secret
 *     configured). Once the founder sets the secret, every subsequent
 *     request must carry a valid signature.
 *   - Per-environment opt-in (set the secret per VM, not per code path).
 *
 * Why HMAC-SHA256 (not JWT, not OAuth):
 *   - Verify-stg already signs internal webhooks with HMAC-SHA256 (same
 *     pattern as Slack / Stripe / GitHub webhook signing). Matching the
 *     industry convention saves Verify-side work.
 *   - No issuance / rotation infrastructure needed at v0.0.1; rotate by
 *     editing one env var on each side. Phase 22 (Action Boundary
 *     Enforcement, v2→v3) replaces this with proper signer + key rotation.
 *   - Constant-time compare prevents timing-attack signature recovery.
 */

import crypto from "node:crypto";

/**
 * Compute an HMAC-SHA256 signature over `rawBody` using `secret`.
 * Returns hex string. Exported for the smoke test + for any future
 * factory-side caller that needs to sign outbound requests.
 *
 * @param {string|Buffer} rawBody
 * @param {string} secret
 * @returns {string} hex-encoded signature
 */
export function computeHmacSignature(rawBody, secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("computeHmacSignature: secret required (non-empty string)");
  }
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Verify `signatureHeader` is a valid HMAC-SHA256 hex of `rawBody`
 * under `secret`. Constant-time compare.
 *
 * @param {string|Buffer} rawBody
 * @param {string} signatureHeader   value of X-Verify-Signature (hex)
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyHmacSignature(rawBody, signatureHeader, secret) {
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) return false;
  if (typeof secret !== "string" || secret.length === 0) return false;
  let expected;
  try { expected = computeHmacSignature(rawBody, secret); } catch { return false; }
  // Buffer.from below throws on non-hex; treat as mismatch.
  let provided;
  try {
    provided = Buffer.from(signatureHeader, "hex");
  } catch { return false; }
  const expectedBuf = Buffer.from(expected, "hex");
  if (provided.length !== expectedBuf.length) return false;
  try { return crypto.timingSafeEqual(provided, expectedBuf); }
  catch { return false; }
}

/**
 * Decide if a request should be admitted based on signature + secret.
 * Returns a discriminated union so callers can pick HTTP responses cleanly.
 *
 *   { ok: true,  bypassed: false }   secret configured + signature valid
 *   { ok: true,  bypassed: true,  warning }   secret unset → dev-mode bypass
 *   { ok: false, reason: "missing_signature" | "invalid_signature" }
 *
 * @param {string|Buffer} rawBody
 * @param {string|undefined} signatureHeader
 * @param {string|undefined} secret   typically process.env.VERIFY_WEBHOOK_SECRET
 */
export function authorizeWebhookRequest(rawBody, signatureHeader, secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    return {
      ok: true,
      bypassed: true,
      warning: "VERIFY_WEBHOOK_SECRET not set — webhook auth bypassed (dev mode). Set the env var per environment to enforce HMAC verification.",
    };
  }
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) {
    return { ok: false, reason: "missing_signature" };
  }
  if (!verifyHmacSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, reason: "invalid_signature" };
  }
  return { ok: true, bypassed: false };
}

export const HMAC_HEADER_NAME = "x-verify-signature"; // Node lowercases headers
