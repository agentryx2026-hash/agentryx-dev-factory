import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { ROLE_RANK } from "./types.js";
import { CONFIG_ENTRIES, FEATURE_FLAGS, getConfigEntry, getFeatureFlag, listConfigsForRole, canRoleView, canRoleEdit } from "./registry.js";
import { roleMeets, requireRole } from "./roles.js";
import { snapshotAllFlags, readFlag, isKnownFlag } from "./feature-flags.js";
import { readConfig, writeConfig, snapshotConfig } from "./config-store.js";
import { appendAudit, readAudit } from "./audit.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function testRegistry() {
  console.log("[registry]");
  assert(CONFIG_ENTRIES.length === 7, `7 configs catalogued (got ${CONFIG_ENTRIES.length})`);
  assert(FEATURE_FLAGS.length === 14, `14 feature flags catalogued (got ${FEATURE_FLAGS.length})`);
  assert(getConfigEntry("cost_thresholds") != null, "cost_thresholds entry exists");
  assert(getConfigEntry("nonexistent") == null, "unknown id returns null");
  assert(getFeatureFlag("USE_MCP_TOOLS") != null, "USE_MCP_TOOLS flag exists");
  assert(getFeatureFlag("USE_BOGUS") == null, "unknown flag returns null");
}

async function testRoles() {
  console.log("[roles]");
  assert(ROLE_RANK.super_admin === 3, "super_admin rank=3");
  assert(ROLE_RANK.viewer === 0, "viewer rank=0");
  assert(roleMeets("super_admin", "admin"), "super_admin ≥ admin");
  assert(roleMeets("admin", "admin"), "admin ≥ admin");
  assert(!roleMeets("operator", "admin"), "operator < admin");
  assert(!roleMeets("viewer", "operator"), "viewer < operator");
  assert(!roleMeets("unknown_role", "admin"), "unknown role denied");

  try { requireRole("operator", "admin", "edit-config"); throw new Error("should have thrown"); }
  catch (e) {
    assert(e.code === "ROLE_FORBIDDEN", "requireRole throws with code");
    assert(e.required === "admin" && e.actual === "operator", "error has required+actual");
  }
}

async function testRoleConfigGates() {
  console.log("[role × config gates]");
  const costEntry = getConfigEntry("cost_thresholds");
  assert(canRoleView("operator", costEntry), "operator can view cost_thresholds");
  assert(canRoleView("viewer", costEntry) === false, "viewer cannot view cost_thresholds");
  assert(canRoleEdit("super_admin", costEntry), "super_admin can edit cost_thresholds");
  assert(canRoleEdit("admin", costEntry) === false, "admin cannot edit cost_thresholds (super_admin only)");

  const visibleToOperator = listConfigsForRole("operator");
  assert(visibleToOperator.length === CONFIG_ENTRIES.length, `operator sees all ${CONFIG_ENTRIES.length} configs`);
  const visibleToViewer = listConfigsForRole("viewer");
  assert(visibleToViewer.length === 0, "viewer sees no configs");
}

async function testFeatureFlags() {
  console.log("[feature flags]");
  const all = snapshotAllFlags();
  assert(all.length === 14, `snapshot returns all 14 flags`);
  const mcp = all.find(s => s.flag.env_var === "USE_MCP_TOOLS");
  assert(mcp != null, "USE_MCP_TOOLS in snapshot");
  assert(mcp.effective === "off" || mcp.effective === "on", "effective is on or off");

  process.env.USE_MEMORY_LAYER = "true";
  assert(readFlag("USE_MEMORY_LAYER") === "on", "set to true → on");
  process.env.USE_MEMORY_LAYER = "FALSE";
  assert(readFlag("USE_MEMORY_LAYER") === "off", "set to FALSE → off");
  delete process.env.USE_MEMORY_LAYER;
  assert(readFlag("USE_MEMORY_LAYER") === null, "unset → null");

  assert(isKnownFlag("USE_COURIER"), "USE_COURIER known");
  assert(!isKnownFlag("USE_BOGUS"), "USE_BOGUS unknown");
}

