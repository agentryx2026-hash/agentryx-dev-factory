/**
 * Smoke test for Phase 14-B per-project queue quota helper.
 *
 *   node cognitive-engine/cost-tracker/project-quota.smoke.js
 *
 * Stubs out the rollup function so the test is fully in-process — no
 * artifact-store walk, no DB, no filesystem fixtures.
 */

import assert from "node:assert/strict";
import { checkProjectQuota, loadThresholds, windowRange, QuotaExceededError } from "./project-quota.js";

let passed = 0;
let failed = 0;

function group(name, fn) {
  console.log(`\n[${name}]`);
  try { fn(); } catch (err) { console.error("  ✗ group threw:", err); failed += 1; }
}

async function asyncGroup(name, fn) {
  console.log(`\n[${name}]`);
  try { await fn(); } catch (err) { console.error("  ✗ group threw:", err); failed += 1; }
}

function check(label, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
    console.log(`  ✓ ${label}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    failed += 1;
  }
}

function isTrue(label, cond) {
  if (cond) { console.log(`  ✓ ${label}`); passed += 1; }
  else      { console.log(`  ✗ ${label}`); failed += 1; }
}

// ─── windowRange ────────────────────────────────────────────────────────────

group("windowRange", () => {
  // Pick a known anchor: 2026-05-10T15:30:00Z (a Sunday in May)
  const anchor = new Date("2026-05-10T15:30:00Z");

  const daily = windowRange("daily", anchor);
  check("daily from", daily.from, "2026-05-10T00:00:00.000Z");
  check("daily to",   daily.to,   "2026-05-10T23:59:59.999Z");

  const monthly = windowRange("monthly", anchor);
  check("monthly from", monthly.from, "2026-05-01T00:00:00.000Z");
  check("monthly to",   monthly.to,   "2026-05-31T23:59:59.999Z");

  // ISO weekly: Mon..Sun. May 10 2026 is a Sunday → ISO week is May 4..10.
  const weekly = windowRange("weekly", anchor);
  check("weekly from (Mon)", weekly.from, "2026-05-04T00:00:00.000Z");
  check("weekly to (Sun)",   weekly.to,   "2026-05-10T23:59:59.999Z");

  const allTime = windowRange("all_time", anchor);
  check("all_time from",    allTime.from, "1970-01-01T00:00:00.000Z");

  let threw = false;
  try { windowRange("forever", anchor); } catch { threw = true; }
  isTrue("unknown window throws", threw);
});

// ─── loadThresholds ─────────────────────────────────────────────────────────

group("loadThresholds (real config)", () => {
  const list = loadThresholds();
  isTrue("returns an array", Array.isArray(list));
  isTrue("includes a 'global' entry", list.some(t => t.key === "global"));
  isTrue("includes the project:_example seed", list.some(t => t.key === "project:_example"));
});

// ─── checkProjectQuota ──────────────────────────────────────────────────────

await asyncGroup("checkProjectQuota — no matching threshold → ok", async () => {
  const result = await checkProjectQuota({
    project_id: "nonexistent",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "project:other", window: "daily", warn_usd: 1, hard_cap_usd: 5 },
    ],
    getRollupFn: async () => ({ totals: { cost_usd: 99 } }),
  });
  check("ok=true", result, { ok: true });
});

await asyncGroup("checkProjectQuota — project under cap → ok", async () => {
  const calls = [];
  const result = await checkProjectQuota({
    project_id: "alpha",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "project:alpha", window: "daily", warn_usd: 1, hard_cap_usd: 5 },
    ],
    getRollupFn: async (filter, opts) => {
      calls.push({ filter, opts });
      return { totals: { cost_usd: 1.23 } };
    },
  });
  check("ok=true", result, { ok: true });
  isTrue("rollup called once", calls.length === 1);
  check("filtered to alpha", calls[0].filter.project_ids, ["alpha"]);
});

await asyncGroup("checkProjectQuota — project over cap → breach", async () => {
  const result = await checkProjectQuota({
    project_id: "beta",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "project:beta", window: "daily", warn_usd: 1, hard_cap_usd: 5 },
    ],
    getRollupFn: async () => ({ totals: { cost_usd: 7.5 } }),
  });
  isTrue("ok=false", result.ok === false);
  check("breach key", result.breach.key, "project:beta");
  check("breach window", result.breach.window, "daily");
  check("breach hard_cap_usd", result.breach.hard_cap_usd, 5);
  check("breach current_usd", result.breach.current_usd, 7.5);
});

await asyncGroup("checkProjectQuota — global cap trumps when breached", async () => {
  let callIdx = 0;
  const result = await checkProjectQuota({
    project_id: "gamma",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "global",         window: "daily", warn_usd: 5,  hard_cap_usd: 20 },
      { key: "project:gamma",  window: "daily", warn_usd: 2,  hard_cap_usd: 50 },
    ],
    // global rollup (no project filter): $25 — over the $20 cap
    // project rollup:                    $3  — well under the $50 cap
    getRollupFn: async (filter) => {
      callIdx += 1;
      if (!filter.project_ids) return { totals: { cost_usd: 25 } };
      return { totals: { cost_usd: 3 } };
    },
  });
  isTrue("ok=false", result.ok === false);
  check("breach is global", result.breach.key, "global");
});

await asyncGroup("checkProjectQuota — exactly at cap counts as breach", async () => {
  const result = await checkProjectQuota({
    project_id: "delta",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "project:delta", window: "daily", warn_usd: 1, hard_cap_usd: 5 },
    ],
    getRollupFn: async () => ({ totals: { cost_usd: 5 } }),
  });
  isTrue("ok=false at boundary", result.ok === false);
});

await asyncGroup("checkProjectQuota — empty thresholds list → ok", async () => {
  const result = await checkProjectQuota({
    project_id: "anything",
    workspaceRoot: "/tmp",
    thresholds: [],
    getRollupFn: async () => ({ totals: { cost_usd: 999 } }),
  });
  check("ok=true (no policy → implicit pass)", result, { ok: true });
});

await asyncGroup("checkProjectQuota — agent:* threshold is ignored by the gate", async () => {
  const result = await checkProjectQuota({
    project_id: "any",
    workspaceRoot: "/tmp",
    thresholds: [
      { key: "agent:troi", window: "daily", warn_usd: 1, hard_cap_usd: 2 },
    ],
    getRollupFn: async () => ({ totals: { cost_usd: 99 } }),
  });
  check("agent thresholds skipped → ok", result, { ok: true });
});

// ─── QuotaExceededError ─────────────────────────────────────────────────────

group("QuotaExceededError", () => {
  const err = new QuotaExceededError({ key: "project:x", window: "daily", current_usd: 7.5, hard_cap_usd: 5 });
  isTrue("instanceof Error", err instanceof Error);
  check("name", err.name, "QuotaExceededError");
  isTrue("message includes key", err.message.includes("project:x"));
  isTrue("breach attached", err.breach.key === "project:x");
});

// ─── Argument validation ────────────────────────────────────────────────────

await asyncGroup("argument validation", async () => {
  let t1 = false;
  try { await checkProjectQuota({ workspaceRoot: "/tmp" }); } catch { t1 = true; }
  isTrue("throws when project_id missing", t1);
  let t2 = false;
  try { await checkProjectQuota({ project_id: "x" }); } catch { t2 = true; }
  isTrue("throws when workspaceRoot missing", t2);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
