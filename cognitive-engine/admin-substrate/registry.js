/**
 * Admin substrate — explicit catalog of known configs and feature flags.
 *
 * D126: this is a CODE catalog, not a discovered/scanned thing. Every entry is
 * intentional. Adding a new config = adding a row here. Removing one = removing
 * a row. Grep-friendly, review-friendly.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** @type {import("./types.js").ConfigEntry[]} */
export const CONFIG_ENTRIES = Object.freeze([
  {
    id: "pmd_registry",
    display_name: "PMD Document Registry",
    description: "25 PMD doc metadata entries (Phase 4).",
    path: path.join(REPO_ROOT, "configs", "pmd-registry.json"),
    category: "registry",
    min_role_view: "operator",
    min_role_edit: "admin",
    sensitive: false,
  },
  {
    id: "cost_thresholds",
    display_name: "Cost Thresholds",
    description: "Warn/hard-cap thresholds per scope × window (Phase 11-A).",
    path: path.join(REPO_ROOT, "configs", "cost-thresholds.json"),
    category: "thresholds",
    min_role_view: "operator",
    min_role_edit: "super_admin",
    sensitive: false,
    schema_version: 1,
  },
  {
    id: "courier_routing",
    display_name: "Courier Event Routing",
    description: "Event-type → channel routing rules (Phase 10-A).",
    path: path.join(REPO_ROOT, "configs", "courier-routing.json"),
    category: "routing",
    min_role_view: "operator",
    min_role_edit: "admin",
    sensitive: false,
    schema_version: 1,
  },
  {
    id: "llm_routing",
    display_name: "LLM Task Routing",
    description: "Task tier → provider/model routing with fallback chains (Phase 2).",
    path: path.join(REPO_ROOT, "configs", "llm-routing.json"),
    category: "routing",
    min_role_view: "operator",
    min_role_edit: "super_admin",
    sensitive: false,
  },
  {
    id: "llm_prices",
    display_name: "LLM Pricing Table",
    description: "Per-model token pricing for cost capture (Phase 2).",
    path: path.join(REPO_ROOT, "configs", "llm-prices.json"),
    category: "pricing",
    min_role_view: "operator",
    min_role_edit: "super_admin",
    sensitive: false,
  },
  {
    id: "providers",
    display_name: "LLM Provider Catalog",
    description: "Provider definitions used by the Key Console (Phase 2.5).",
    path: path.join(REPO_ROOT, "configs", "providers.json"),
    category: "providers",
    min_role_view: "operator",
    min_role_edit: "super_admin",
    sensitive: false,
  },
  {
    id: "mcp_servers",
    display_name: "MCP Server Catalog",
    description: "Model Context Protocol servers + per-server enable flag (Phase 5-A).",
    path: path.join(REPO_ROOT, "cognitive-engine", "mcp", "configs", "servers.json"),
    category: "mcp",
    min_role_view: "operator",
    min_role_edit: "admin",
    sensitive: false,
  },
]);

/** @type {import("./types.js").FeatureFlag[]} */
export const FEATURE_FLAGS = Object.freeze([
  {
    env_var: "PRE_DEV_USE_GRAPH",
    display_name: "Pre-dev: real LLM graph",
    description: "Switches /api/factory/pre-dev from template substitution to real LLM pipeline.",
    owning_phase: "Phase 4",
    default_when_unset: "off",
  },
  {
    env_var: "USE_MCP_TOOLS",
    display_name: "MCP tool plane",
    description: "Graph nodes use MCP server-backed tools instead of tools.js. Requires Phase 5-B graph wiring.",
    owning_phase: "Phase 5",
    default_when_unset: "off",
  },
  {
    env_var: "USE_ARTIFACT_STORE",
    display_name: "Artifact store dual-write",
    description: "Graph nodes write artifacts to _artifacts/ alongside state. Requires Phase 6-B graph wiring.",
    owning_phase: "Phase 6",
    default_when_unset: "off",
  },
  {
    env_var: "USE_MEMORY_LAYER",
    display_name: "Memory layer write-through",
    description: "Graph nodes + Verify portal write user_note observations. Requires Phase 7-E.",
    owning_phase: "Phase 7",
    default_when_unset: "off",
  },
  {
    env_var: "USE_PARALLEL_DEV_GRAPH",
    display_name: "Dev graph fan-out/join",
    description: "Code/tests/docs run as concurrent branches. Requires Phase 8-B graph rewire.",
    owning_phase: "Phase 8",
    default_when_unset: "off",
  },
  {
    env_var: "USE_VERIFY_INTEGRATION",
    display_name: "Verify portal integration",
    description: "Bundle publishes + feedback webhook are wired into telemetry.mjs. Requires Phase 9-B.",
    owning_phase: "Phase 9",
    default_when_unset: "off",
  },
  {
    env_var: "USE_COURIER",
    display_name: "Courier event dispatch",
    description: "Factory events dispatched to channels via Courier. Requires Phase 10-B.",
    owning_phase: "Phase 10",
    default_when_unset: "off",
  },
  {
    env_var: "USE_COST_TRACKER",
    display_name: "Cost tracker UI/alerts",
    description: "Dashboard binds to rollup endpoint, threshold evaluator emits Courier events. Requires Phase 11-B.",
    owning_phase: "Phase 11",
    default_when_unset: "off",
  },
  {
    env_var: "USE_SELF_IMPROVEMENT",
    display_name: "Self-improvement proposer",
    description: "Proposer runs on cadence; proposals flow through evaluator + Super Admin gate. Requires Phase 15-B.",
    owning_phase: "Phase 15",
    default_when_unset: "off",
  },
  {
    env_var: "USE_TRAINING_GEN",
    display_name: "Training generation post-dev",
    description: "post_dev_graph enqueues training_gen jobs; produces voiceover scripts + storyboards + written guides. Requires Phase 16-B.",
    owning_phase: "Phase 16",
    default_when_unset: "off",
  },
  {
    env_var: "USE_TRAINING_VIDEOS",
    display_name: "Training video rendering",
    description: "training_video_render jobs consume Phase 16 voiceover scripts and produce narrated mp4 via TTS + capture + stitcher providers. Requires Phase 17-B.",
    owning_phase: "Phase 17",
    default_when_unset: "off",
  },
  {
    env_var: "USE_MODULE_MARKETPLACE",
    display_name: "Module marketplace boot-install",
    description: "Factory startup runs installAllBuiltins + any configured external modules; modules become swappable via manifest. Requires Phase 18-B.",
    owning_phase: "Phase 18",
    default_when_unset: "off",
  },
  {
    env_var: "USE_CUSTOMER_PORTAL",
    display_name: "Customer portal HTTP + UI",
    description: "HTTP API + React UI accept customer submissions; queue handler + Courier notifications active. Requires Phase 19-B.",
    owning_phase: "Phase 19",
    default_when_unset: "off",
  },
]);

export function getConfigEntry(id) {
  return CONFIG_ENTRIES.find(e => e.id === id) || null;
}

export function getFeatureFlag(envVar) {
  return FEATURE_FLAGS.find(f => f.env_var === envVar) || null;
}

export function listConfigsForRole(role) {
  return CONFIG_ENTRIES.filter(e => canRoleView(role, e));
}

import { ROLE_RANK } from "./types.js";

export function canRoleView(role, entry) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[entry.min_role_view] ?? 99);
}

export function canRoleEdit(role, entry) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[entry.min_role_edit] ?? 99);
}
