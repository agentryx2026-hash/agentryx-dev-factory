# Artifact Store

Typed, versioned artifact store for cognitive-engine pipeline outputs. Alternative to string-blob state fields (`codeOutput`, `qaReport`, etc.).

## Status: Phase 6-A scaffolding

Built but **not wired into graph nodes**. Flag `USE_ARTIFACT_STORE` defaults off. Phase 6-B will add dual-write: graphs write to both state AND the artifact store.

## Files

- `types.js` — artifact kind enum, schema version, JSDoc shapes
- `store.js` — `writeArtifact`, `listArtifacts`, `getArtifact`, `verifyArtifact`, `isEnabled`
- `smoke-test.js` — standalone verification

## Store layout (per project)

```
${PROJECT_DIR}/_artifacts/
  ├── index.jsonl          # append-only manifest (one JSON record per line)
  ├── ART-0001.md          # string content
  ├── ART-0002.json        # structured content
  └── ...
```

## Artifact record shape

```json
{
  "id": "ART-0042",
  "kind": "code_output",
  "schema_version": 1,
  "produced_by": {
    "agent": "troi",
    "node": "troiBackendNode",
    "model": "openrouter:anthropic/claude-sonnet-4-5",
    "run_id": "pre-dev-2026-04-21-abc",
    "iteration": 1
  },
  "produced_at": "2026-04-21T18:42:11Z",
  "cost_usd": 0.042,
  "latency_ms": 4812,
  "content_ref": "ART-0042.md",
  "content_sha256": "<hex>",
  "parent_ids": ["ART-0040", "ART-0041"]
}
```

## Artifact kinds (initial catalog)

| Kind | Replaces state field | Graph |
|---|---|---|
| `code_output` | `codeOutput` | dev, factory |
| `test_output` | `testOutput` | dev, factory |
| `qa_report` | `qaReport` | dev, factory |
| `triage_spec` | `triageSpec` | dev, factory |
| `research_dossier` | `researchDossier` | dev, factory |
| `architect_review` | `architectReview` | dev, factory |
| `deploy_status` | `deployStatus` | dev, factory |
| `pmd_doc` | each key of `pmdDocs` / `deliveryDocs` | all |
| `raw_extraction` | `pmdDocs._raw_extraction` (Genovi) | pre_dev |

## API

```js
import { writeArtifact, listArtifacts, getArtifact, verifyArtifact, isEnabled } from "./artifacts/store.js";

const projectDir = "/path/to/project";

const record = await writeArtifact(projectDir, {
  kind: "code_output",
  content: "const x = 1;",                                       // string → .md
  produced_by: { agent: "troi", run_id: "abc", iteration: 1 },
  cost_usd: 0.02,
  latency_ms: 1500,
  parent_ids: ["ART-0041"],
});
// record.id === "ART-0042"

await listArtifacts(projectDir);                                 // all
await listArtifacts(projectDir, { kind: "code_output" });        // filter by kind
const entry = await getArtifact(projectDir, "ART-0042");         // { record, content }
await verifyArtifact(projectDir, "ART-0042");                    // sha check
```

## Feature flag

```
USE_ARTIFACT_STORE=true    # Phase 6-B onwards: graph nodes write artifacts after each LLM call
                           # Phase 6-A: flag has no runtime effect yet
```

## Design decisions

- **Filesystem-backed, not DB** — artifacts live alongside source code in `_artifacts/`. Phase 7 may add a Postgres view on top. FS-first means replay/browse/diff work with git and standard tools.
- **Append-only index.jsonl** — no rewrites, no locking, safe for parallel writes within one process. Concurrent runs across processes need a different strategy (future enhancement).
- **ID-based content files, not content-hash** — human-browsable. SHA is stored in the manifest for integrity checks, not used as path.
- **JSDoc types, not TypeScript** — cognitive-engine is plain JS. Types in comments give editor support without a compile step.

## Rollback

Set `USE_ARTIFACT_STORE=false` (default). Phase 6-A has no runtime effect regardless. Phase 6-B's dual-write pattern means the artifact store is always additive — disabling it cannot break a run.
