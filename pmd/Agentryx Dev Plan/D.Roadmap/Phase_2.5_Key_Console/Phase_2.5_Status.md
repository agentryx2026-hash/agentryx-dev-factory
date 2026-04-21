# Phase 2.5 — Status: COMPLETE ✅

**Phase started**: 2026-04-21
**Phase closed**:  2026-04-21
**Duration**: single session

## Exit criteria — all met

| | Verification |
|---|---|
| ✅ All 4 subphases shipped | `8e966d4` (A) · `aa81cec` (B) · `cf315e3` (C) · `b34d7a2` (D) · `c4ad399` (Sidebar fix) |
| ✅ Old leaked keys revoked + new keys live in encrypted DB | audit log shows `subhash` `update` at 2026-04-21 06:37:44 (anthropic) + 06:38:43 (openrouter) |
| ✅ Router pulls from DB on live calls | smoke test with `env -u` stripped: `rotation-verified` response via openrouter, $0.000034 |
| ✅ Audit log captures every change | 6 entries including create/update/toggle/delete for test_provider + real creates + real rotation updates |
| ✅ No keys in `.env` needed | env fallback stays as disaster-recovery path only; DB is source of truth |

## What this phase produced

| Layer | Path | Lines |
|---|---|---|
| DB schema | `llm-router/migrations/002-provider-keys.sql` | 40 |
| Crypto + CRUD | `llm-router/src/keys.js` | 180 |
| HTTP admin API | `server/admin-keys.mjs` | 200 |
| systemd unit | `deploy/systemd/factory-admin.service` | 18 |
| nginx route | `deploy/nginx/dev-hub.agentryx.dev.conf` (added `/admin/api/`) | 17 new |
| React UI | `pixel-factory-ui/src/components/AdminKeys.tsx` | 240 |
| Provider catalog | `configs/providers.json` | 65 |
| Phase docs | `Phase_2.5_Plan/Status/Decisions/Lessons.md` | complete |
| Decisions | D33-D50 (18 new entries) | captured during execution |

## Snapshots for Phase 1.5 to clean up

- `cognitive-engine-snapshot/` — 4 graph files
- `factory-dashboard-snapshot/` — 2 React components + App.tsx
- Both get removed when Phase 1.5 folds the live dirs into the mono-repo.

## Security posture before → after

| | Before | After |
|---|---|---|
| Key storage on disk | `.env` plaintext, chmod 600, ad-hoc rotation | AES-256-GCM ciphertext in Postgres + master key at `~/.config` |
| Audit trail | commit messages + systemd journal | `key_audit_log` table (structured, queryable) |
| Rotation workflow | chat-paste → shred source file → hope | browser form → HTTPS POST → encrypted DB |
| Leak surface per rotation | 1 (the chat paste) + journal risk | 0 |
| Disable without delete | not possible | `enabled=false` preserves key |
| Verification that key works | manual curl | "Test" button in UI pings provider `/models` |

## Ready for Phase 2E

`projectSpendSinceMidnight()` already exists in `db.js` — Phase 2E just adds the call site in `router.js::complete()`. Short, no new deps.
