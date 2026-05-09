export const manifest = {
  id: "playground.thinking-machines-tinker",
  name: "Thinking Machines / Tinker (watching profile)",
  version: "private-beta-watch",
  category: "experimental",
  capabilities: ["lora-training", "rl-post-training", "specialist-models", "thinking-machines-lab-watch"],
  owning_phase: "Phase 2.76",
  description: "Beta Playground watching profile for Thinking Machines Lab (Mira Murati). Tinker is currently private beta. Long-term candidate for Phase 15-C training backend. See playground/profiles/thinking-machines-tinker/PROFILE.md.",
  author: "agentryx-core",
  factory: () => ({
    id: "playground.thinking-machines-tinker",
    version: "private-beta-watch",
    status: "installed",
    metadata: {
      profile_status: "watching",
      profile_path: "playground/profiles/thinking-machines-tinker/",
      upstream_url: "https://thinkingmachines.ai/",
      tinker_url: "https://thinkingmachines.ai/tinker/",
      adaptation_strategy: ["watch-and-document", "adopt-on-ga"],
      gates_capabilities: ["lora-fine-tuning", "rl-post-training", "specialist-model-training"],
      decision_pending: "Phase 2.76 D185 (deferred until Tinker GA)",
      target_graduation: "Phase 15-C/D training backend",
    },
  }),
};

export default manifest;
