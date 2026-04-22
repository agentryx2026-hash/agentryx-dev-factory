# Phase 9 — Decisions Log

## D115 — Mock client as default; real HTTP client deferred to 9-B

**What**: `getVerifyClient()` returns a mock-backed client unless `VERIFY_CLIENT=http` is set. The mock stores bundles in memory, returns a `mock://` portal URL, and is fully inspectable.

**Why**:
- **Verify multi-app mode isn't shipped yet** (per boundary contract doc, this is an open question before 9-B).
- **Factory dev needs a contract to build against today.** Mock lets cognitive-engine evolve without depending on Verify-side timelines.
- **Unit-testability**: the mock makes 9-A's smoke test deterministic without network or auth.
- **Auth choice (shared secret vs OAuth) is also open** — mock sidesteps it until real decisions are made.

**Consequence**: real integration is a 9-B PR that swaps the default client and adds the webhook endpoint in telemetry.mjs. Today's factory runs use the mock harmlessly when the flag is on.

## D116 — BuildBundles reference artifacts by ID, not inline content

**What**: `review_items[i].artifact_id` is a string like `"ART-0033"`. Verify fetches the actual content via a factory endpoint (TBD in 9-B).

**Why**:
- **Bundle payload size.** Inlining a code_output artifact + a qa_report + 3 screenshots easily crosses megabytes. HTTP POSTs to Verify would be wasteful.
- **Single source of truth.** Artifacts live in `_artifacts/` (Phase 6-A). Inlining would mean two copies — one mutable on disk, one frozen in Verify's DB. Diverge over time.
- **Lazy fetch.** Verify only needs the artifact body when a reviewer opens that item. Most review items never get expanded; saving the roundtrip wins.

**Tradeoff**: Verify can't render a fully offline bundle view. Acceptable; Verify is online-first anyway.

## D117 — Fix-cycle routing stubbed in 9-A, real in 9-B

**What**: `handleFeedback()` accepts an optional `fixRouter` dependency. If absent, the planned route is returned with a stubbed `{stubbed: true, note: "9-A — stub"}` result. If supplied, the router is invoked.

**Why**:
- **Real routing needs the fix-cycle agents themselves.** Invoking Spock for code fixes means spawning an LLM call — blocks on OpenRouter credit (same as 5-B / 6-B / 7-E / 8-B).
- **Stub-via-dependency-injection is clean.** 9-A smoke test passes in a stub. 9-B passes in a real router. Production tests (once wired) inject a real LLM-backed router. No code branches inside `handleFeedback`.
- **Separates "did we capture the feedback correctly?" (9-A) from "did we act on it correctly?" (9-B).** Each subphase tests exactly one thing.

## D118 — Observations use existing `project:<id>` scope, no new kind

**What**: Reviewer feedback becomes a `user_note` observation at `project:<project_id>` scope, with `produced_by.source = "verify_portal"` and `produced_by.agent = "human:<reviewer_email>"`.

**Why**:
- **Memory layer (Phase 7-A) already designed for this.** `user_note` kind explicitly cited Verify portal as the canonical producer.
- **Scope is per-project, not global.** A review decision on the todo-app's v0.0.1 belongs to that project's memory; future projects shouldn't see it as a "lesson" unless explicitly promoted.
- **Provenance fields distinguish human-from-agent writes.** `agent: "human:<email>"` is the convention memory-layer types.js already suggests. Consistency saves a schema invention.

## D119 — Fail-open integration posture

**What**: Unreachable Verify (network error, 5xx, timeout) causes the mock/http client to return `{ok: false, error, fail_open: true}`. The publish step is logged; the factory pipeline continues.

**Why**:
- **Factory pipeline is artifact-first (P2).** A successful factory run with an unfinished human review is still a useful run — code and docs are in `_artifacts/`, Verify publish is a separate concern.
- **Verify is a sibling service, not a blocker.** Design mirrors llm-router's fail-open cost capture (Phase 2C) — observability never blocks execution.
- **Retry is a 9-B or later concern.** 9-A captures the failure + logs; 9-B can add a retry queue if reliability warrants it.

**Rejection case**: invalid feedback payloads (validation failures in `handleFeedback`) return `{ok: false, error}` so the eventual HTTP handler can respond 400. That's *payload-level* fail-closed, not *network-level*. Different problem, different semantics.
