# Phase 1.5 — Decisions Log

## D67 — Phase 1.5 split into two parts (A = safe wins, B = risky migration)

**What**: Phase 1.5-A ships tool links + Paperclip UI (SERVE_UI=true). Phase 1.5-B does the actual directory moves + GitHub rename.

**Why**: Tool links and Paperclip toggle are reversible, low-risk changes. Directory moves require a fresh VM snapshot and careful volume preservation. Splitting lets us get user-visible value quickly while the risky migration has a proper checkpoint.

## D68 — Paperclip UI link points at `/api/health`, not the full UI

**What**: Sidebar entry "Paperclip (health)" links to `/paperclip/api/health` — which works through the existing nginx prefix-stripping proxy. NOT linked to `/paperclip/` (the full UI).

**Why**: Paperclip's HTML uses absolute paths (`/@vite/client`, `/@react-refresh`, `/src/main.tsx`). When browser loads it via `https://dev-hub.agentryx.dev/paperclip/`, the browser resolves those absolute paths against the ORIGIN ROOT — which goes to the factory-dashboard, not paperclip. Broken UI.

**Deferred**: Full Paperclip UI access requires either:
- Subdomain `paperclip.agentryx.dev` (needs DNS record + certbot) — cleanest
- Patch Paperclip's Vite config to support `base: '/paperclip/'` (modifies the fork) — harder
- Run Paperclip UI build output from nginx directly — decouples UI from API, more work

Tracked as future mini-phase. For now, admin who needs the UI uses SSH tunnel: `ssh -L 3101:127.0.0.1:3101 user@vm`.

## D69 — Tool links are external anchor tags, not state-based pages

**What**: The "Tools & Portals" section at the bottom of the sidebar is `<a href>` with `target="_blank"`, not internal `setActivePage()` calls.

**Why**: These are links to OTHER applications (n8n, Langfuse, Claw Code, GitHub, GCP Console). Opening them in the dashboard's iframe would break most of them (x-frame-options). New tab is the right UX.

## D70 — Keep the local directory named `agentryx-factory/` (don't rename to match repo)

**What**: When GitHub repo is renamed `agentryx-factory` → `agentryx-dev-factory`, the local directory `~/Projects/agentryx-factory/` stays as-is. Only the remote URL and docs reflect the new name.

**Why**: Dozens of absolute paths reference `~/Projects/agentryx-factory/` (systemd units, nginx configs, symlinks, scripts, memory files). Renaming the dir triggers path churn everywhere. The brand name lives in the GitHub repo URL; the disk path is just history. When the user clones FRESH to a new VM, they'll clone `agentryx-dev-factory.git` to `~/Projects/agentryx-dev-factory/` and start clean there.

**Alternative considered**: Rename local dir + symlink old path for compat. Rejected — adds a symlink that will eventually get stale and introduce confusion.

## D71 — Rename cognitive-engine-snapshot/ + factory-dashboard-snapshot/ cleanup is part of Phase 1.5-B

**What**: The two snapshot directories that mirror live files for version control get REMOVED in Phase 1.5-B after the real directories are moved into the monorepo. They become obsolete.

**Why**: Snapshots exist because `cognitive-engine/` and `pixel-factory-ui/` (now `factory-dashboard/`) are outside the mono-repo. Once they're inside, the live files ARE version-controlled directly. No duplication.

**Dependency**: Must happen AFTER the successful `mv` of live directories. If Phase 1.5-B aborts mid-execution (e.g. volume corruption), snapshots stay as the "good known state" to restore from.
