# Memory Layer

Pluggable memory service for the factory. Captures observations, lessons, patterns, and human notes across projects and agents. Parallel to the existing `../memory.js` (which handles narrow vector-based skill synthesis).

## Status: Phase 7-A scaffolding

Built but **not wired into graph nodes or the Verify portal yet**. Flag `USE_MEMORY_LAYER` defaults off. Phase 7-E will add graph integration (agents write observations post-LLM); Phase 9 will let Verify portal reviewers add `user_note` observations.

## Files

- `types.js` — observation kinds, scope conventions, JSDoc shapes
- `service.js` — `getMemoryService({backend, rootDir})` factory; reads `MEMORY_BACKEND` + `FACTORY_MEMORY_ROOT` env
- `backends/filesystem.js` — default backend. Markdown files + `index.jsonl` at `~/Projects/agent-workspace/_factory-memory/`
- `artifact-walker.js` — read-only helper that walks all project artifact indexes and summarizes
- `smoke-test.js` — end-to-end verification (memory service + artifact walker)

## Vault layout (filesystem backend)

```
~/Projects/agent-workspace/_factory-memory/
  ├── index.jsonl                               # append-only index
  ├── global/
  │   └── OBS-0002-requests-4096-tokens-retu....md
  ├── agents/
  │   └── troi/
  │       └── OBS-0001-troi-hallucinates-auth-....md
  └── projects/
      └── 2026-04-22_todo-app/
          └── OBS-0003-user-confirmed-real-tim....md
```

Each markdown file has YAML frontmatter (id, kind, scope, tags, refs, produced_by) + markdown body. Obsidian opens this directly.

## Observation record

```json
{
  "id": "OBS-0042",
  "kind": "lesson",
  "schema_version": 1,
  "scope": "agent:troi",
  "content": "Troi hallucinates auth middleware when spec omits auth...",
  "tags": ["troi", "auth", "hallucination"],
  "refs": { "artifact_ids": ["ART-0042"], "run_id": "run-abc" },
  "produced_by": { "agent": "qa_reviewer", "source": "post_dev_graph" },
  "produced_at": "2026-04-22T10:15:00Z"
}
```

## Observation kinds

| Kind | Meaning |
|---|---|
| `observation` | Raw fact ("model returned 402 after 4097-token prompt") |
| `lesson` | Generalized rule ("include EXAMPLE_OUTPUT in structured-JSON prompts") |
| `pattern` | Recurring shape ("auth failures correlate with missing CORS config") |
| `decision` | Active choice rationale ("went with flash over sonnet for intake due to cost") |
| `user_note` | Human-written note via Verify portal or direct file edit |

## Scope convention

- `global` — applies to the whole factory
- `agent:<id>` — specific to a named agent (`troi`, `picard`, `genovi`)
- `project:<id>` — specific to one project (the agent-workspace subdir name)

Prefer the narrowest accurate scope.

## API

```js
import { getMemoryService } from "./memory-layer/service.js";

const mem = getMemoryService();                  // reads env, default filesystem

await mem.addObservation({
  kind: "lesson",
  scope: "agent:troi",
  content: "Troi needs auth clause in triage spec or hallucinates middleware.",
  tags: ["troi", "auth"],
  refs: { artifact_ids: ["ART-0042"] },
  produced_by: { agent: "qa_reviewer" },
});

await mem.recall({ scope: "agent:troi" });       // all Troi observations
await mem.recall({ tags: ["auth"] });            // AND semantics
await mem.recall({ text: "openrouter", limit: 5 });
await mem.recall({ scope: "project:", kind: "user_note" });   // scope prefix
await mem.listForScope("global");
await mem.getById("OBS-0042");                   // { record, markdown }
```

## Cross-project artifact walker

```js
import { walkArtifacts, summarizeArtifacts } from "./memory-layer/artifact-walker.js";

await summarizeArtifacts("/home/user/Projects/agent-workspace");
// → { total_artifacts: 142, total_projects: 7, by_kind: {...}, total_cost_usd: 4.18 }
```

This is a **read-only view** over the Phase 6-A artifact stores — it doesn't copy data into the memory vault.

## Feature flags

```
USE_MEMORY_LAYER=true         # Phase 7-E onwards: graph nodes and Verify portal write observations.
                              # Phase 7-A: flag has no runtime effect yet.
MEMORY_BACKEND=filesystem     # "filesystem" (default), "sqlite" (7-B), "postgres" (7-C), "vector" (7-D)
FACTORY_MEMORY_ROOT=...       # override vault root. Default: ~/Projects/agent-workspace/_factory-memory/
```

## Design decisions

- **Filesystem + markdown default** — Obsidian-visible, git-diffable, zero-dep. SQLite/Postgres/vector come in 7-B/C/D behind the same interface.
- **Scope as string, not hierarchy** — `"agent:troi"` is a single partition key; recall supports exact-match AND prefix-match.
- **Separate from `memory.js`** — skill synthesis (Chroma+Postgres, narrow) and observations (broad, human-curateable) serve different needs.
- **Artifact walker is read-only** — no double-write. If an observation refers to an artifact, it's via `refs.artifact_ids` pointer, not copy.

## Rollback

Set `USE_MEMORY_LAYER=false` (default). Phase 7-A has no runtime effect regardless. The vault directory itself is inert — no process reads it until a later subphase wires it in.
