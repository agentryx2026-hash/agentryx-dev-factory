import { getCourier } from "./service.js";
import { createFakeBackend } from "./backends/fake.js";
import { createNullBackend } from "./backends/null.js";
import { resolveRoute } from "./router.js";
import { validateEvent } from "./types.js";

function assert(c, m) { if (!c) throw new Error(`ASSERT: ${m}`); console.log(`  ✓ ${m}`); }

async function testValidation() {
  console.log("[validation]");
  assert(validateEvent(null) !== null, "null rejected");
  assert(validateEvent({}) !== null, "empty rejected");
  assert(validateEvent({ type: "bogus.type", title: "x" }) !== null, "unknown type rejected");
  assert(validateEvent({ type: "factory.smoke_test" }) !== null, "missing title rejected");
  assert(validateEvent({ type: "factory.smoke_test", title: "hi" }) === null, "valid event accepted");
  assert(validateEvent({ type: "factory.smoke_test", title: "hi", severity: "ULTRA" }) !== null, "invalid severity rejected");
  assert(validateEvent({ type: "factory.smoke_test", title: "hi", severity: "warn" }) === null, "valid severity accepted");
}

async function testRoutingResolution() {
  console.log("[routing]");
  const config = {
    schema_version: 1,
    default_targets: { slack: "#default" },
    rules: [
      { event_type: "project.pr_opened", channels: ["github"], targets: { github: "$project_id" } },
      { event_type: "cost.budget_exceeded", channels: ["slack", "email"], min_severity: "error" },
      { event_type: "factory.smoke_test", channels: ["stdout"] },
    ],
  };

  const prEvent = { type: "project.pr_opened", title: "PR opened", project_id: "proj-42" };
  const r1 = resolveRoute(prEvent, config);
  assert(!r1.dropped, "project.pr_opened not dropped");
  assert(r1.channels.length === 1 && r1.channels[0].channel === "github", "routes to github");
  assert(r1.channels[0].target === "proj-42", "$project_id substituted");

  const warnEvent = { type: "cost.budget_exceeded", title: "warn", severity: "warn" };
  const r2 = resolveRoute(warnEvent, config);
  assert(r2.dropped, "warn severity dropped (rule min=error)");
  assert(r2.reason.includes("severity"), "reason mentions severity");

  const errEvent = { type: "cost.budget_exceeded", title: "budget", severity: "error" };
  const r3 = resolveRoute(errEvent, config);
  assert(!r3.dropped, "error severity passes");
  assert(r3.channels.length === 2, "fans out to slack + email");
  assert(r3.channels[0].target === "#default", "default_target applied");
  assert(r3.channels[1].target === null, "email has no default");

  const unknown = { type: "unknown.type", title: "x" };
  const r4 = resolveRoute(unknown, config);
  assert(r4.dropped, "unknown type dropped");
  assert(r4.reason.includes("no routing rule"), "reason explains missing rule");
}

async function testFakeBackendDispatch() {
  console.log("[fake backend dispatch]");
  const courier = await getCourier({ backend: "fake" });
  assert(courier.backend.kind === "fake", "fake backend created");

  const r1 = await courier.dispatch({
    type: "factory.smoke_test",
    title: "hello from smoke test",
    body: "just testing",
  });
  assert(r1.ok, "dispatch ok");
  assert(r1.event_id === "EVT-0001", `event_id assigned (${r1.event_id})`);
  assert(r1.channels_used.includes("stdout"), "routed to stdout per default config");
  assert(r1.deliveries.every(d => d.ok), "delivery ok");

  const r2 = await courier.dispatch({
    type: "cost.budget_exceeded",
    title: "over budget",
    severity: "error",
    meta: { project_id: "todo-app", amount_usd: 25.50 },
  });
  assert(r2.ok, "budget exceeded ok");
  assert(r2.channels_used.length === 2, "fans out slack+email");

  const dropped = await courier.dispatch({
    type: "cost.threshold_warn",
    title: "soft warn",
    severity: "info",
  });
  assert(dropped.ok, "dropped still ok (not an error)");
  assert(dropped.dropped === true, "dropped flag set");
  assert(dropped.channels_used.length === 0, "no channels used");

  const sent = courier.backend._getSent();
  assert(sent.length === 3, `3 delivery attempts recorded (1 stdout + 2 slack/email from budget, 0 from dropped)`);

  const history = courier.getHistory();
  assert(history.length === 3, "3 events in history (including dropped)");
}

async function testNullBackend() {
  console.log("[null backend]");
  const backend = createNullBackend();
  assert(backend.kind === "null", "null backend created");
  await backend.send("slack", { type: "factory.smoke_test", title: "x" }, "#test");
  await backend.send("email", { type: "factory.smoke_test", title: "x" }, "a@b.c");
  assert(backend._count() === 2, "null backend counts but discards");
}

async function testInvalidBackend() {
  console.log("[invalid backend]");
  try {
    await getCourier({ backend: "garbage" });
    throw new Error("should have thrown");
  } catch (e) {
    assert(e.message.includes("unknown COURIER_BACKEND"), "unknown backend rejected");
  }
}

async function testRealConfigFileLoads() {
  console.log("[real config file]");
  const courier = await getCourier({ backend: "fake" });
  assert(courier.config.schema_version === 1, "schema_version loaded");
  assert(courier.config.rules.length >= 6, `at least 6 routing rules (got ${courier.config.rules.length})`);

  const r = await courier.dispatch({
    type: "verify.feedback_received",
    title: "reviewer fail on XSS",
    project_id: "todo-app",
  });
  assert(r.ok, "verify.feedback_received dispatched");
  assert(r.channels_used.includes("slack"), "verify feedback routes to slack per default config");
}

async function main() {
  try {
    await testValidation();
    console.log("");
    await testRoutingResolution();
    console.log("");
    await testFakeBackendDispatch();
    console.log("");
    await testNullBackend();
    console.log("");
    await testInvalidBackend();
    console.log("");
    await testRealConfigFileLoads();
    console.log("\n[smoke] OK");
  } catch (e) {
    console.error(`\n[smoke] FAILED: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
