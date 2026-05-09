/**
 * Beta Playground manifest — Hermes Agent profile.
 *
 * Registered as `category: "experimental"` per D188. Graduates to its own
 * stable category(/categories) when Phase 2.76 D182 reaches a decision.
 */

export const manifest = {
  id: "playground.hermes-agent",
  name: "Hermes Agent (experimental profile)",
  version: "0.13.0-eval",
  category: "experimental",
  capabilities: ["multi-agent-runtime", "memory-honcho", "skills-curator", "gateway", "kanban-durable", "ralph-loop"],
  owning_phase: "Phase 2.76",
  description: "Beta Playground evaluation profile for Nous Research's Hermes Agent v0.13. See playground/profiles/hermes-agent/PROFILE.md for the full plan.",
  author: "agentryx-core",
  feature_flag: "USE_HERMES_KANBAN_PATTERNS",
  factory: () => ({
    id: "playground.hermes-agent",
    version: "0.13.0-eval",
    status: "installed",
    metadata: {
      profile_status: "exploring",
      profile_path: "playground/profiles/hermes-agent/",
      upstream_url: "https://github.com/NousResearch/hermes-agent",
      upstream_version: "v0.13.0",
      adaptation_strategy: ["steal-patterns", "wrap-and-extend", "adopt-honcho-only"],
      gates_capabilities: [
        "multi-agent-kanban-patterns",
        "honcho-dialectic-memory",
        "curator-skills-health",
        "ralph-loop-primitive",
        "soul-md-per-agent",
      ],
      decision_pending: "Phase 2.76 D182",
    },
  }),
};

export default manifest;
