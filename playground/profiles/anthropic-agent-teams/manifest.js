export const manifest = {
  id: "playground.anthropic-agent-teams",
  name: "Anthropic Agent Teams (experimental profile)",
  version: "experimental-2026-05",
  category: "experimental",
  capabilities: ["coordinator", "subagent-dispatch", "claude-code-native"],
  owning_phase: "Phase 2.76",
  description: "Beta Playground evaluation profile for Anthropic's Agent Teams primitive in Claude Code. Candidate for Phase 9. See playground/profiles/anthropic-agent-teams/PROFILE.md.",
  author: "agentryx-core",
  feature_flag: "USE_ANTHROPIC_AGENT_TEAMS",
  factory: () => ({
    id: "playground.anthropic-agent-teams",
    version: "experimental-2026-05",
    status: "installed",
    metadata: {
      profile_status: "exploring",
      profile_path: "playground/profiles/anthropic-agent-teams/",
      upstream_url: "https://code.claude.com/docs/en/agent-teams",
      adaptation_strategy: ["adopt-upstream-if-stable", "steal-parent-tool-use-id-pattern"],
      gates_capabilities: ["claude-code-native-coordination", "parent-tool-use-id-lineage"],
      decision_pending: "Phase 2.76 D186",
      target_graduation: "alternative Phase 9 coordinator",
    },
  }),
};

export default manifest;
