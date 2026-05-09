# Beta Playground

The Agentryx Dev Factory's permanent capability for **hands-on evaluation of bleeding-edge tools** before any commitment to adopt.

> "If they don't work fully as we see, we can build our own layer together with that, or we can build our own tool, and then we can keep developing that going forward. Who knows, we might build the next Hermes or next OpenCLAW if we keep building and testing over the entire dev factory."
> — founder, 2026-05-09

## Three-stage research → adopt pipeline

```
pmd/.../Research/         playground/profiles/         cognitive-engine/
─────────────────         ────────────────────         ────────────────
Landscape scans     ──►   Hands-on profiles    ──►    Stable substrate
"What's out there"        "What we tried"             "What we adopted"

(read + cite)             (install + measure +        (production-direction
                           document + decide)          implementations)
```

Each stage feeds the next. Stage transitions are formal Decisions in `Phase_NN_Decisions.md`. Nothing graduates without measurement.

## Why this exists

Per Phase 2.76 D181, the Beta Playground is a permanent capability — not a one-off evaluation effort. The AI ecosystem moves faster than any single team can absorb. Rather than try to *predict* which tool wins, we **actively test all interesting candidates** and let measured outcomes drive adoption.

This also enables an emergent property the founder named explicitly: **the Lab is the launching pad for our own tools.** A profile that fails to satisfy our needs but reveals a clear pattern is the seed of a new module we build ourselves. Test → learn → fork or rebuild.

## Folder layout

```
playground/
  ├── README.md           ← this file
  ├── PROFILE_TEMPLATE.md ← copy this when adding a new profile
  ├── runner.js           ← runs reference scenario stable + experimental variants
  ├── profiles/           ← one folder per tool under evaluation
  │   ├── hermes-agent/
  │   │   ├── PROFILE.md
  │   │   ├── manifest.js     ← ModuleManifest with category: "experimental"
  │   │   ├── adapter.js      ← thin wrapper over the upstream tool
  │   │   ├── smoke-test.js   ← does it work in isolation?
  │   │   └── COMPARE.md      ← side-by-side: cost / latency / pass-rate vs stable
  │   ├── honcho/
  │   ├── deep-agents/
  │   ├── anthropic-agent-teams/
  │   ├── thinking-machines-tinker/
  │   └── ...
  └── results/            ← per-run JSON: { tool, version, scenario, metrics }
      ├── 2026-05-15_baseline.json
      ├── 2026-05-15_hermes-agent_v0.13.json
      └── ...
```

## Profile lifecycle

Every profile carries a `status` field that maps to a stage in the lifecycle:

```
watching ──► exploring ──► testing ──► adopting ──► (graduates to cognitive-engine/)
                              │
                              ├──► rejecting ──► (archived; PROFILE.md kept for institutional memory)
                              │
                              └──► parked ────► (paused; revisit on next monthly review)
```

| Status | Meaning |
|---|---|
| **watching** | We know about the tool; profile carries plan + dates to revisit. No code yet. |
| **exploring** | First contact: install, dry-run, document the surface area. |
| **testing** | Wired into the runner; producing comparison data against the stable baseline. |
| **adopting** | Decision is reached — we'll graduate this to a stable module. PROFILE.md notes the target Phase + timeline. |
| **rejecting** | Decision is reached — we won't adopt. PROFILE.md captures *why* (cost, fit, security, ecosystem direction) for future reference. |
| **parked** | Paused; usually because upstream isn't ready (private beta, alpha-only). Re-evaluated monthly. |

Status changes are recorded as Decisions in `Phase_NN_Decisions.md` — never silently in PROFILE.md alone.

## How to add a new profile

1. **Copy** `PROFILE_TEMPLATE.md` to `profiles/<tool-slug>/PROFILE.md`.
2. **Fill in** What / Why / Adaptation plan / Integration sketch / Test plan sections.
3. **Add a manifest** at `profiles/<tool-slug>/manifest.js` with `category: "experimental"`. The marketplace already accepts this category (D188).
4. **Wire into the runner**: add the tool to `runner.js`'s candidate list. The runner runs the cross-phase composition smoke (`cognitive-engine/integration/composition-smoke.js`) against the stable baseline plus optional experimental variants.
5. **Open a PR** with `profile/<tool-slug>` branch name. Status starts at `watching` or `exploring`.
6. **Run** `node playground/runner.js --include <tool-slug>`. Results land in `results/`.
7. **Update PROFILE.md** with the dated learning. Don't squash multiple weeks of observations.

## How to graduate a profile to stable

1. Run the runner against the profile until you have ≥3 dated comparison runs.
2. Open `Phase_NN_Decisions.md` for the relevant phase (or create a new Phase entry if it crosses phase boundaries).
3. Record a Decision: tool name, version evaluated, observed metrics, recommendation (adopt / fork / steal-pattern / reject).
4. If adopting:
   - Write a real module under `cognitive-engine/<new-module-name>/` following `D.Roadmap/03_Scaffolding_Pattern.md`.
   - Move the profile's status to `adopted` and add a "graduated to" pointer.
   - Promote the marketplace manifest from `category: "experimental"` to its proper category.
