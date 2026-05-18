/**
 * Phase 9-B HMAC verification smoke test.
 *
 *   node cognitive-engine/verify-integration/hmac.smoke.js
 *
 * Covers:
 *  - computeHmacSignature returns a stable hex string for known inputs
 *  - verifyHmacSignature passes on a correct signature, rejects every
 *    common failure mode (mismatched body, mismatched secret, wrong
 *    length, non-hex header, empty header, empty secret)
 *  - authorizeWebhookRequest discriminates dev-bypass (no secret)
 *    vs enforcement (secret set) cleanly
 *  - Constant-time compare is invoked (we verify by feeding two
 *    same-length but different signatures and confirming reject)
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  computeHmacSignature,
  verifyHmacSignature,
  authorizeWebhookRequest,
  HMAC_HEADER_NAME,
} from "./hmac.js";

let passed = 0, failed = 0;
function check(label, actual, expected) {
  try { assert.deepEqual(actual, expected); console.log(`  ✓ ${label}`); passed += 1; }
  catch { console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); failed += 1; }
}
function ok(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}
function group(name) { console.log(`\n[${name}]`); }

const SECRET = "test-secret-9b";
const BODY = JSON.stringify({ build_id: "pre-dev-X", decision: "pass", reviewer: "r@x", reviewed_at: "2026-05-11T00:00:00Z" });

// ─── computeHmacSignature ───────────────────────────────────────────────────

group("computeHmacSignature");
{
  const sig = computeHmacSignature(BODY, SECRET);
  ok("returns string", typeof sig === "string");
  ok("hex-only chars", /^[0-9a-f]+$/.test(sig));
  check("SHA-256 → 64 hex chars", sig.length, 64);

  // Sanity check against direct crypto call.
  const direct = crypto.createHmac("sha256", SECRET).update(BODY).digest("hex");
  check("matches direct crypto", sig, direct);

  let threwEmpty = false;
  try { computeHmacSignature(BODY, ""); } catch { threwEmpty = true; }
  ok("throws on empty secret", threwEmpty);

  let threwMissing = false;
  try { computeHmacSignature(BODY); } catch { threwMissing = true; }
  ok("throws on missing secret", threwMissing);
}

// ─── verifyHmacSignature ────────────────────────────────────────────────────

group("verifyHmacSignature — happy path");
{
  const sig = computeHmacSignature(BODY, SECRET);
  ok("valid signature accepted", verifyHmacSignature(BODY, sig, SECRET) === true);
}

group("verifyHmacSignature — failure modes");
{
  const sig = computeHmacSignature(BODY, SECRET);
  ok("body changed → reject",       verifyHmacSignature(BODY + "x", sig, SECRET) === false);
  ok("secret changed → reject",     verifyHmacSignature(BODY, sig, "wrong-secret") === false);
  ok("empty signature → reject",    verifyHmacSignature(BODY, "", SECRET) === false);
  ok("empty secret → reject",       verifyHmacSignature(BODY, sig, "") === false);
  ok("undefined signature → reject", verifyHmacSignature(BODY, undefined, SECRET) === false);
  ok("non-hex signature → reject",  verifyHmacSignature(BODY, "not-hex-at-all-zzz", SECRET) === false);
  ok("short sig (length mismatch) → reject", verifyHmacSignature(BODY, sig.slice(0, 32), SECRET) === false);

  // Different secret produces a same-length-but-different sig — tests the
  // constant-time compare path (not just the length-check shortcut).
  const otherSig = computeHmacSignature(BODY, "completely-different-secret");
  ok("same-length-different-bytes → reject", verifyHmacSignature(BODY, otherSig, SECRET) === false);
}

group("verifyHmacSignature — Buffer body works too");
{
  const bodyBuf = Buffer.from(BODY, "utf-8");
  const sig = computeHmacSignature(bodyBuf, SECRET);
  ok("Buffer body verifies", verifyHmacSignature(bodyBuf, sig, SECRET) === true);
  ok("Buffer ↔ string equivalence", computeHmacSignature(bodyBuf, SECRET) === computeHmacSignature(BODY, SECRET));
}

// ─── authorizeWebhookRequest ────────────────────────────────────────────────

group("authorizeWebhookRequest — secret unset (dev bypass)");
{
  const r = authorizeWebhookRequest(BODY, undefined, undefined);
  ok("ok=true", r.ok === true);
  ok("bypassed=true", r.bypassed === true);
  ok("includes warning", typeof r.warning === "string" && r.warning.includes("VERIFY_WEBHOOK_SECRET"));
}

group("authorizeWebhookRequest — empty-string secret = dev bypass");
{
  const r = authorizeWebhookRequest(BODY, "anyheader", "");
  ok("ok=true", r.ok === true);
  ok("bypassed=true", r.bypassed === true);
}

group("authorizeWebhookRequest — secret set, missing header → reject");
{
  const r = authorizeWebhookRequest(BODY, undefined, SECRET);
  ok("ok=false", r.ok === false);
  check("reason = missing_signature", r.reason, "missing_signature");
}

group("authorizeWebhookRequest — secret set, empty header → reject");
{
  const r = authorizeWebhookRequest(BODY, "", SECRET);
  ok("ok=false", r.ok === false);
  check("reason = missing_signature", r.reason, "missing_signature");
}

group("authorizeWebhookRequest — secret set, bad signature → reject");
{
  const r = authorizeWebhookRequest(BODY, "00".repeat(32), SECRET);
  ok("ok=false", r.ok === false);
  check("reason = invalid_signature", r.reason, "invalid_signature");
}

group("authorizeWebhookRequest — secret set, valid signature → accept");
{
  const sig = computeHmacSignature(BODY, SECRET);
  const r = authorizeWebhookRequest(BODY, sig, SECRET);
  ok("ok=true", r.ok === true);
  ok("bypassed=false", r.bypassed === false);
}

// ─── HMAC_HEADER_NAME constant ──────────────────────────────────────────────

group("HMAC_HEADER_NAME");
{
  check("lowercase (Node convention)", HMAC_HEADER_NAME, "x-verify-signature");
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
