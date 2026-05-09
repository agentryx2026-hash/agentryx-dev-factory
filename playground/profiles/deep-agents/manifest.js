export const manifest = {
  id: "playground.deep-agents",
  name: "LangChain Deep Agents (experimental profile)",
  version: "2026-03-eval",
  category: "experimental",
  capabilities: ["coordinator", "subagent-dispatch", "filesystem-reasoning", "deploy-cli"],
  owning_phase: "Phase 2.76",
  description: "Beta Playground evaluation profile for LangChain Deep Agents — coordinator + subagent harness on LangGraph. Candidate for Phase 9. See playground/profiles/deep-agents/PROFILE.md.",
  author: "agentryx-core",
  feature_flag: "USE_DEEP_AGENTS_COORDINATOR",
  factory: () => ({
    id: "playground.deep-agents",
    version: "2026-03-eval",
    status: "installed",
    metadata: {
      profile_status: "exploring",
      profile_path: "playground/profiles/deep-agents/",
      upstream_url: "https://github.com/langchain-ai/deepagents",
      adaptation_strategy: ["adopt-upstream-and-extend", "steal-pattern-deploy"],
      gates_capabilities: ["coordinator-pattern", "subagent-dispatch", "deepagents-deploy"],
      decision_pending: "Phase 2.76 D184",
      target_graduation: "Phase 9 coordinator implementation",
    },
  }),
};

export default manifest;