async function testConfigRoundTrip() {
  console.log("[config round-trip]");
  // Read-only test against the real cost_thresholds entry — never writes back
  // (JSON.stringify normalizes 5.00 → 5, which would alter the real file).
  const { entry: costEntry, value: original } = await readConfig("cost_thresholds");
  assert(costEntry.id === "cost_thresholds", "read entry id matches");
  assert(typeof original === "object", "read returns parsed JSON");
  assert(original.schema_version === 1, "schema_version is 1");

  const snap = await snapshotConfig("cost_thresholds");
  assert(snap.id === "cost_thresholds" && snap.bytes > 0 && snap.sha256.length === 64, "snapshot returns id+bytes+sha+mtime");
  assert(snap.updated_at && snap.updated_at.includes("T"), "updated_at is ISO");

  // Atomic write + schema_version validation: exercise via an isolated temp
  // file by transiently replacing the catalog entry's path. We restore it
  // immediately so the rest of the test suite (and any concurrent reads) sees
  // the real path.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "admin-cfg-"));
  const tmpFile = path.join(tmpDir, "scratch.json");
  await fs.writeFile(tmpFile, JSON.stringify({ schema_version: 1, items: ["a"] }, null, 2) + "\n");

  // Mutate by index — the frozen array element keys aren't writable, but the
  // entry object itself is unfrozen since we used Object.freeze() on the array
  // not on each entry. Restore at the end.
  const idx = CONFIG_ENTRIES.findIndex(e => e.id === "cost_thresholds");
  const realPath = CONFIG_ENTRIES[idx].path;
  CONFIG_ENTRIES[idx].path = tmpFile;
  try {
    const written = await writeConfig("cost_thresholds", { schema_version: 1, items: ["a", "b"] });
    assert(written.ok && written.bytes > 0 && written.sha256.length === 64, "write returns ok + bytes + sha256");
    const reread = await readConfig("cost_thresholds");
    assert(JSON.stringify(reread.value.items) === '["a","b"]', "atomic write round-trips");

    try {
      await writeConfig("cost_thresholds", { schema_version: 99, items: [] });
      throw new Error("should have thrown on schema mismatch");
    } catch (e) {
      assert(e.message.includes("schema_version mismatch"), "schema_version mismatch rejected");
    }
  } finally {
    CONFIG_ENTRIES[idx].path = realPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function testAuditLog() {
  console.log("[audit log]");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "admin-audit-"));
  const auditFile = path.join(tmpDir, "_admin-audit.jsonl");
  const orig = process.env.ADMIN_AUDIT_LOG;
  process.env.ADMIN_AUDIT_LOG = auditFile;
  try {
    const e1 = await appendAudit({ actor: "alice", action: "config.read", target: "cost_thresholds" });
    const e2 = await appendAudit({ actor: "alice", action: "config.update", target: "cost_thresholds", meta: { sha: "abc123" } });
    const e3 = await appendAudit({ actor: "bob", action: "role.deny", target: "courier_routing", denied: true });

    assert(e1.at && e1.at.includes("T"), "audit at is ISO");
    assert(e1.actor === "alice" && e1.target === "cost_thresholds", "fields stored");

    const all = await readAudit({});
    assert(all.length === 3, `3 entries (got ${all.length})`);
    assert(all[0].actor === "bob", "newest first (bob)");

    const aliceOnly = await readAudit({ actor: "alice" });
    assert(aliceOnly.length === 2, "actor filter returns 2 alice entries");

    const denials = await readAudit({ action: "role.deny" });
    assert(denials.length === 1 && denials[0].actor === "bob", "action filter returns deny");

    try { await appendAudit({ action: "x", target: "y" }); throw new Error("should require actor"); }
    catch (e) { assert(e.message.includes("actor required"), "missing actor rejected"); }
  } finally {
    if (orig === undefined) delete process.env.ADMIN_AUDIT_LOG;
    else process.env.ADMIN_AUDIT_LOG = orig;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  try {
    await testRegistry();
    console.log("");
    await testRoles();
    console.log("");
    await testRoleConfigGates();
    console.log("");
    await testFeatureFlags();
    console.log("");
    await testConfigRoundTrip();
    console.log("");
    await testAuditLog();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
