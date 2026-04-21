# Phase 1.5 — Rename and Monorepo Migration

**Goal**: Three coordinated renames + the physical move into the mono-repo, all without losing data.

| Was | After |
|---|---|
| Repo: `agentryx-factory` | **`agentryx-dev-factory`** (brand match — "Agentryx Dev Factory" product) |
| Local dir: `~/Projects/agentryx-factory/` | `~/Projects/agentryx-dev-factory/` (symlink old → new for compat) |
| Dashboard subdir: `pixel-factory-ui/` | `factory-dashboard/` (descriptive; sibling to cognitive-engine, llm-router) |
| `~/Projects/cognitive-engine/` | folds into `agentryx-dev-factory/cognitive-engine/` (snapshot dir gets removed) |

**Status**: sketched (executes after Phase 1 closes)

## Why this is its own phase

Renaming `~/Projects/pixel-factory-ui/` is **not just a `mv`**. The docker-compose project name is derived from the directory name, which means:

- Existing volumes are named `pixel-factory-ui_postgres-data`, `pixel-factory-ui_n8n-data`, etc.
- Running `docker compose up -d` from a renamed directory creates **new** volumes named `factory-dashboard_postgres-data` (empty)
- Old volumes become orphaned with all the data inside

Same risk for `cognitive-engine/` (no Docker concern, but systemd unit working dirs would break).

So this needs careful sequencing:
1. Stop services
2. Rename directories
3. Update docker-compose project name explicitly OR rename volumes
4. Update all systemd unit `WorkingDirectory=` paths
5. Restart and verify volumes survived

## Plan (rough)

1. Confirm Phase 1 is closed and stable.
2. Take VM snapshot (rollback insurance).
3. Stop all factory services: `systemctl stop ...`
4. `docker compose down` (NOT `down -v` — must preserve volumes)
5. Pin docker-compose project name explicitly:
   - Add `name: pixel-factory-ui` to top of `docker-compose.yml` so volumes stay named the same regardless of directory.
6. `mv ~/Projects/pixel-factory-ui ~/Projects/agentryx-factory/factory-dashboard`
7. `mv ~/Projects/cognitive-engine ~/Projects/agentryx-factory/cognitive-engine`
8. Symlink old paths for backward compat: `ln -s agentryx-factory/factory-dashboard ~/Projects/pixel-factory-ui`
9. Update all systemd unit `WorkingDirectory=` to new paths (in `deploy/`, push, redeploy via `restore.sh`).
10. `docker compose up -d` from new path — should reuse old volumes via the explicit project name.
11. `systemctl start ...` all factory services.
12. Smoke test — same checks as Phase 1C.
13. Commit the file moves to `agentryx-factory` repo (`git mv` won't work since these were never tracked yet — first commit captures them).

## Risks

- Docker volume orphaning if step 5 (explicit project name) is forgotten or applied late.
- Symlink confusion if any tool dereferences paths inconsistently.
- Telemetry SSE connections drop during restart (acceptable, brief).

## Exit criteria

- Both URLs work as before Phase 1.5 (no functional regression).
- All postgres data preserved (langfuse tables row counts unchanged from before).
- `git ls-files` in `agentryx-factory/` shows `factory-dashboard/` and `cognitive-engine/` populated.
- Old paths `~/Projects/pixel-factory-ui` and `~/Projects/cognitive-engine` are symlinks (not orphan dirs).