5. If rejecting:
   - Status → `rejecting`. Keep PROFILE.md as institutional memory — anyone considering this tool again sees what we tried and why we didn't go forward.
   - Don't delete the profile folder. The graveyard is the wisdom.

## Reference scenario for comparison

The Lab's reference scenario is `cognitive-engine/integration/composition-smoke.js` — the 73-assertion cross-phase smoke we shipped after Phase 20-A close. It walks one customer journey through all 16 stable A-tier modules.

Per profile, the runner can:
- **Swap** one or more stable modules for experimental variants
- **Augment** with experimental modules that have no stable equivalent (e.g., Honcho memory backend layered on top of existing memory-layer)
- **Compare** wall-clock latency, total LLM cost, assertion pass-rate, and any tool-specific metric the profile declares

Output JSON in `results/` is human-and-LLM-readable; future analysis can run pattern-matching across runs.

## Cadence — D188

- **Monthly review** (last Friday of each month): walk every active profile; bump `status`; add Learnings; decide whether to keep going, park, or graduate / reject.
- **Hard re-evaluation at every release-band cut** (v0.0.1 → v1, v1 → v2, v2 → v3): each profile must have a clear adopt / reject / continue verdict. Profiles that have lingered for two release-band cycles without progress get parked.
- **Drop-in welcome anytime**: alpha or beta tools can land between cadences — add a profile with status `watching`, link to upstream, schedule first contact.

## Initial roster (Phase 2.76 close)

**Tier 1 — install + integrate this month:**

| # | Tool | Status | Why this tool |
|---|---|---|---|
| 1 | [Hermes Agent](profiles/hermes-agent/) | exploring | Founder's specific call-out; v0.13 ships durable Kanban + 20-platform gateway |
| 2 | [Honcho](profiles/honcho/) | exploring | Dialectic memory — fills Phase 7-E gap regardless of Hermes adoption |
| 3 | [LangChain Deep Agents](profiles/deep-agents/) | exploring | Phase 9 alternative; same vendor as our stable runtime |
| 4 | [Anthropic Agent Teams](profiles/anthropic-agent-teams/) | exploring | Multi-agent built into the SDK we already use |

**Tier 2 — watching, integrate next month:**

| # | Tool | Status | Why |
|---|---|---|---|
| 5 | [Thinking Machines / Tinker + Atropos](profiles/thinking-machines-tinker/) | watching | Mira Murati's team; Tinker in private beta; integrate when beta opens |
| 6 | Inspect AI (UK AISI) | (profile pending) | Could become *the* Lab evaluator — meta-tool |
| 7 | Mastra | (profile pending) | TS-native LangGraph alternative |
| 8 | DSPy + BAML | (profile pending) | Prompt management + structured output patterns |

**Tier 3 — research-only watching list** (sit in `Research/` scans, no Lab seat yet):

Strands · Vercel AI SDK 6 · A2A protocol · Browser Use / Stagehand · E2B / Daytona / Modal · Spec Kit / BMAD-METHOD / Factory.ai · OpenAI Agents SDK · Cursor 3 / Composer 2 · Devin / Aider / OpenHands · OpenSpec · Replit Agent v3 · Lovable.dev · Claude Code as a meta-runtime study

## Cost and security posture

**Cost**: Tier 1 profiles run their smoke tests at $0 (stub providers wherever possible) until measurement requires real LLM calls. When real calls are needed, profile carries a budget cap in PROFILE.md and the runner enforces it.

**Security**: Per Phase 2.76 D185, security findings (e.g., Hermes' ALLOW-ALL default, skill-poisoning vector, no signed provenance) are **recorded in PROFILE.md "Learnings"** but do not gate Lab work during v0.0.1 → v2. Hardening pass is scheduled at v2 → v3 boundary (~5-6 months out).

## Relationship to other docs

- **`pmd/.../Research/`** — landscape scans = upstream of the Lab. A profile is born when a research scan calls out a tool worth testing.
- **`cognitive-engine/marketplace/`** — Phase 18-A's marketplace is the underlying primitive. Lab profiles register with `category: "experimental"`. Adoption = recategorisation.
- **`pmd/.../D.Roadmap/03_Scaffolding_Pattern.md`** — what an adopted profile becomes. The 7-artifact recipe applies.
- **`pmd/.../D.Roadmap/Phase_2.76_Lab_and_Strategy_Update_2026_05/`** — the formal Plan + Decisions that established this capability. Read first if you want to know *why* the Lab exists in this form.
- **`Master_Factory_Architect.md` §11.8** — the architectural rationale. Read when deciding whether the Lab itself needs to evolve.
