# Phase 12 — Status: 12-A + 12-B COMPLETE ✅

**Phase started**: 2026-04-23
**Phase 12-A closed**: 2026-04-23 (substrate library)
**Phase 12-B closed**: 2026-05-09 (Tier B + full — Admin · Configuration page; same session as the visible-factory sprint after Phase 21-A.1)
**Duration**: 12-A single session; 12-B ~5 minutes elapsed because the substrate was already there — wiring was 6 library calls to a UI

---

## Phase 12-B — what shipped

**Backend** (`factory-dashboard/server/telemetry.mjs` — 7 new endpoints under `/api/factory-admin/*`):
- `GET /flags` — returns `snapshotAllFlags()` + override-source tag (UI-set vs env-default)
- `POST /flags/:env_var/toggle` — flips ON↔OFF, persists to `_factory_runtime/flag_overrides.json`, updates `process.env` immediately so the architect daemon and child-process spawns see the new value, appends `appendAudit({ actor, action: 'flag.toggle', target, details: { to, prior } })`
- `GET /configs` — returns `readConfig(id)` for each registry entry (sensitive entries get value redacted on the wire)
- `POST /configs/:id` (12-B-full) — body `{ value, actor_role: 'super_admin' }`; gates via `canRoleEdit(actor_role, entry)` against `min_role_edit`, atomic write through `writeConfig` (validates `schema_version` match), audit logs metadata only (`actor / action / target / { role, new_bytes, new_sha256, prior_sha256 }`) — never logs the new value (configs may reference secrets)
- `GET /audit?limit=N&actor=X&action=Y&target=Z` — wraps `readAudit()`
- `GET /modules` — `marketplace.list()`, falls back to `BUILTIN_MANIFESTS` catalogue when in-process store empty
- `GET /queue` — `queue.stats()` + `listQueued()` + `listInFlight()`
- `GET /cost` — `getRollup({ workspace_root: REPO_ROOT, source: 'artifacts' })`

Plus boot-time `applyFlagOverrides()` so persisted toggles survive `systemctl restart`.

**Frontend** (`factory-dashboard/src/components/AdminConfig.tsx` — replaced placeholder with 6 sub-tabs):
- 🚦 Flags · ⚙️ Configs · 📦 Modules · 📊 Queue · 💰 Cost · 📋 Audit
- Live flag pills (ON/OFF), `UI-SET` badge for founder-toggled flags
- Configs: read-only viewer per entry → ✎ Edit button reveals JSON textarea with the current value pre-loaded → Save validates JSON parses + roundtrips through backend; backend rejects schema_version mismatch with descriptive error; sensitive entries get a red `SENSITIVE` badge and no Edit button
- Modules: catalogue grouped by category, capability tags
- Queue: 4-stat strip, queued + in-flight job lists, auto-refresh every 5s
- Cost: total/tokens/calls + by-model breakdown
- Audit: timestamp / actor / action / target / details, auto-refresh every 10s

**Sidebar label**: "Configuration" → "Admin · Configuration"

## Postgres deferred to v3

The original 12-B scope mentioned a Postgres `config_settings` migration. Decided (D205) to keep the file-backed store for v0.0.1: single-VM single-founder mode doesn't need cross-host config consistency. Postgres lands when multi-tenant pressure arrives at v3 (or earlier if a second admin user materialises).

---

## Subphase progress

| Sub | What | Status |
|---|---|---|
| 12-A.1 | `admin-substrate/types.js` — Role enum, ConfigEntry, FeatureFlag, AuditEntry shapes | ✅ done |
| 12-A.2 | `admin-substrate/registry.js` — explicit catalog of 7 configs + 8 feature flags | ✅ done |
| 12-A.3 | `admin-substrate/config-store.js` — atomic temp+rename writes, schema_version validation | ✅ done |
| 12-A.4 | `admin-substrate/feature-flags.js` — env-based read, snapshot, validators | ✅ done |
| 12-A.5 | `admin-substrate/roles.js` — `roleMeets`, `requireRole` integer-rank gating | ✅ done |
| 12-A.6 | `admin-substrate/audit.js` — append-only JSONL log with actor/action/target | ✅ done |
| 12-A.7 | Smoke test — 39 assertions across 6 test groups | ✅ done — all pass |
| 12-A.8 | `admin-substrate/README.md` + design decisions | ✅ done |
| 12-B | HTTP routes + React UI + Postgres migration + runtime flag toggle | ⏳ DEFERRED |

## What shipped

### `cognitive-engine/admin-substrate/types.js` (new, ~70 lines)
- 4 roles with integer rank: super_admin(3) > admin(2) > operator(1) > viewer(0)
- JSDoc shapes: `ConfigEntry`, `FeatureFlag`, `AuditEntry`
- 7 config categories: feature_flags, routing, pricing, registry, thresholds, providers, mcp
- `SCHEMA_VERSION = 1` for the substrate itself

### `cognitive-engine/admin-substrate/registry.js` (new, ~150 lines)
- 7 ConfigEntry rows catalogued: `pmd_registry`, `cost_thresholds`, `courier_routing`, `llm_routing`, `llm_prices`, `providers`, `mcp_servers`
- 8 FeatureFlag rows catalogued — one per Phase 4-11 feature flag
- Each entry has `min_role_view` + `min_role_edit` for role-gated access
- `getConfigEntry(id)`, `getFeatureFlag(envVar)`, `listConfigsForRole(role)`, `canRoleView()`, `canRoleEdit()` helpers

