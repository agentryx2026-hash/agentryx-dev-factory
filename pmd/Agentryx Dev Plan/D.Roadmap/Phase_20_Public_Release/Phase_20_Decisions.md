# Phase 20 — Decisions Log

## D173 — Public Release is a consolidation phase; no new storage primitives invented

**What**: 20-A ships 5 capabilities (metering / retention / compliance / readiness / backup) that **aggregate over existing stores** built by Phases 5-A through 19-A. It doesn't introduce a new store primitive for any of them; it walks, reads, and sometimes deletes from stores authored earlier.

**Why**:
- **Minimises surface area at v0.0.1 → R1 boundary.** Every new primitive is a migration risk. Public Release should be about operational maturity, not novel data models.
- **Validates the A-tier pattern scales to consolidation.** 15 prior phases shipped greenfield substrates. Phase 20-A tests whether the 7-artifact recipe + 8 conventions from `03_Scaffolding_Pattern.md` work for integration-heavy phases. They do: same file count, same smoke-test discipline, similar line budgets (types 160L / metering 140L / retention 175L / compliance 215L / readiness 115L / backup 150L / orchestrator 90L).
- **Cross-cutting concerns belong at the aggregation layer, not the storage layer.** If metering had its own store, cost-tracker + metering would duplicate work. If retention invented its own index, it would drift from the actual files on disk. Aggregating over the filesystem keeps truth singular.

**Tradeoff**: some capabilities are slower than a denormalised store would be (e.g., `runDailyMetering` reads the full metering.jsonl). Acceptable at R&D scale; 20-B can add materialised rollup files if millions-of-records-per-day scale demands.

## D174 — Tenant_id = customer_id from Phase 19-A; no parallel tenant registry

**What**: Every 20-A capability that's tenant-aware (metering, compliance, retention) keys off `customer_id` strings from Phase 19-A's account store. The reserved id `"system"` denotes non-tenant (internal / admin / factory-wide) usage.

**Why**:
- **Single source of truth for tenant identity.** Multi-tenant factories go sideways fastest when identity is redefined per module. Phase 19-A already owns it; 20-A trusts it.
- **Compliance joins naturally.** GDPR export/delete for a `CUST-NNNN` finds their data across every per-tenant dir without translation tables.
- **Metering rollups feed billing.** Phase 19's receipt carries `tier` and `priority` derived from `customer_id`; metering rollups stamp the same id; Stripe (20-B) consumes the rollup and charges the corresponding Stripe customer. One id threaded through.
- **"system" as reserved id solves the cost-of-internal-usage question.** Admin-initiated audits, background jobs, factory-wide tasks all meter against `"system"` so billing doesn't see them but cost tracking does.

**Tradeoff**: a customer-deletion cascades through every store that keys off customer_id; any phase that forgets to expose its per-tenant data in `tenantDirs` creates an orphan. Mitigation: `tenantDirs` is dependency-injected, so new phases extend it explicitly, and the smoke test audits the default directory list for completeness.

## D175 — Retention policies are `{data_class, max_age_days, storage_dirs[]}`; engine is dry-run-first

**What**: Policy schema is minimal on purpose. `dryRun()` returns all candidates; `apply({confirmed: true})` purges; without `confirmed: true`, apply throws `CONFIRMATION_REQUIRED`.

**Why**:
- **The three fields cover the 80% case.** More complex policies (tag-based keeps, legal-hold markers) can layer on as optional fields without breaking callers.
- **Dry-run-first matches production retention tool convention** (e.g., rclone, aws s3 rm --dryrun). Operators always want to see what would be deleted before executing.
- **`only_data_class` scope lets ops apply retention one class at a time.** Useful for staged rollouts (e.g., "purge jobs first, wait a week, then artifacts").
- **Audit trail is append-only JSONL** (same pattern as every other audit in the factory) so Phase 11 cost-tracker, Phase 15 self-improvement, and Phase 12 admin UI can all read it.

**Tradeoff**: no tenant-aware retention policy yet (e.g., "keep pro-tier data longer than free-tier"). 20-B can add `tenant_tier_overrides` to policies; additive.

## D176 — Every compliance request is itself auditable; 4-outcome event model

**What**: `received` fires when the request hits `handleRequest`. Then exactly one of `succeeded` / `failed` / `refused` fires on completion. Every audit event carries `{tenant_id, kind, request_id}` so filtered readback works.

**Why**:
- **GDPR right-to-know served by reading the log.** A customer asking "what did you do with my data?" gets answered by `readAudit({tenant_id})` — the log shows every export, audit, and delete for their tenant id.
- **Refused is distinct from failed.** "Confirmed delete requires confirmed:true" is an operator-facing policy violation (refused), not a bug (failed). The distinction matters for ops dashboards and for Stripe webhooks that want to treat retryable failures differently.
- **`received` + outcome pair lets us measure latency.** 20-B reports "time from request received to request completed" per kind for SRE dashboards.
- **Matches Phase 14-A job lifecycle pattern** (queued / leased / done / failed) — consistent mental model across the factory.

