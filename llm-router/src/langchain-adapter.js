// LangChain-compatible adapter so cognitive-engine graphs can swap
// `new ChatGoogleGenerativeAI({...})` → `new RouterChatModel({task: 'cheap'})`
// with no other changes.
//
// We don't extend LangChain's BaseChatModel class — that would couple us to
// LangChain internals. Instead we duck-type the surface that factory_graph.js
// actually uses (just .invoke()), which is what LangGraph nodes call too.
// Easy to extend later if .bindTools() / .withStructuredOutput() are needed.
//
// Phase 6-B (artifact dual-write): every successful invoke() optionally
// writes an Artifact (Phase 6-A schema) into <projectDir>/_artifacts/.
// Activates only when USE_ARTIFACT_STORE === 'true' AND projectDir is
// resolvable (per-call option, instance config, or AGENT_PROJECT_DIR env).
// Fail-open: artifact-write errors are caught + logged, never break the
// LLM call.

import { complete } from './router.js';

export class RouterChatModel {
  constructor({ task, modelOverride = null, projectId = null, phase = null, agent = null, maxTokens = null, projectDir = null, runId = null, node = null, artifactKind = null } = {}) {
    if (!task) throw new Error('RouterChatModel: task is required (e.g. "architect", "code", "cheap")');
    this.task = task;
    this.modelOverride = modelOverride;
    this.projectId = projectId;
    this.phase = phase;
    this.agent = agent;
    this.maxTokens = maxTokens;
    // Phase 6-B (artifact dual-write) — optional fields. When set + flag is
    // on, every successful invoke() writes an Artifact to projectDir/_artifacts/.
    this.projectDir = projectDir;
    this.runId = runId;
    this.node = node;
    this.artifactKind = artifactKind; // default 'raw_extraction'
  }

  async invoke(messages, options = {}) {
    // Accept LangChain message instances OR plain {role, content} objects.
    const openaiMessages = (messages ?? []).map(toOpenAIMessage);

    const projectId = options?.config?.projectId ?? this.projectId;
    const phase     = options?.config?.phase     ?? this.phase;
    const agent     = options?.config?.agent     ?? this.agent;

    const result = await complete({
      task: this.task,
      messages: openaiMessages,
      modelOverride: this.modelOverride,
      projectId,
      phase,
      agent,
      signal:    options?.signal ?? null,
      maxTokens: options?.config?.maxTokens ?? this.maxTokens,
    });

    // Phase 6-B — dual-write the LLM response as an Artifact, fail-open.
    // Only fires when USE_ARTIFACT_STORE is on AND projectDir is resolvable.
    if (process.env.USE_ARTIFACT_STORE === 'true') {
      const projectDir = options?.config?.projectDir ?? this.projectDir ?? process.env.AGENT_PROJECT_DIR ?? null;
      if (projectDir) {
        try {
          await archiveLLMArtifact({
            projectDir,
            content: result.content,
            agent,
            phase,
            model: result.model,
            backend: result.backend,
            cost_usd: result.cost_usd,
            latency_ms: result.latency_ms,
            usage: result.usage,
            run_id: options?.config?.runId ?? this.runId ?? process.env.AGENT_RUN_ID ?? null,
            node:   options?.config?.node  ?? this.node  ?? null,
            kind:   options?.config?.artifactKind ?? this.artifactKind ?? 'raw_extraction',
            messages: openaiMessages, // preserved on the artifact's meta for replay
          });
        } catch (err) {
          // Fail-open: never break the LLM call.
          console.warn(`[RouterChatModel] artifact dual-write failed: ${err?.message || err}`);
        }
      }
    }

    // Return a LangChain-shaped AIMessage.
    return {
      content: result.content,
      _meta: {
        model: result.model,
        backend: result.backend,
        cost_usd: result.cost_usd,
        latency_ms: result.latency_ms,
        usage: result.usage,
      },
    };
  }

  // LangChain's Runnable.invoke is the modern path; older code uses .call().
  // Alias for compat.
  async call(messages, options) { return this.invoke(messages, options); }

  // Identifier used by LangChain logging when present.
  _llmType() { return `agentryx-router:${this.task}`; }

  // Per-call task override without rebuilding the instance — useful when
  // the same model object handles multiple agent stages.
  withTask(task) {
    return new RouterChatModel({
      task,
      modelOverride: this.modelOverride,
      projectId: this.projectId,
      phase: this.phase,
      agent: this.agent,
    });
  }

