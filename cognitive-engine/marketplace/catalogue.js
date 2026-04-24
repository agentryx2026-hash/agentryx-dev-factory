/**
 * Built-in module catalogue — ModuleManifests for all 13 A-tier scaffolds
 * shipped through Phase 5-A to Phase 17-A.
 *
 * D163: these manifests describe the real registered behavior. Each factory
 * function wraps the corresponding registry registration so installing the
 * module via the marketplace produces the same live behavior as direct use.
 * The pipeline layer composes them into `installAllBuiltins()`.
 *
 * Manifests intentionally carry no LLM dependencies — built-ins are the
 * template / heuristic / stub variants that Phases 15-A, 16-A, 17-A ship.
 * LLM-backed modules get their own manifests in 18-B (ids like
 * `self-improvement.proposer-llm-opus`).
 */

const BUILTIN_AUTHOR = "agentryx-core";
const BUILTIN_VERSION = "1.0.0-alpha";

/** Generic no-op factory for modules that don't need downstream wiring. */
function simpleFactory(id, metadata = {}) {
  return () => ({ id, version: BUILTIN_VERSION, status: "installed", metadata });
}

// ---------------------------------------------------------------------------
// Phase 5-A — MCP Tool Plane
// ---------------------------------------------------------------------------
const mcpBridge = {
  id: "mcp.bridge-builtin",
  name: "MCP bridge (built-in)",
  version: BUILTIN_VERSION,
  category: "mcp_tool",
  owning_phase: "Phase 5",
  capabilities: ["mcp-bridge", "tool-plane"],
  description: "Default MCP client + bridge described by configs/mcp-servers.json (Phase 5-A).",
  author: BUILTIN_AUTHOR,
  config_entries: ["mcp_servers"],
  feature_flag: "USE_MCP_TOOLS",
  factory: simpleFactory("mcp.bridge-builtin", { bridge: "cognitive-engine/mcp" }),
};

// ---------------------------------------------------------------------------
// Phase 6-A — Artifact Store
// ---------------------------------------------------------------------------
const artifactStore = {
  id: "artifacts.filesystem-store",
  name: "Artifact store (filesystem)",
  version: BUILTIN_VERSION,
  category: "artifact_store",
  owning_phase: "Phase 6",
  capabilities: ["artifact-persistence", "sha256-index"],
  description: "Filesystem-backed artifact store; index.jsonl + content_ref files. Phase 6-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_ARTIFACT_STORE",
  factory: simpleFactory("artifacts.filesystem-store", { backend: "filesystem" }),
};

// ---------------------------------------------------------------------------
// Phase 7-A — Memory Layer
// ---------------------------------------------------------------------------
const memoryFilesystem = {
  id: "memory-layer.filesystem-backend",
  name: "Memory layer (filesystem backend)",
  version: BUILTIN_VERSION,
  category: "memory_backend",
  owning_phase: "Phase 7",
  capabilities: ["observation-write", "recall", "obsidian-visible"],
  description: "Default memory-layer backend — scope-partitioned markdown + index.jsonl. Phase 7-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_MEMORY_LAYER",
  factory: simpleFactory("memory-layer.filesystem-backend", { backend: "filesystem" }),
};

// ---------------------------------------------------------------------------
// Phase 8-A — Parallel Artifacts (no runtime registration needed in 18-A)
// ---------------------------------------------------------------------------
const parallelArtifacts = {
  id: "parallel.fanout-reducers",
  name: "Parallel artifacts (fan-out / reducers)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 8",
  capabilities: ["fan-out", "join-reducers"],
  description: "Fan-out proof + 7 reducers used by Phase 8-B to rewire dev_graph.js.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_PARALLEL_DEV_GRAPH",
  factory: simpleFactory("parallel.fanout-reducers", { reducer_count: 7 }),
};