**Tradeoff**: 2x the audit writes per request. Fine at GDPR-request scale (dozens per month); would cost more at audit-query scale (millions per day). Not relevant at v0.0.1.

## D177 — Readiness uses the DI registry pattern; worst-case aggregation

**What**: Each module contributes a named probe via `aggregator.register(name, fn)`. `assemble()` runs them in parallel, captures per-probe status + duration, and computes overall as `unhealthy > degraded > healthy`. Throwing probes land as `unhealthy` with captured error message.

**Why**:
- **Same pattern used in 5 prior phases** (Phase 14 handler, 15 proposer, 16 generator, 17 provider, 18 marketplace) — convention now reflex.
- **Parallel probes bound total wall time to the slowest probe** rather than sum. Important for `/readyz` SLO (many k8s stacks timeout at 1s).
- **Worst-case aggregation matches SRE intuition.** One failing subsystem = not ready. Degraded means "serve traffic but with known reduced capability" (e.g., fallback LLM only).
- **Empty registry → vacuously healthy** is intentional. Fresh factory startup reports healthy before modules register probes; the alternative (block startup on any probe) is a deploy hazard.

**Tradeoff**: no per-probe timeout in 20-A. A hanging probe blocks `assemble()` forever. 20-B adds `Promise.race` with configurable timeout — additive.

## D178 — Backup manifest sha256-verified at both file level AND manifest body level

**What**: Every `BackupEntry` carries a sha256 of its file. The manifest itself carries `manifest_sha256` — the hash of the serialised manifest body (with `manifest_sha256` field stripped). `verify()` checks both.

**Why**:
- **File-level hashes detect silent disk corruption** between snapshot and restore. Critical for long-retention backups (year+).
- **Manifest-level hash detects tampering with the manifest itself.** An attacker who modifies files + updates their entry hashes would need to also match the body hash — which only the original serialiser produced.
- **Cheap to compute, cheap to verify.** sha256 on ~10GB of files is minutes; on a manifest JSON, milliseconds.
- **Restore is a future concern (20-B).** 20-A's manifest is the contract restore will consume. Getting the contract right now saves restore from having to invent it later.
- **`_release/backups/` excluded from own manifest.** Otherwise a backup's entries would include the previous backup files, which would be outdated by the next snapshot and mark-as-altered on verify.

**Tradeoff**: incremental backups aren't supported (every snapshot is a full enumeration). Acceptable at R&D scale; 20-C could add content-addressed backup with sha256-based dedup if storage becomes a cost concern.

## D179 — Billing is 20-B; 20-A ships Stripe-consumable metering data

**What**: 20-A's `rollup({period_kind: "day", tenant_id})` produces `{tenant_id, period_start, period_end, request_count, cost_usd, duration_ms, tokens}`. That's exactly the shape Stripe's `InvoiceItem` API expects (multiplied by a per-unit price). 20-B reads the daily rollup, calls Stripe, records the usage record id, moves on.

**Why**:
- **A-tier rule**: no external API calls. Stripe is an external API. Stripe lives in 20-B.
- **The rollup shape is contract-level.** Getting it right in 20-A means 20-B is a ~100-line glue script, not a re-design.
- **Multiple billing backends possible.** Stripe, Chargebee, or internal billing can all consume the same rollup shape. Configurability-first (P1) preserved even at the billing layer.
- **Cost + tokens + duration are all per-tenant visible.** Customers who want "show me my bill" via Phase 19-A portal get it by reading the same rollup.

**Tradeoff**: rollup granularity is fixed to day/week/month; metered billing with sub-day windows (e.g., hourly) needs schema extension. Additive.

## D180 — Zero LLM calls in 20-A; final A-tier discipline assertion

**What**: Same discipline as D165 (Phase 18-A), D172 (Phase 19-A), and all prior A-tier phases: no OpenRouter, no Anthropic direct, no ElevenLabs. Every smoke test runs offline and costs \$0.

**Why**:
- **Caps the A-tier budget at \$0.** 20-A closes the 20-phase A-tier scaffolding bundle with zero cumulative LLM spend — a concrete success metric for the configurability-first v0.0.1 discipline.
- **Public Release substrate is pure ops infrastructure.** Metering records LLM spend (reported by other modules); retention purges old data; compliance exports files; readiness checks service health; backup snapshots the filesystem. None of these need LLM reasoning.
- **The pattern generalises.** B-tier of every phase adds external integrations. A-tier is offline. 20-B will be the first phase whose B-tier *requires* credentials (Stripe) rather than optionally uses them.
