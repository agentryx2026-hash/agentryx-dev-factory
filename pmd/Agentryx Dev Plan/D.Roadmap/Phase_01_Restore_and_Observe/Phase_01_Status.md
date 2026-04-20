# Phase 1 — Status: COMPLETE ✅

**Phase started**: 2026-04-20
**Phase closed**: 2026-04-20

## Exit criteria — all met

| | |
|---|---|
| ✅ Both URLs respond correctly | `claw-code.agentryx.dev` (401/200), `dev-hub.agentryx.dev` (200) |
| ✅ n8n subpath works | `https://dev-hub.agentryx.dev/n8n/` loads full Vue UI |
| ✅ `deploy/restore.sh` idempotent | tested on live system; services restart cleanly |
| ✅ VM disk snapshot captured | `agentryx-factory-phase1-baseline` (12.55 GB) |
| ✅ Phase 1 milestone closable on GitHub | — |
| ⏸ Smoke test through 10-agent pipeline | **Deliberately deferred to Phase 2** — see [Phase_01_Lessons.md](Phase_01_Lessons.md) Lesson 3 |

## Summary of what got built

### Infrastructure
| Service | Port | Status |
|---|---|---|
| `ttyd` (claw-code) | 7681 | active, runs as user |
| `factory-dashboard` | 5173 | active, 0 restarts |
| `factory-metrics` | 4400 | active, 0 restarts |
| `factory-telemetry` | 4401 | active, 0 restarts |
| `factory-paperclip` | 3101 | active, 0 restarts |
| `factory-n8n` (docker) | 5678 | running, proxied at `/n8n/` |
| `factory-postgres` (docker) | 5432 | healthy |
| `factory-redis` (docker) | 6379 | healthy |
| `factory-chromadb` (docker) | 8000 | running |
| `factory-langfuse` (docker) | 3000 | running |

### Versioned in `agentryx-factory/deploy/`
```
deploy/
├── restore.sh                                 (idempotent symlink + enable + start)
├── docker-compose.yml                         (n8n subpath env vars included)
├── systemd/factory-{dashboard,metrics,telemetry,paperclip}.service
├── systemd/ttyd.service.d/override.conf       (User=, Group=)
├── nginx/{claw-code,dev-hub}.agentryx.dev.conf
├── ttyd/default                               (launcher args)
└── htpasswd/claw-code                         (bcrypt; safe to commit)
```

`/etc/systemd/system/factory-*.service` + `/etc/nginx/sites-available/{claw-code,dev-hub}.agentryx.dev` + `/etc/default/ttyd` are **symlinks into the repo**. Edit the repo file, reload the service, done. Next VM rebuild: `sudo bash deploy/restore.sh` — 1 command.

## What was discovered along the way (not in original plan)

- **n8n subpath mis-configured**: was using deprecated `N8N_PATH_PREFIX`; fixed with `N8N_PATH`, `N8N_EDITOR_BASE_URL`, `N8N_HOST`, `N8N_PROTOCOL`, `WEBHOOK_URL`. Also had to remove trailing `/` from nginx `proxy_pass`.
- **Paperclip upstream changed default port 3101 → 3100**; overrode via `.env`.
- **cognitive-engine is not a daemon** — spawned on demand by `telemetry.mjs`. No `factory-cognitive-engine.service` needed. See Decision D10.
- **ttyd can't actually reload** — `restore.sh` uses stop+pkill+start for ttyd specifically.
- **GCP VM default SA scope** doesn't include `compute.disks.createSnapshot`. User took snapshot via Console UI.
- **`docker-compose.yml` currently lives at `~/Projects/pixel-factory-ui/docker-compose.yml`**; a backup copy is at `deploy/docker-compose.yml`. Phase 1.5 canonicalizes its location in the monorepo.

## Security incidents this session

Four secret exposures — all documented in `Phase_01_Decisions.md` D11 and in `user_role_architect_delegation.md` memory. **User MUST rotate** at session end:

1. Classic GitHub PAT `ghp_CWTDk...` (revoked earlier — confirm)
2. Fine-grained PAT — first 28 chars leaked via `gh auth status` output
3. Anthropic API key — pasted directly in chat (new key in `.env`; old still valid until revoked)
4. Basic auth password `Ulan@2026` — bcrypt'd on disk but plaintext in transcript

## Next — Phase 2

LLM Router and Cost Telemetry. See `../Phase_02_LLM_Router/Phase_02_Plan.md`.

**Prereqs before Phase 2 starts**:
- User provides provider API keys (Anthropic already in place; need Google/Gemini new key if rotating, OpenAI, OpenRouter, optionally DeepSeek).
- User confirms budget / hard cap posture (default: `$10/project`, `$100/day`).
- Session-end secret rotation completed.