### `cognitive-engine/admin-substrate/config-store.js` (new, ~50 lines)
- `readConfig(id)` — returns `{entry, value}` from registry-known path
- `writeConfig(id, value)` — atomic temp-file + rename, schema_version validated
- `snapshotConfig(id)` — `{id, path, bytes, sha256, updated_at}` for diff/UI
- All operations registry-aware — unknown ids reject

### `cognitive-engine/admin-substrate/feature-flags.js` (new, ~40 lines)
- `readFlag(envVar)` — normalizes truthy values to "on"/"off"/null
- `snapshotAllFlags()` — returns all 8 flags with current + effective values
- `isKnownFlag()`, `listFlagEnvVars()` helpers

### `cognitive-engine/admin-substrate/roles.js` (new, ~35 lines)
- `roleMeets(actor, required)` — integer rank ≥ comparison
- `requireRole(actor, required, action)` — throws with `code: "ROLE_FORBIDDEN"` and required+actual fields
- `listRoles()`, `rankOf()` helpers

### `cognitive-engine/admin-substrate/audit.js` (new, ~40 lines)
- `appendAudit({actor, action, target, meta?, denied?})` — appends to `_admin-audit.jsonl`
- `readAudit({actor?, action?, target?, limit})` — most-recent-first, AND filters
- Path overridable via `ADMIN_AUDIT_LOG` env

### `cognitive-engine/admin-substrate/smoke-test.js` (new)
- **39 assertions across 6 test groups**:
  - registry (6): catalog counts match Phases 4-11 reality, lookups by id/envVar
  - roles (9): rank values, `roleMeets`, `requireRole` thrown error fields
  - role × config gates (6): operator can view, viewer cannot, super_admin-only edits
  - feature flags (8): snapshot, env value parsing (true/FALSE/unset), known/unknown
  - config round-trip (8): atomic write to temp path, schema_version validation, snapshot fields
  - audit log (7): append, filter by actor/action, missing-actor rejection
- **Real config files untouched** — round-trip test isolated to temp path

### `cognitive-engine/admin-substrate/README.md` (new)
- Full catalog table, role hierarchy diagram, API examples, atomic write contract, audit shape, design decisions, 12-B preview

### Unchanged
- `server/admin-keys.mjs` (Phase 2.5 Key Console) — untouched
- All 7 catalogued config files — untouched
- Graph files, `telemetry.mjs`, `tools.js`, all other modules — untouched
- Zero regression risk

## Smoke test highlight

```
[role × config gates]
  ✓ operator can view cost_thresholds
  ✓ viewer cannot view cost_thresholds
  ✓ super_admin can edit cost_thresholds
  ✓ admin cannot edit cost_thresholds (super_admin only)

[config round-trip]
  ✓ atomic write round-trips
  ✓ schema_version mismatch rejected

[audit log]
  ✓ 3 entries (got 3)
  ✓ newest first (bob)
  ✓ actor filter returns 2 alice entries
```

## Why 12-B deferred

12-B = HTTP routes + React UI + Postgres migration. Requires:

- **Server-side wiring**: extend `server/admin-keys.mjs` (or fold into a new `admin-config.mjs`) with route handlers per config + feature-flag endpoints. Touches production code.
- **UI work**: React pages in `factory-dashboard/src/pages/Admin/` — config browser, diff view, save+confirm flow, audit log viewer.
- **Postgres migration**: `config_settings` table with backward-read of JSON files as fallback during cutover.
- **Runtime flag toggle**: needs process-restart signaling for graph subprocesses that read env at boot. Non-trivial systemd dance.

Better to ship 12-A as the firm contract + tested library, and bundle UI + DB migration into 12-B as one coherent release.

## Feature-flag posture (P1 configurability-first)

| Flag | Default | Effect |
|---|---|---|
| `PRE_DEV_USE_GRAPH` | off | Phase 4 |
| `USE_MCP_TOOLS` | off | Phase 5 — awaits 5-B |
| `USE_ARTIFACT_STORE` | off | Phase 6 — awaits 6-B |
| `USE_MEMORY_LAYER` | off | Phase 7 — awaits 7-E |
| `USE_PARALLEL_DEV_GRAPH` | off | Phase 8 — awaits 8-B |
| `USE_VERIFY_INTEGRATION` | off | Phase 9 — awaits 9-B |
| `USE_COURIER` | off | Phase 10 — awaits 10-B |
| `USE_COST_TRACKER` | off | Phase 11 — awaits 11-B |
| (no new flag for 12-A) | — | substrate is library-only; 12-B will add `USE_ADMIN_API` if relevant |

## Phase 12-A exit criteria — met

- ✅ `admin-substrate/` scaffolded (types, registry, config-store, feature-flags, roles, audit, smoke-test, README)
- ✅ Registry catalogs all 7 known JSON configs + 8 feature flags from Phases 4-11
- ✅ Atomic write + schema_version validation working (verified via temp-path test)
- ✅ Role gating: 4-level hierarchy with integer-rank comparison
- ✅ Audit log appends + filters
- ✅ **39 smoke-test assertions all pass**
- ✅ Real config files NOT modified (round-trip test isolated to temp paths)
- ✅ No changes to admin-keys.mjs, graph files, telemetry.mjs, or any catalogued config
- ✅ Phase docs: Plan (expanded), Status, Decisions, Lessons
- ⏳ 12-B HTTP routes + React UI + Postgres migration deferred

Phase 12-A is **wired, tested, and ready**. 12-B builds the operator-facing layer on top.