// ---------------------------------------------------------------------------
// Phase 9-A — Verify Integration
// ---------------------------------------------------------------------------
const verifyIntegration = {
  id: "verify-integration.mock-client",
  name: "Verify integration (mock client)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 9",
  capabilities: ["bundle-publish", "feedback-receive", "fix-routing"],
  description: "Mock Verify client + feedback cycle router. Phase 9-A (30 assertions).",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_VERIFY_INTEGRATION",
  factory: simpleFactory("verify-integration.mock-client", { mode: "mock" }),
};

// ---------------------------------------------------------------------------
// Phase 10-A — Courier
// ---------------------------------------------------------------------------
const courierFake = {
  id: "courier.fake-backend",
  name: "Courier (fake backend)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 10",
  capabilities: ["event-dispatch", "routing", "multi-channel"],
  description: "Event router with 6 channels × 3 backends (fake / http-stub / null). Phase 10-A.",
  author: BUILTIN_AUTHOR,
  config_entries: ["courier_routing"],
  feature_flag: "USE_COURIER",
  factory: simpleFactory("courier.fake-backend", { backend: "fake", channels: 6 }),
};

// ---------------------------------------------------------------------------
// Phase 11-A — Cost Tracker
// ---------------------------------------------------------------------------
const costTrackerLib = {
  id: "cost-tracker.rollup-lib",
  name: "Cost tracker (rollup lib)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 11",
  capabilities: ["cost-rollup", "threshold-evaluation"],
  description: "CostRollup across artifacts + llm_calls; threshold config schema. Phase 11-A.",
  author: BUILTIN_AUTHOR,
  config_entries: ["cost_thresholds"],
  feature_flag: "USE_COST_TRACKER",
  factory: simpleFactory("cost-tracker.rollup-lib", { unit: "usd" }),
};

// ---------------------------------------------------------------------------
// Phase 12-A — Admin Substrate
// ---------------------------------------------------------------------------
const adminSubstrate = {
  id: "admin-substrate.config-roles-audit",
  name: "Admin substrate (configs + roles + audit)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 12",
  capabilities: ["config-crud", "role-gate", "feature-flag-catalog", "audit"],
  description: "7 configs + 11 flags + 4 role levels + append-only audit log. Phase 12-A (41 assertions).",
  author: BUILTIN_AUTHOR,
  factory: simpleFactory("admin-substrate.config-roles-audit", { roles: 4, configs: 7 }),
};

// ---------------------------------------------------------------------------
// Phase 13-A — Replay Engine
// ---------------------------------------------------------------------------
const replayEngine = {
  id: "replay.executor-substrate",
  name: "Replay engine (substrate)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 13",
  capabilities: ["run-snapshot", "plan-builder", "executor", "stub-dispatch"],
  description: "Run collector + plan builder + executor + cross-snapshot resolution. Phase 13-A (36 assertions).",
  author: BUILTIN_AUTHOR,
  factory: simpleFactory("replay.executor-substrate", {}),
};

// ---------------------------------------------------------------------------
// Phase 14-A — Concurrency
// ---------------------------------------------------------------------------
const concurrencyQueue = {
  id: "concurrency.fs-queue",
  name: "Concurrency queue (filesystem)",
  version: BUILTIN_VERSION,
  category: "handler",
  owning_phase: "Phase 14",
  capabilities: ["job-queue", "worker-pool", "round-robin-fairness"],
  description: "Filesystem-backed JSONL queue + worker pool with atomic POSIX rename leasing. Phase 14-A (28 assertions).",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_JOB_QUEUE",
  factory: simpleFactory("concurrency.fs-queue", { scheduler: "round-robin" }),
};

