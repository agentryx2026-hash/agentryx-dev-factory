import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  SCHEMA_VERSION, CUSTOMER_TIERS, SUBMISSION_STATUSES,
  TIMELINE_EVENT_KINDS, SLA_STATUSES, TERMINAL_STATUSES, DEFAULT_TIER_POLICIES,
  isValidTier, isValidStatus, isValidEventKind, canTransition, isTerminal,
  isValidEmail, isValidCustomerId, isValidSubmissionId,
} from "./types.js";

import { createAccountStore } from "./accounts.js";
import { createSubmissionStore } from "./submissions.js";
import { createTimelineStore } from "./timeline.js";
import { createSLAEngine } from "./sla.js";
import { createCustomerPortal } from "./portal.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function setupTmpRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "customer-portal-"));
}

// Mock-clock helpers
function mockNow(initial) {
  let t = initial;
  return {
    now: () => t,
    set: (ms) => { t = ms; },
    advanceHours: (h) => { t += h * 60 * 60 * 1000; },
  };
}

// ---------------------------------------------------------------------------
async function testTypes() {
  console.log("[types]");
  assert(SCHEMA_VERSION === 1, "schema_version is 1");
  assert(CUSTOMER_TIERS.length === 3, "3 customer tiers");
  assert(SUBMISSION_STATUSES.length === 6, "6 submission statuses");
  assert(TIMELINE_EVENT_KINDS.length === 9, "9 timeline event kinds");
  assert(SLA_STATUSES.length === 4, "4 SLA statuses");
  assert(TERMINAL_STATUSES.length === 3, "3 terminal statuses");

  assert(isValidTier("free") && isValidTier("starter") && isValidTier("pro"), "all 3 tiers valid");
  assert(!isValidTier("enterprise"), "enterprise not a valid tier (deferred to 19-C)");
  assert(isValidStatus("submitted") && isValidStatus("delivered"), "submitted/delivered valid");
  assert(!isValidStatus("pending"), "pending not a valid status");
  assert(isValidEventKind("phase_started") && isValidEventKind("sla_breached"), "valid event kinds");
  assert(!isValidEventKind("whatever"), "unknown event kind rejected");

  assert(canTransition("submitted", "accepted"), "submitted → accepted allowed");
  assert(canTransition("accepted", "in_progress"), "accepted → in_progress allowed");
  assert(canTransition("in_progress", "delivered"), "in_progress → delivered allowed");
  assert(canTransition("submitted", "cancelled"), "submitted → cancelled allowed");
  assert(!canTransition("delivered", "in_progress"), "delivered is terminal");
  assert(!canTransition("in_progress", "cancelled"), "cannot cancel in-progress (admin reject only)");
  assert(!canTransition("submitted", "delivered"), "cannot skip to delivered");

  assert(isTerminal("delivered") && isTerminal("rejected") && isTerminal("cancelled"), "3 terminals");
  assert(!isTerminal("in_progress"), "in_progress is not terminal");

  assert(isValidEmail("u@e.com"), "u@e.com is valid email");
  assert(!isValidEmail("not-an-email"), "not-an-email rejected");
  assert(isValidCustomerId("CUST-0001"), "CUST-0001 valid");
  assert(!isValidCustomerId("cust-0001"), "lowercase cust rejected");
  assert(isValidSubmissionId("SUB-0042"), "SUB-0042 valid");

  assert(DEFAULT_TIER_POLICIES.free.sla_hours === 72, "free tier sla=72h");
  assert(DEFAULT_TIER_POLICIES.starter.max_active_submissions === 5, "starter quota=5");
  assert(DEFAULT_TIER_POLICIES.pro.priority === 10, "pro priority=10 (highest)");
}

