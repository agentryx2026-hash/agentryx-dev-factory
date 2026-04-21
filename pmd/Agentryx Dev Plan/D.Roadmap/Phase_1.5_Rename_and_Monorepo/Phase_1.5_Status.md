# Phase 1.5 — Status

**Phase started**: 2026-04-21

## Split: A (safe wins) + B (risky migration)

| Sub | What | Status |
|---|---|---|
| 1.5-A | Sidebar Tools & Portals section | ✅ done |
| 1.5-A | Paperclip SERVE_UI=true | ✅ done |
| 1.5-B | GCP snapshot (user action via Console) | ⏳ pending |
| 1.5-B | Pin docker-compose project name | ⏳ pending |
| 1.5-B | Move cognitive-engine into monorepo | ⏳ pending |
| 1.5-B | Move pixel-factory-ui → factory-dashboard in monorepo | ⏳ pending |
| 1.5-B | Remove both snapshot/ dirs | ⏳ pending |
| 1.5-B | Update systemd unit WorkingDirectory paths | ⏳ pending |
| 1.5-B | Rename GitHub repo → agentryx-dev-factory | ⏳ pending |
| 1.5-B | Smoke test full factory | ⏳ pending |

## Phase 1.5-A shipped

- 7 external links added to sidebar under "Tools & Portals":
  - n8n Workflows
  - Langfuse Traces
  - Paperclip (health)
  - ChromaDB
  - Claw Code (terminal)
  - GitHub Repo
  - GCP Console
- Paperclip UI enabled server-side (accessible via SSH tunnel or future subdomain)

## Gate for Phase 1.5-B

Before I execute 1.5-B:
1. User takes fresh GCP snapshot via https://console.cloud.google.com/compute/disks (`ai-dev-stack-claw`, zone `asia-south1-a`). Recommend name `agentryx-factory-pre-1.5b`.
2. User confirms "snapshot taken, proceed".

Why: 1.5-B moves the live working directories (`cognitive-engine/`, `pixel-factory-ui/`) that are referenced by running systemd services + docker-compose volumes. If anything goes wrong (volume orphaning, path desync), the snapshot is the clean rollback.