// ---------------------------------------------------------------------------
// Phase 15-A — Self-Improvement
// ---------------------------------------------------------------------------
const heuristicProposer = {
  id: "self-improvement.heuristic-proposer",
  name: "Self-improvement proposer (heuristic)",
  version: BUILTIN_VERSION,
  category: "proposer",
  owning_phase: "Phase 15",
  capabilities: ["proposer", "lesson-clustering", "model-underperformance", "config-drift"],
  description: "3-rule heuristic proposer emitting prompt/model/config Proposals. Phase 15-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_SELF_IMPROVEMENT",
  factory: simpleFactory("self-improvement.heuristic-proposer", { rule_count: 3, llm: false }),
};

// ---------------------------------------------------------------------------
// Phase 16-A — Training Generators (six template generators as one module)
// ---------------------------------------------------------------------------
const trainingTemplateGens = {
  id: "training-gen.template-generators",
  name: "Training generators (templates)",
  version: BUILTIN_VERSION,
  category: "generator",
  owning_phase: "Phase 16",
  capabilities: [
    "user_guide", "quick_start", "how_to", "reference_doc",
    "voiceover_script", "video_storyboard",
  ],
  description: "6 deterministic template generators; $0 cost; Phase 17-ready voiceover schema. Phase 16-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_TRAINING_GEN",
  factory: simpleFactory("training-gen.template-generators", { generator_count: 6, llm: false }),
};

// ---------------------------------------------------------------------------
// Phase 17-A — Training Videos (three-category providers)
// ---------------------------------------------------------------------------
const videoTtsStubPack = {
  id: "training-videos.tts-stub-pack",
  name: "Training-videos TTS (stub pack)",
  version: BUILTIN_VERSION,
  category: "provider",
  owning_phase: "Phase 17",
  capabilities: ["tts", "tts:null", "tts:stub:elevenlabs", "tts:stub:openai"],
  description: "3 TTS backends (null + stub ElevenLabs + stub OpenAI). Phase 17-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_TRAINING_VIDEOS",
  factory: simpleFactory("training-videos.tts-stub-pack", {
    backends: ["tts:null", "tts:stub:elevenlabs:rachel", "tts:stub:openai:tts-1:alloy"],
  }),
};

const videoCaptureStubPack = {
  id: "training-videos.capture-stub-pack",
  name: "Training-videos capture (stub pack)",
  version: BUILTIN_VERSION,
  category: "provider",
  owning_phase: "Phase 17",
  capabilities: ["capture", "capture:null", "capture:stub:puppeteer", "capture:stub:playwright"],
  description: "3 capture backends (null + stub Puppeteer + stub Playwright). Phase 17-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_TRAINING_VIDEOS",
  factory: simpleFactory("training-videos.capture-stub-pack", {
    backends: ["capture:null", "capture:stub:puppeteer:1280x720", "capture:stub:playwright:1280x720"],
  }),
};

const videoStitcherStubPack = {
  id: "training-videos.stitcher-stub-pack",
  name: "Training-videos stitcher (stub pack)",
  version: BUILTIN_VERSION,
  category: "provider",
  owning_phase: "Phase 17",
  capabilities: ["stitcher", "stitcher:null", "stitcher:stub:ffmpeg"],
  description: "2 stitcher backends (null + stub ffmpeg). Phase 17-A.",
  author: BUILTIN_AUTHOR,
  feature_flag: "USE_TRAINING_VIDEOS",
  factory: simpleFactory("training-videos.stitcher-stub-pack", {
    backends: ["stitcher:null", "stitcher:stub:ffmpeg:1280x720"],
  }),
};

// ---------------------------------------------------------------------------
export const BUILTIN_MANIFESTS = Object.freeze([
  mcpBridge,
  artifactStore,
  memoryFilesystem,
  parallelArtifacts,
  verifyIntegration,
  courierFake,
  costTrackerLib,
  adminSubstrate,
  replayEngine,
  concurrencyQueue,
  heuristicProposer,
  trainingTemplateGens,
  videoTtsStubPack,
  videoCaptureStubPack,
  videoStitcherStubPack,
]);

export function getBuiltinManifest(id) {
  return BUILTIN_MANIFESTS.find(m => m.id === id) || null;
}