// ---------------------------------------------------------------------------
async function testAccountsBasics() {
  console.log("[accounts — create / auth / list]");
  const root = await setupTmpRoot();
  try {
    const store = createAccountStore(root);

    const { account, token } = await store.createAccount({
      email: "alice@example.com",
      display_name: "Alice",
      tier: "starter",
    });
    assert(account.id === "CUST-0001", "first account id is CUST-0001");
    assert(account.tier === "starter", "tier recorded");
    assert(typeof token === "string" && token.startsWith("cpt_") && token.length > 40,
      "token has prefix + length");
    assert(!("token_hashes" in account), "stripSecrets removes token_hashes from returned account");

    // Second account
    const r2 = await store.createAccount({
      email: "bob@example.com", display_name: "Bob", tier: "free",
    });
    assert(r2.account.id === "CUST-0002", "second id is CUST-0002");

    // Duplicate email rejected
    try {
      await store.createAccount({ email: "alice@example.com", display_name: "Alice 2", tier: "pro" });
      throw new Error("should reject duplicate email");
    } catch (e) { assert(/already registered/.test(e.message), "duplicate email rejected"); }

    // Auth
    const authed = await store.authenticate(token);
    assert(authed && authed.id === "CUST-0001", "token resolves to correct account");
    const bogus = await store.authenticate("cpt_not-a-real-token");
    assert(bogus === null, "unknown token returns null");
    assert((await store.authenticate("")) === null, "empty token returns null");
    assert((await store.authenticate(null)) === null, "null token returns null");

    // List (manifest)
    const all = await store.list();
    assert(all.length === 2 && all[0].id === "CUST-0001" && all[1].id === "CUST-0002", "list returns both");

    // Invalid inputs
    try { await store.createAccount({ email: "bad", display_name: "x" }); throw new Error("should reject"); }
    catch (e) { assert(/invalid email/.test(e.message), "invalid email rejected"); }
    try { await store.createAccount({ email: "c@e.com" }); throw new Error("should reject"); }
    catch (e) { assert(/display_name required/.test(e.message), "missing display_name rejected"); }
    try { await store.createAccount({ email: "c@e.com", display_name: "C", tier: "enterprise" }); throw new Error("should reject"); }
    catch (e) { assert(/invalid tier/.test(e.message), "bad tier rejected"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testAccountsTokenRotation() {
  console.log("[accounts — token rotation + revoke]");
  const root = await setupTmpRoot();
  try {
    const store = createAccountStore(root);
    const { account, token: t1 } = await store.createAccount({
      email: "alice@example.com", display_name: "Alice", tier: "pro",
    });

    // Rotate additive (default): both tokens valid
    const t2 = await store.rotateToken(account.id);
    assert(t2 && t2 !== t1, "rotate returns different token");
    assert(await store.authenticate(t1), "original token still valid (additive)");
    assert(await store.authenticate(t2), "new token valid");

    // Rotate with revocation
    const t3 = await store.rotateToken(account.id, { revokePrevious: true });
    assert(await store.authenticate(t3), "t3 valid");
    assert((await store.authenticate(t1)) === null, "t1 revoked after revokePrevious");
    assert((await store.authenticate(t2)) === null, "t2 revoked after revokePrevious");

    // Explicit revoke
    const r = await store.revokeToken(account.id, t3);
    assert(r.ok === true, "revoke ok=true");
    assert((await store.authenticate(t3)) === null, "t3 now invalid after revoke");

    const r2 = await store.revokeToken(account.id, t3);
    assert(r2.ok === false, "double-revoke returns ok=false");

    // Tier change
    const updated = await store.setTier(account.id, "starter");
    assert(updated.tier === "starter", "tier changed to starter");
    const list = await store.list();
    assert(list[0].tier === "starter", "manifest index reflects new tier");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testSubmissionsLifecycle() {
  console.log("[submissions — create / transition / isolation]");
  const root = await setupTmpRoot();
  try {
    const store = createSubmissionStore(root);

    const s1 = await store.create({
      customer_id: "CUST-0001",
      project_title: "My first project",
      intake_payload: "I want a todo app",
      budget_cap_usd: 10,
      target_delivery_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });
    assert(s1.id === "SUB-0001", "first submission id is SUB-0001");
    assert(s1.status === "submitted", "initial status submitted");
    assert(s1.schema_version === 1, "schema_version stamped");

    const s2 = await store.create({
      customer_id: "CUST-0001",
      project_title: "Second",
      intake_payload: "Blog engine",
      budget_cap_usd: 10,
      target_delivery_at: new Date().toISOString(),
    });
    assert(s2.id === "SUB-0002", "sequence monotonic");

    // Different customer gets their own SUB-0001
    const other = await store.create({
      customer_id: "CUST-0002",
      project_title: "Other",
      intake_payload: "other",
      budget_cap_usd: 5,
      target_delivery_at: new Date().toISOString(),
    });
    assert(other.id === "SUB-0001", "per-customer sequence resets");

    // Isolation: CUST-0001 cannot see CUST-0002's submission
    assert((await store.get("CUST-0001", "SUB-0001")).project_title === "My first project",
      "CUST-0001 sees own SUB-0001");
    const otherList = await store.list("CUST-0001");
    assert(otherList.length === 2 && !otherList.find(e => e.project_title === "Other"),
      "CUST-0001 list does not include CUST-0002's submissions (isolation)");

    // Transition happy path
    const accepted = await store.transition("CUST-0001", "SUB-0001", "accepted");
    assert(accepted.status === "accepted", "transitioned to accepted");
    assert(accepted.accepted_at, "accepted_at stamped");

    const inProg = await store.transition("CUST-0001", "SUB-0001", "in_progress");
    const delivered = await store.transition("CUST-0001", "SUB-0001", "delivered", {
      patch: { consumed_cost_usd: 4.2 },
    });
    assert(delivered.status === "delivered" && delivered.completed_at, "terminal delivered");
    assert(delivered.consumed_cost_usd === 4.2, "patch applied via transition");

    // Illegal transition
    try {
      await store.transition("CUST-0001", "SUB-0001", "in_progress");
      throw new Error("should reject");
    } catch (e) { assert(/illegal transition/.test(e.message), "illegal transition from delivered blocked"); }

    // Missing submission
    try {
      await store.transition("CUST-0001", "SUB-9999", "accepted");
      throw new Error("should reject");
    } catch (e) { assert(/not found/.test(e.message), "unknown submission rejected"); }

    // Active count + stats
    assert((await store.countActive("CUST-0001")) === 1,
      "1 active (SUB-0001 delivered → 0; SUB-0002 still submitted → 1)");
    const stats = await store.stats("CUST-0001");
    assert(stats.total === 2 && stats.by_status.delivered === 1 && stats.by_status.submitted === 1,
      "stats count correct");

    // addCost
    const withCost = await store.addCost("CUST-0001", "SUB-0002", 1.5);
    const more = await store.addCost("CUST-0001", "SUB-0002", 0.25);
    assert(more.consumed_cost_usd === 1.75, "addCost accumulates (1.5 + 0.25)");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testSubmissionsValidation() {
  console.log("[submissions — validation]");
  const root = await setupTmpRoot();
  try {
    const store = createSubmissionStore(root);
    try { await store.create({}); throw new Error("should reject"); }
    catch (e) { assert(/customer_id/.test(e.message), "missing customer_id rejected"); }
    try { await store.create({ customer_id: "bad" }); throw new Error("should reject"); }
    catch (e) { assert(/invalid customer_id/.test(e.message), "bad customer_id rejected"); }
    try {
      await store.create({
        customer_id: "CUST-0001", intake_payload: "x", budget_cap_usd: 10,
        target_delivery_at: new Date().toISOString(),
      });
      throw new Error("should reject");
    } catch (e) { assert(/project_title required/.test(e.message), "missing title rejected"); }
    try {
      await store.create({
        customer_id: "CUST-0001", project_title: "t", intake_payload: "x",
        budget_cap_usd: -5, target_delivery_at: new Date().toISOString(),
      });
      throw new Error("should reject");
    } catch (e) { assert(/non-negative/.test(e.message), "negative budget rejected"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testTimeline() {
  console.log("[timeline — append / read / filter]");
  const root = await setupTmpRoot();
  try {
    const t = createTimelineStore(root);

    await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "submitted", note: "received" });
    await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "accepted", note: "queued" });
    await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "phase_started", phase: "pre_dev" });
    await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "phase_completed", phase: "pre_dev", cost_delta_usd: 0.8 });
    await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "phase_started", phase: "dev" });

    const all = await t.read("CUST-0001", "SUB-0001");
    assert(all.length === 5, "5 events appended");
    assert(all[0].kind === "submitted", "chronological order (oldest first)");

    const startedOnly = await t.read("CUST-0001", "SUB-0001", { kind: "phase_started" });
    assert(startedOnly.length === 2, "filter by kind returns 2");

    const preDevOnly = await t.read("CUST-0001", "SUB-0001", { phase: "pre_dev" });
    assert(preDevOnly.length === 2, "filter by phase returns 2 (started + completed)");

    const latest = await t.latest("CUST-0001", "SUB-0001");
    assert(latest.kind === "phase_started" && latest.phase === "dev", "latest is dev phase_started");

    const counts = await t.countByKind("CUST-0001", "SUB-0001");
    assert(counts.phase_started === 2, "countByKind phase_started=2");
    assert(counts.phase_completed === 1, "countByKind phase_completed=1");

    // Validation
    try {
      await t.append({ submission_id: "SUB-0001", kind: "submitted" });
      throw new Error("should reject");
    } catch (e) { assert(/customer_id/.test(e.message), "missing customer_id rejected"); }
    try {
      await t.append({ customer_id: "CUST-0001", submission_id: "SUB-0001", kind: "bogus" });
      throw new Error("should reject");
    } catch (e) { assert(/invalid event kind/.test(e.message), "bogus kind rejected"); }

    // Isolation: different customer sees empty timeline
    const emptyForOther = await t.read("CUST-0002", "SUB-0001");
    assert(emptyForOther.length === 0, "other customer sees empty timeline (isolated)");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function testSLAEngine() {
  console.log("[sla — policies / ETA / breach / quota]");
  const clock = mockNow(Date.parse("2026-04-24T00:00:00Z"));
  const engine = createSLAEngine({ now: clock.now });

  const policy = engine.getPolicy("starter");
  assert(policy.sla_hours === 48, "starter policy sla=48h");
  assert(policy.priority === 50, "starter priority=50");

  const target = engine.computeTargetDelivery("2026-04-24T00:00:00Z", "pro");
  assert(target === "2026-04-25T00:00:00.000Z", "pro (24h) target = +24h");

  // on_track
  const sub = {
    customer_id: "CUST-0001",
    status: "in_progress",
    submitted_at: "2026-04-24T00:00:00Z",
    target_delivery_at: "2026-04-26T00:00:00Z",  // starter: 48h
  };
  clock.set(Date.parse("2026-04-24T06:00:00Z"));  // 6h in, 42h remaining → 12.5% elapsed
  let sla = engine.computeStatus(sub, "starter");
  assert(sla.status === "on_track", `12.5% elapsed → on_track (got ${sla.status})`);
  assert(sla.elapsed_hours === 6, "elapsed 6h");
  assert(sla.remaining_hours === 42, "remaining 42h");

  // at_risk (>=80% elapsed)
  clock.set(Date.parse("2026-04-25T15:00:00Z"));   // 39h in → 81.25% elapsed
  sla = engine.computeStatus(sub, "starter");
  assert(sla.status === "at_risk", `81% elapsed → at_risk (got ${sla.status})`);

  // breached
  clock.set(Date.parse("2026-04-27T00:00:00Z"));   // 72h in, SLA was 48h
  sla = engine.computeStatus(sub, "starter");
  assert(sla.status === "breached", "past target → breached");
  assert(sla.remaining_hours < 0, "remaining_hours negative when breached");

  // completed on time
  const onTimeSub = { ...sub, status: "delivered", completed_at: "2026-04-25T00:00:00Z" };
  sla = engine.computeStatus(onTimeSub, "starter");
  assert(sla.status === "completed", "terminal → completed");
  assert(sla.missed_sla === false, "finished before target → missed_sla=false");

  // completed but missed
  const missedSub = { ...sub, status: "delivered", completed_at: "2026-04-27T00:00:00Z" };
  sla = engine.computeStatus(missedSub, "starter");
  assert(sla.status === "completed", "terminal → completed even when late");
  assert(sla.missed_sla === true, "finished after target → missed_sla=true");

  // Find breaches
  clock.set(Date.parse("2026-04-27T06:00:00Z"));
  const breaches = engine.findBreaches(
    [sub, onTimeSub, missedSub,
     { customer_id: "CUST-0001", status: "in_progress", submitted_at: "2026-04-27T00:00:00Z", target_delivery_at: "2026-04-29T00:00:00Z" }],
    { "CUST-0001": "starter" }
  );
  // sub (in_progress, past target) is the only breach among non-terminals.
  // The 4th is also in_progress but recent, so not breached.
  assert(breaches.length === 1, `1 breach (got ${breaches.length})`);

  // Quota
  const q1 = engine.checkQuota("free", 0);
  assert(q1.allowed && q1.remaining === 1, "free @ 0 active → allowed; remaining 1");
  const q2 = engine.checkQuota("free", 1);
  assert(!q2.allowed && /at most 1/.test(q2.reason), "free @ 1 active → blocked");
  const q3 = engine.checkQuota("pro", 49);
  assert(q3.allowed && q3.remaining === 1, "pro @ 49 active → 1 remaining");
  const q4 = engine.checkQuota("pro", 50);
  assert(!q4.allowed, "pro @ 50 active → blocked");

  // Policy override via init
  const customEngine = createSLAEngine({ policies: { free: { sla_hours: 24, max_active_submissions: 3 } } });
  assert(customEngine.getPolicy("free").sla_hours === 24, "override: free sla=24h");
  assert(customEngine.getPolicy("free").max_active_submissions === 3, "override: free quota=3");
  assert(customEngine.getPolicy("free").budget_cap_usd === 10, "override merges with defaults (budget kept)");

  console.log("  ✓ policy override merges with defaults");
}

// ---------------------------------------------------------------------------
async function testPortalLifecycle() {
  console.log("[portal — full lifecycle]");
  const root = await setupTmpRoot();
  try {
    const clock = mockNow(Date.parse("2026-04-24T00:00:00Z"));
    const portal = createCustomerPortal({ rootDir: root, sla: { now: clock.now } });

    const { account, token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "starter",
    });
    assert(account.tier === "starter", "registered starter");

    // Submit
    const receipt = await portal.submitProject(token, {
      project_title: "Todo app",
      intake_payload: "I want a todo list with sync",
    });
    assert(receipt.submission_id === "SUB-0001", "receipt has submission_id");
    assert(receipt.tier === "starter", "receipt stamps tier");
    assert(receipt.priority === 50, "receipt priority from policy");
    assert(receipt.budget_cap_usd === 100, "receipt budget from starter policy");

    // Status check
    const s1 = await portal.getStatus(token, receipt.submission_id);
    assert(s1.submission.status === "submitted", "submission status=submitted");
    assert(s1.timeline.length === 1 && s1.timeline[0].kind === "submitted", "initial timeline has 1 submitted event");
    assert(s1.sla_status.status === "on_track", "sla on_track at t=0");

    // Drive through lifecycle (platform-internal path)
    await portal.transitionSubmission(account.id, receipt.submission_id, "accepted");
    await portal.recordTimelineEvent(account.id, receipt.submission_id, { kind: "accepted", note: "queued" });
    await portal.transitionSubmission(account.id, receipt.submission_id, "in_progress");
    await portal.recordTimelineEvent(account.id, receipt.submission_id, { kind: "phase_started", phase: "pre_dev" });
    await portal.addCost(account.id, receipt.submission_id, 2.3);
    await portal.recordTimelineEvent(account.id, receipt.submission_id, { kind: "phase_completed", phase: "pre_dev", cost_delta_usd: 2.3 });
    await portal.transitionSubmission(account.id, receipt.submission_id, "delivered");
    await portal.recordTimelineEvent(account.id, receipt.submission_id, { kind: "delivered" });

    const sFinal = await portal.getStatus(token, receipt.submission_id);
    assert(sFinal.submission.status === "delivered", "final status delivered");
    assert(sFinal.submission.consumed_cost_usd === 2.3, "consumed_cost accumulated");
    assert(sFinal.timeline.length === 5, `5 timeline events (got ${sFinal.timeline.length})`);
    assert(sFinal.sla_status.status === "completed", "sla completed after delivery");
    assert(sFinal.sla_status.missed_sla === false, "delivered in time → missed_sla=false");

    const list = await portal.listMyProjects(token);
    assert(list.length === 1 && list[0].id === receipt.submission_id, "listMyProjects returns one submission");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testPortalAuthEnforcement() {
  console.log("[portal — auth enforcement]");
  const root = await setupTmpRoot();
  try {
    const portal = createCustomerPortal({ rootDir: root });
    const { token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "free",
    });
    const other = await portal.registerCustomer({
      email: "bob@example.com", display_name: "Bob", tier: "free",
    });

    // No token
    try { await portal.submitProject(null, { project_title: "x", intake_payload: "x" }); throw new Error("should reject"); }
    catch (e) { assert(e.code === "UNAUTHORIZED", "null token → UNAUTHORIZED"); }

    // Bogus token
    try { await portal.getStatus("cpt_bad", "SUB-0001"); throw new Error("should reject"); }
    catch (e) { assert(e.code === "UNAUTHORIZED", "invalid token → UNAUTHORIZED"); }

    // Alice submits, then Bob tries to see it with Bob's token
    const receipt = await portal.submitProject(token, {
      project_title: "Alice's", intake_payload: "private",
    });
    try { await portal.getStatus(other.token, receipt.submission_id); throw new Error("should reject"); }
    catch (e) {
      assert(e.code === "FORBIDDEN", `Bob cannot see Alice's SUB-0001 (got ${e.code})`);
    }

    // Missing token in cancelSubmission
    try { await portal.cancelSubmission("bad", receipt.submission_id); throw new Error("should reject"); }
    catch (e) { assert(e.code === "UNAUTHORIZED", "cancel with bad token → UNAUTHORIZED"); }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testPortalQuotaEnforcement() {
  console.log("[portal — quota enforcement]");
  const root = await setupTmpRoot();
  try {
    const portal = createCustomerPortal({ rootDir: root });
    const { token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "free",  // free quota = 1
    });

    const r1 = await portal.submitProject(token, { project_title: "p1", intake_payload: "x" });
    assert(r1.submission_id === "SUB-0001", "first allowed");

    // Second submission while first is active (submitted) → blocked
    try {
      await portal.submitProject(token, { project_title: "p2", intake_payload: "x" });
      throw new Error("should reject");
    } catch (e) {
      assert(e.code === "QUOTA_EXCEEDED", `quota exceeded (got ${e.code})`);
      assert(/at most 1/.test(e.message), "error names the limit");
    }

    // After delivering the first, quota frees up
    const { account } = await portal.registerCustomer({
      email: "carol@example.com", display_name: "Carol", tier: "free",
    });
    // Use Alice's account for the test — transition Alice's SUB-0001 to delivered
    const { account: alice } = await (async () => {
      const all = await portal.listCustomers();
      return { account: all.find(a => a.email === "alice@example.com") };
    })();
    await portal.transitionSubmission(alice.id, r1.submission_id, "accepted");
    await portal.transitionSubmission(alice.id, r1.submission_id, "in_progress");
    await portal.transitionSubmission(alice.id, r1.submission_id, "delivered");

    const r2 = await portal.submitProject(token, { project_title: "p2", intake_payload: "x" });
    assert(r2.submission_id === "SUB-0002", "after delivery, second submission allowed");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testPortalCancelPath() {
  console.log("[portal — cancel + reject paths]");
  const root = await setupTmpRoot();
  try {
    const portal = createCustomerPortal({ rootDir: root });
    const { account, token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "starter",
    });

    // Cancel from submitted (legal)
    const r1 = await portal.submitProject(token, { project_title: "p1", intake_payload: "x" });
    const cancelled = await portal.cancelSubmission(token, r1.submission_id, { note: "changed my mind" });
    assert(cancelled.status === "cancelled", "submitted → cancelled allowed");
    assert(cancelled.completed_at, "completed_at stamped on cancel");

    // Cancel from accepted (legal)
    const r2 = await portal.submitProject(token, { project_title: "p2", intake_payload: "x" });
    await portal.transitionSubmission(account.id, r2.submission_id, "accepted");
    const cancelled2 = await portal.cancelSubmission(token, r2.submission_id);
    assert(cancelled2.status === "cancelled", "accepted → cancelled allowed");

    // Cancel from in_progress (not allowed)
    const r3 = await portal.submitProject(token, { project_title: "p3", intake_payload: "x" });
    await portal.transitionSubmission(account.id, r3.submission_id, "accepted");
    await portal.transitionSubmission(account.id, r3.submission_id, "in_progress");
    try {
      await portal.cancelSubmission(token, r3.submission_id);
      throw new Error("should reject");
    } catch (e) {
      assert(e.code === "VALIDATION", `in_progress cancel → VALIDATION (got ${e.code})`);
      assert(/illegal transition/.test(e.message), "error names illegal transition");
    }

    // Admin can reject the in_progress one
    const rejected = await portal.rejectSubmission(account.id, r3.submission_id, { reason: "scope too large" });
    assert(rejected.status === "rejected", "admin rejectSubmission works");

    // Cancel non-existent
    try {
      await portal.cancelSubmission(token, "SUB-9999");
      throw new Error("should reject");
    } catch (e) {
      assert(e.code === "FORBIDDEN", `nonexistent sub cancel → FORBIDDEN (got ${e.code})`);
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function testPortalSLABreach() {
  console.log("[portal — SLA breach detection + event]");
  const root = await setupTmpRoot();
  try {
    const clock = mockNow(Date.parse("2026-04-24T00:00:00Z"));
    const portal = createCustomerPortal({ rootDir: root, sla: { now: clock.now } });
    const { account, token } = await portal.registerCustomer({
      email: "alice@example.com", display_name: "Alice", tier: "free",  // free sla_hours = 72
    });

    const r = await portal.submitProject(token, { project_title: "p1", intake_payload: "x" });

    // Advance clock past SLA
    clock.advanceHours(80);  // 80h > 72h → breach
    const statusBreached = await portal.getStatus(token, r.submission_id);
    assert(statusBreached.sla_status.status === "breached", "at 80h elapsed, status=breached");

    // Raise breach event
    await portal.raiseSLABreach(account.id, r.submission_id, { note: "missed 72h window" });
    const updated = await portal.getStatus(token, r.submission_id);
    const breachEvents = updated.timeline.filter(e => e.kind === "sla_breached");
    assert(breachEvents.length === 1, "1 sla_breached event recorded");
    assert(breachEvents[0].note === "missed 72h window", "breach note captured");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------------------
async function main() {
  try {
    await testTypes();                     console.log("");
    await testAccountsBasics();            console.log("");
    await testAccountsTokenRotation();     console.log("");
    await testSubmissionsLifecycle();      console.log("");
    await testSubmissionsValidation();     console.log("");
    await testTimeline();                  console.log("");
    await testSLAEngine();                 console.log("");
    await testPortalLifecycle();           console.log("");
    await testPortalAuthEnforcement();     console.log("");
    await testPortalQuotaEnforcement();    console.log("");
    await testPortalCancelPath();          console.log("");
    await testPortalSLABreach();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
