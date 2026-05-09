export const manifest = {
  id: "playground.honcho",
  name: "Honcho dialectic memory (experimental profile)",
  version: "0.0.0-eval",
  category: "experimental",
  capabilities: ["memory_backend", "dialectic-inference", "user-modeling"],
  owning_phase: "Phase 2.76",
  description: "Beta Playground evaluation profile for Honcho — open-source dialectic memory backend. Candidate for Phase 7-E. See playground/profiles/honcho/PROFILE.md.",
  author: "agentryx-core",
  feature_flag: "USE_HONCHO_MEMORY",
  factory: () => ({
    id: "playground.honcho",
    version: "0.0.0-eval",
    status: "installed",
    metadata: {
      profile_status: "exploring",
      profile_path: "playground/profiles/honcho/",
      upstream_url: "https://github.com/plastic-labs/honcho",
      adaptation_strategy: ["adopt-upstream"],
      gates_capabilities: ["dialectic-memory", "implicit-user-model"],
      decision_pending: "Phase 2.76 D183",
      target_graduation: "Phase 7-E",
    },
  }),
};

export default manifest;
