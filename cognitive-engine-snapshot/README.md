# cognitive-engine-snapshot/

**Temporary snapshot** of the 4 cognitive-engine graph files containing the
Phase 2B `USE_ROUTER` env-toggle patches.

These files live LIVE at `~/Projects/cognitive-engine/` (outside this mono-repo
for now — that directory has its own pre-existing tree and isn't yet a git repo).
This snapshot exists so the Phase 2B changes are version-controlled until
**Phase 1.5** physically moves all of `cognitive-engine/` into this mono-repo at
`agentryx-factory/cognitive-engine/`.

When Phase 1.5 lands, this directory is deleted and the canonical files live at
`agentryx-factory/cognitive-engine/*.js`.

## What changed in this snapshot

Each graph adds `USE_ROUTER=true` env switch (Phase 2B). Pattern:

```js
const USE_ROUTER = process.env.USE_ROUTER === 'true';
let RouterChatModel;
if (USE_ROUTER) ({ RouterChatModel } = await import('@agentryx-factory/llm-router'));

const geminiFlash = USE_ROUTER
  ? new RouterChatModel({ task: 'cheap' })
  : new ChatGoogleGenerativeAI({ ... });   // unchanged default
```

Default behavior preserved exactly when `USE_ROUTER` is unset.

To activate: `Environment=USE_ROUTER=true` in `deploy/systemd/factory-telemetry.service`.
