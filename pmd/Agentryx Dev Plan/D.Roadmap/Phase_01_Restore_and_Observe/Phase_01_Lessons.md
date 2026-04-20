# Phase 1 — Lessons Learned

Phase closed: 2026-04-20. Duration: single session.

## What surprised us

1. **The "migration" was really just missing runtime glue.** All source code (10-agent LangGraph, paperclip, openclaw, claw-code-parity, PMD, 220 MB agent-workspace) was intact on the new VM. What didn't migrate: systemd units, `/etc/default/ttyd`, `/etc/nginx/sites-*`, the n8n workflow import, Gemini trace history. None of which was *lost* — just never reinstalled on the new VM.

2. **`cognitive-engine` is not a daemon.** The original architecture docs implied a long-running process. Reality: `telemetry.mjs` uses `child_process.spawn` to launch `dev_graph.js` / `post_dev_graph.js` per task. One fresh Node process per request. This has implications for Phase 2 (LLM router — must be a library call, not a sidecar service).

3. **docker-compose project name is sticky.** Volumes are named `<project>_<vol>`. Renaming the directory mid-flight would orphan `pixel-factory-ui_postgres-data` and create empty `factory-dashboard_postgres-data`. Phase 1.5 must pin `name: pixel-factory-ui` in docker-compose.yml before physical rename.

4. **Paperclip's default port flipped upstream from 3101 → 3100.** Had to override via `.env`. Upstream tracks as `PORT=3100` now; any future fork merge needs to preserve our override.

5. **n8n v2.13 renamed `N8N_PATH_PREFIX` → `N8N_PATH`.** Old var silently fails (serves HTML with wrong asset URLs, 130 console errors). Must also set `N8N_EDITOR_BASE_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `WEBHOOK_URL` when hosting behind reverse proxy. Nginx `proxy_pass` must NOT strip the prefix (no trailing slash on upstream URL).

6. **ttyd can't actually reload.** Its systemd unit has `ExecReload=kill -HUP` but ttyd doesn't re-bind on SIGHUP. `systemctl reload-or-restart ttyd` stops it then races with port rebind → "address already in use". Solution in `restore.sh`: stop+pkill+start, not reload-or-restart.

7. **GCP VM default service-account scopes don't include snapshot creation.** Can't snapshot from inside the VM. Either (a) attach broader scopes at VM creation, (b) use user-auth gcloud, (c) use GCP Console UI. Documented as the snapshot procedure.

8. **Security hygiene was the recurring failure mode.** Four separate secret exposures in one session (PAT, leaked token fragment via `gh auth status`, Anthropic key pasted to chat, basic-auth password pasted to chat). This is the #1 thing to fix in user workflow. Memory file `user_role_architect_delegation.md` now codifies "refuse to save secrets that arrived via chat; require terminal `read -s` re-entry" for future sessions.

## What to do differently in Phase 2

1. **Assume provider outages.** Gemini 429 killed Phase 0 last time. Phase 2 MUST land router + fallback chain first, before anything else. Don't build Genovi (intake agent) on a single-provider substrate.

2. **Cost capture from first call.** `llm_calls` table schema lands with Phase 2A. Every LLM call writes a row. Retroactively adding telemetry later = lost data.

3. **Smoke tests should NOT burn real provider budget.** Phase 2 needs a `mock` backend in the router for tests. Deferred Phase 1C agent smoke test specifically to avoid burning Gemini on a substrate that's about to change.

4. **restore.sh saves hours.** Next VM rebuild (or disaster recovery) is one command instead of two hours of detective work. Pattern: any new config touching `/etc/` gets added to `deploy/` + `restore.sh` in the same commit.

5. **Git setup ceremony is significant.** Fine-grained PAT permission grants, gh auth setup, branch protection — this ate ~30 min. Worth documenting a "new dev factory VM" runbook in `docs/ops/new_vm_setup.md` during Phase 2 or whenever another VM is needed.

## What to feed into Phase 2 explicitly

- Router **must** be a library invoked from `dev_graph.js` / `post_dev_graph.js` children, not a separate service — because cognitive-engine isn't a daemon (Lesson 2).
- Router config (`llm-routing.yaml`) lives in `configs/`. Admin UI in Phase 12 will override from the database; until then, edit-and-restart-telemetry is the workflow.
- `.env`-based model selection is per-project, not global. Future: per-project overrides in Phase 14 multi-project concurrency.

## What the session produced

- ✅ Public repo at https://github.com/agentryx2026-hash/agentryx-factory
- ✅ 20-phase roadmap with Phase 01 fully detailed
- ✅ 4 factory services + ttyd running under systemd (0 restarts)
- ✅ claw-code.agentryx.dev — auth-gated, dropping into Claw Code REPL
- ✅ dev-hub.agentryx.dev — dashboard live, n8n subpath fixed, 6 agents visible in UI
- ✅ `deploy/restore.sh` — idempotent, tested on live system
- ✅ GCP snapshot `agentryx-factory-phase1-baseline` (12.55 GB) — disaster-recovery insurance
- ✅ 3 memory files so future sessions inherit context

## Deferred from Phase 1 into Phase 2 bringup

- Phase 1C agent smoke test (deliberate — see Lesson 3)
- OpenClaw gateway as its own systemd unit (not required for dashboard; lazy-loadable by paperclip)
- `factory_graph.js` direct LLM calls → router facade refactor (is Phase 2B)