  // Tag this instance with project/agent context so all .invoke() calls
  // carry it through to the cost telemetry. Returns a NEW instance.
  withContext({ projectId, phase, agent } = {}) {
    return new RouterChatModel({
      task: this.task,
      modelOverride: this.modelOverride,
      projectId: projectId ?? this.projectId,
      phase: phase ?? this.phase,
      agent: agent ?? this.agent,
    });
  }
}

// Phase 6-B — write a single LLM call's response as an Artifact in
// projectDir/_artifacts/. Uses lazy dynamic import so the adapter stays
// usable in environments where the cognitive-engine sibling isn't on
// disk (e.g. unit tests for llm-router alone).
async function archiveLLMArtifact({
  projectDir, content, agent, phase, model, backend,
  cost_usd, latency_ms, usage, run_id, node, kind, messages,
}) {
  // Build a stable run_id if the caller didn't supply one. This keeps every
  // artifact from this process under the same run, so collectRun() can group
  // them later. Uses a per-process cache to avoid drift across calls.
  if (!run_id) {
    if (!archiveLLMArtifact._fallbackRunId) {
      archiveLLMArtifact._fallbackRunId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    run_id = archiveLLMArtifact._fallbackRunId;
  }

  const { writeArtifact, isValidKind } = await import('../../cognitive-engine/artifacts/store.js')
    .then(m => ({ writeArtifact: m.writeArtifact, isValidKind: null }))
    .catch(async () => {
      // Fall back to types.js for kind validation, store.js for the writer.
      const storeMod = await import('../../cognitive-engine/artifacts/store.js');
      const typesMod = await import('../../cognitive-engine/artifacts/types.js');
      return { writeArtifact: storeMod.writeArtifact, isValidKind: typesMod.isValidKind };
    });

  // Use a valid kind. If the caller passed a non-canonical one, fall back
  // to 'raw_extraction' rather than blow up — fail-open discipline.
  const VALID_KINDS = new Set([
    'code_output', 'test_output', 'qa_report', 'triage_spec',
    'research_dossier', 'architect_review', 'deploy_status',
    'pmd_doc', 'raw_extraction',
  ]);
  const finalKind = VALID_KINDS.has(kind) ? kind : 'raw_extraction';

  await writeArtifact(projectDir, {
    kind: finalKind,
    content: typeof content === 'string' ? content : String(content ?? ''),
    produced_by: {
      run_id,
      agent: agent || 'unknown',
      model: model || 'unknown',
      backend: backend || null,
      node: node || null,
      phase: phase || null,
    },
    cost_usd,
    latency_ms,
    meta: {
      usage,
      messages: Array.isArray(messages)
        ? messages.map(m => ({ role: m.role, len: typeof m.content === 'string' ? m.content.length : 0 }))
        : null,
    },
  });
}

// Convert LangChain HumanMessage / SystemMessage / AIMessage / ToolMessage into
// the OpenAI {role, content} shape the router speaks. Falls through plain objects.
function toOpenAIMessage(m) {
  // Plain object passthrough.
  if (m && typeof m === 'object' && typeof m.role === 'string' && typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }

  // LangChain class instance — detect by constructor name OR by `_getType()`.
  const type = (typeof m._getType === 'function' && m._getType())
            ?? (m?.constructor?.name?.replace(/Message$/, '').toLowerCase());

  let role;
  switch (type) {
    case 'system':  case 'SystemMessage':  role = 'system';    break;
    case 'human':   case 'HumanMessage':   role = 'user';      break;
    case 'ai':      case 'AIMessage':      role = 'assistant'; break;
    case 'tool':    case 'ToolMessage':    role = 'tool';      break;
    default:
      throw new Error(`RouterChatModel: cannot map message type "${type}" to OpenAI shape`);
  }

  // .content can be string or array-of-content-blocks. Stringify blocks for now;
  // multi-modal pass-through lands when we need it (vision tasks aren't in the
  // current factory pipeline).
  const content = typeof m.content === 'string'
    ? m.content
    : Array.isArray(m.content)
      ? m.content.map(b => (typeof b === 'string' ? b : b.text ?? '')).join('')
      : String(m.content ?? '');

  return { role, content };
}
