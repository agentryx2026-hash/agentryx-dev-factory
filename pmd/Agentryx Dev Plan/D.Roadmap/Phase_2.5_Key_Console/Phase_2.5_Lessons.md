# Phase 2.5 — Lessons Learned

Phase closed: 2026-04-21. Duration: single session.

## What surprised us

1. **The real root cause of the secret leaks was the chat-paste pattern, not any one mistake.** Six separate leaks during this session each had a different proximate cause (awk redaction bug, `gh auth status` echoing token, systemd rejecting `export` syntax logging full line, overly-broad gitignore silently swallowing then re-exposing, etc). Fixing each root cause individually just whack-a-mole'd; Phase 2.5 eliminated the **category** by making keys never enter chat at all.

2. **Edit tool errors are silent and easy to miss.** Mid-phase, two Edit calls on `Sidebar.tsx` returned `<tool_use_error>File has not been read yet</tool_use_error>` but I didn't check the results structure — just assumed they worked because the surrounding ones did. Cost: user reported "API Keys not in sidebar" and we had to retrace. New discipline: after a batch of Edits, always `grep -c` on a distinctive phrase from each new string to confirm it landed.

3. **systemd's `EnvironmentFile=` has a hostile failure mode.** Instead of silently skipping malformed lines, it logs the FULL rejected line to the journal as "Ignoring invalid environment assignment" — which means any `export KEY=sk-...` line leaks the secret to journal on every service start. This alone caused one of the six leaks. Now canonized in Phase 1 Decisions D11 and Phase 2 D30.

4. **Over-broad gitignore patterns can silently drop code.** My fix-in-haste `**/*[Kk]ey*` caught `keys.js`, `Phase_2.5_Key_Console/`, and `002-provider-keys.sql` — three legitimate files. Their commits appeared to succeed (git commit returned 0, showed `1 file changed`) because ONE other file was staged. Discipline: after any .gitignore change, run `git status --ignored --short` and look for `!!` marks on code paths.

5. **AES-256-GCM in Node's stdlib is <20 LOC end-to-end.** `crypto.createCipheriv` + `crypto.createDecipheriv` with auth tags covers everything. No `node-forge` or `sodium` dep needed. Worth remembering for future encryption-at-rest needs.

6. **Fire-and-forget `last_used_at` is surprisingly informative.** The admin UI shows "2 minutes ago" for keys actively being used by the router. Added at zero meaningful cost (the UPDATE is a separate PG connection pool write that never blocks the call). Users immediately understand what's live vs stale without a separate analytics layer.

## What to do differently

1. **Pre-validate systemd env files.** Next time we point a systemd unit at an env file: first `grep -E '^[A-Z_][A-Z0-9_]*=' file.env | wc -l` vs `wc -l file.env` to catch malformed lines BEFORE systemd tries to load them. Script this into `deploy/restore.sh` once we iterate.

2. **Stop trusting silent tool-call success.** Every Write/Edit gets a grep-verify. Every DB migration gets a `\d table` verify. Every service start gets a `systemctl is-active` + port listen check.

3. **Use exact-match filenames in .gitignore when possible.** `**/Anthropic-Key` beats `**/*[Kk]ey*`. The specific patterns never have false positives.

4. **Don't echo secret material in diagnostic output, ever.** Even "masked" echoes via `awk -F=` can leak if the field-split assumption is wrong. Safer: echo `length=N, prefix=first4, suffix=last4` by explicit slicing, not by field extraction.

## What feeds next phase (2E — budget caps)

- `db.js::projectSpendSinceMidnight(projectId)` already exists from Phase 2C (D24). 2E call site is a one-line addition to `router.js::complete()` before the chain walk.
- Default caps from `configs/llm-routing.json` (`max_project_budget_usd`, `max_daily_budget_usd`) already parsed.
- Phase 2D's live smoke test showed a single Opus call was $0.45 — strong data point for "hard caps are urgent, not theoretical."

## What this phase proved for the factory's future

The **B7 admin module** concept (Phase 12) is now real, in miniature. The user can manage secrets from a browser UI, audit-log every change, encrypt at rest, toggle without deletion. When Phase 12 builds the full module (feature flags, log viewer, role hierarchy), the schema + crypto + HTTP pattern established here carries forward unchanged.

More broadly: this was the first phase where the factory's own infrastructure served its own operator (not just generate code). Self-hosting pattern for future phases (dashboards, reports, doc portals) now has a proven shape.
