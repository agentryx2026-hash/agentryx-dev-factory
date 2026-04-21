# Phase 2.75 — Decisions Log

## D62 — Docker isolation for Hermes install, not native script

**What**: Deploy Hermes via Docker rather than running its `curl | bash` install script on the host.

**Why**:
- Host install modifies `~/.bashrc`, writes to `~/.hermes/`, and installs Python deps — non-trivial footprint to remove if evaluation is unfavorable.
- Docker container is one `docker compose down` away from fully reverted state.
- Isolation matches our existing pattern (n8n, postgres, litellm are all containerized).

**Cost**: Hermes may not have an official image. If not, we build a minimal Dockerfile that runs `scripts/install.sh` inside the container.

**Revisit**: If Docker has noticeable friction (e.g. filesystem sandbox interactions, gateway port bindings), fall back to native install. Document switch.

## D63 — Phase 2.75 inserts between Phase 1.5 and Phase 3, NOT before Phase 1.5

**What**: Despite Phase 1.5 being cosmetic and Phase 2.75 being evaluation-only, run 1.5 first.

**Why**: Phase 1.5 (rename + monorepo migration + tool links + Paperclip UI) touches the live factory services. Running it FIRST means Phase 2.75 benchmarks run against the stabilized, renamed infrastructure. Otherwise we benchmark, then rename, then have to re-verify everything.

**Counter-argument rejected**: "But Hermes eval informs Phase 7/15 design — run eval first to avoid wasted work on Phase 1.5." — Phase 1.5 is not wasted if we adopt Hermes; it still happens and is valuable regardless.

## D64 — Rename our Phase 10 agent from "Hermes" to "Courier" before the eval phase starts

**What**: `Phase_10_Hermes_External_Comms/` → `Phase_10_Courier_External_Comms/`. All internal refs updated.

**Why**: Our roadmap had an internal agent named "Hermes" for external comms (Slack/GitHub/email). Nous Research's framework is also named Hermes. The collision would cause constant ambiguity ("which Hermes do you mean?") — and if we adopt Nous's Hermes for the comms role, our "Courier" slot becomes a configuration of Hermes rather than a competing concept.

**Date**: 2026-04-21, before Phase 2.75 start.

## D65 — Evaluation timebox: 2 sessions max

**What**: If Phase 2.75 decision isn't clear after 2 sessions of benchmarking, produce a "needs more data" decision and defer to Phase 7 proper (where memory layer evaluation happens anyway).

**Why**: Hermes has 40+ tools and many features. Could rabbit-hole for weeks. Better to make a provisional decision, proceed with other phases, revisit if findings in Phase 3-5 change the calculus.

## D66 — Run benchmarks with OUR OpenRouter key, not separate Hermes billing

**What**: Hermes will be configured to use our existing OpenRouter API key — NOT a separate Nous Portal or direct-provider account.

**Why**:
- Consistent cost accounting: costs go to the same `llm_calls` table (via Hermes's internal logs cross-referenced to OpenRouter billing).
- Same model tier for both runtimes = fair comparison.
- Reduces key management surface — the factory stays source-of-truth for model credentials.

**Caveat**: If Hermes has native features that require Nous Portal (e.g. Honcho is hosted), we enable those separately and document cost.
