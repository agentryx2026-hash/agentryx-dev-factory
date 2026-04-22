# Verify Portal Integration

Factory-side integration with `verify-stg.agentryx.dev` (separate production app currently powering HireStream reviews). Factory publishes build bundles; humans review in Verify; feedback webhooks write observations back into the factory memory layer and (stub) route to fix-cycle agents.

## Status: Phase 9-A scaffolding

Built with a mock Verify client. **Not yet wired to real HTTP** (Verify needs multi-app mode). Phase 9-B will add the HTTP client, webhook endpoint, and real fix-cycle routing.

## Files

- `types.js` — `BuildBundle`, `ReviewItem`, `FeedbackPayload`, `FixRoute` shapes + validators
- `bundle-builder.js` — `buildBundle(projectDir, params)` reads artifact store, emits review items
- `client.js` — `getVerifyClient({kind: "mock"|"http"})`: mock stores in memory; http POSTs to Verify
- `feedback-receiver.js` — `handleFeedback(payload, {memory, projectId, fixRouter})` → observation + route
- `smoke-test.js` — 30 assertions across builder, client, validation, routing, full cycle, fail-open

## Boundary contract

### Factory → Verify (publish)

```
POST {VERIFY_URL}/api/projects/{project_id}/builds

{
  "build_id": "pre-dev-2026-04-22-abc",
  "project_id": "2026-04-22_todo-app",
  "version": "v0.0.1-rc1",
  "produced_at": "2026-04-22T15:20:00Z",
  "preview_url": "https://todo-app-staging.agentryx.dev/",
  "agent_trace_url": "https://langfuse.agentryx.dev/trace/abc",
  "release_notes": "Includes architect reviews:\n- ART-0042",
  "review_items": [
    {
      "id": "RI-0001",
      "requirement_id": "FR-12",
      "title": "QA report review — ART-0033",
      "artifact_id": "ART-0033",
      "category": "automated",
      "test_steps": ["Open attached qa_report artifact", "Confirm coverage", "..."]
    },
    ...
  ],
  "screenshot_artifact_ids": ["ART-0045"]
}
```

Review items reference artifacts by ID (D116). Verify fetches on demand.

### Verify → Factory (feedback)

```
POST {FACTORY_URL}/api/verify/feedback

{
  "build_id": "pre-dev-2026-04-22-abc",
  "review_item_id": "RI-0001",
  "requirement_id": "FR-12",
  "decision": "pass" | "partial" | "fail",
  "comments": "xss on note body — missing input sanitization test coverage",
  "screenshot_urls": ["https://verify-stg.../s/abc.png"],
  "reviewer": "subhash@agentryx.dev",
  "reviewed_at": "2026-04-22T15:30:00Z"
}
```

## Flow

```
factory pipeline run completes
    │
    ├─ buildBundle(projectDir, {build_id, version, preview_url, ...})
    │       │
    │       └─ reads _artifacts/index.jsonl via Phase 6-A listArtifacts()
    │       └─ maps kinds → review items (qa_report → automated, code/pmd → manual, architect_review → release notes)
    │
    ├─ verifyClient.publishBuild(bundle) ──(mock)──→ in-memory store
    │                                   ──(http)──→ POST /api/projects/{id}/builds
    │
    ...humans review in Verify portal...
    │
    POST /api/verify/feedback (from Verify)   ── Phase 9-B wires this endpoint
    │
    └─ handleFeedback(payload, {memory, projectId, fixRouter})
            │
            ├─ validateFeedbackPayload()
            │
            ├─ memory.addObservation({
            │     kind: "user_note",
            │     scope: "project:<id>",
            │     content: formatted review text,
            │     tags: ["verify", "decision:fail", "req:FR-12"],
            │     produced_by: {agent: "human:<reviewer>", source: "verify_portal"}
            │   })  ── Phase 7-A memory layer
            │
            ├─ planFixRoute(payload) → {lane: "tests", agent: "tuvok"}
            │
            └─ fixRouter(route)  ── stubbed in 9-A; 9-B wires real agent invocation
```

## Feature flags

```
USE_VERIFY_INTEGRATION=true    # Phase 9-B onwards: bundle publish + webhook endpoint wired
                               # Phase 9-A: no runtime effect (scaffolding only)
VERIFY_CLIENT=mock             # "mock" (default) | "http"
VERIFY_URL=https://verify-stg.agentryx.dev    # required for http client
```

## Fix-route heuristics (9-A)

| Signal in reviewer comments | Route |
|---|---|
| pass | lane=none |
| "test", "coverage", "edge case", "missing test" | lane=tests → tuvok |
| "doc", "readme", "typo", "grammar", "unclear writing" | lane=docs → data |
| "scope", "requirement", "spec", "incorrect behavior" | lane=triage → picard |
| anything else on fail/partial | lane=code → spock (default) |

9-B may replace with LLM classification.

## Smoke test

```
$ node verify-integration/smoke-test.js
[bundle-builder]       ✓ 7 assertions
[mock client]          ✓ 4 assertions
[feedback validation]  ✓ 4 assertions
[fix-route planning]   ✓ 5 assertions
[full feedback cycle]  ✓ 13 assertions (observation persisted, router invoked, pass skips router, ...)
[fail-open path]       ✓ 2 assertions

[smoke] OK
```

## Design decisions

- **Mock client as default** (D115) — Verify multi-app mode not yet shipped; mock lets factory dev test the contract.
- **Bundles reference artifact IDs, don't inline content** (D116) — keeps bundle small, lets Verify fetch on demand.
- **Fix routing stubbed in 9-A, real in 9-B** (D117) — 9-A's job is the contract + observation write; 9-B wires agent invocation.
- **Observations use existing `project:<id>` scope + `verify_portal` source** (D118) — no new scope/kind added to memory layer.
- **Fail-open** (D119) — Verify unreachable = logged no-op; factory pipeline continues.

## Rollback

`USE_VERIFY_INTEGRATION=false` (default). Phase 9-A has no runtime hooks in graph files or dashboard server.
