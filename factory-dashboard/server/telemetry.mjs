import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.TELEMETRY_PORT) || 4401;
const clients = new Set();
let mockInterval = null;

// ─── Phase 21-A: Master Architect endpoints ──────────────────────────────
// The architect's Knowledge Base lives at <repo>/_kb/. Modules are loaded
// lazily (first request) so the dev-hub can boot even if architect/ is
// missing or broken.
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const ARCHITECT_KB_ROOT = REPO_ROOT;
const ARCHITECT_DIR = path.join(REPO_ROOT, 'cognitive-engine', 'architect');

let architectModules = null;
async function loadArchitect() {
  if (architectModules) return architectModules;
  const [kbMod, researcherMod, proposerMod, architectMod, schedulerMod, briefMod, llmDispMod] = await Promise.all([
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'kb.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'researcher.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'proposer.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'architect.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'scheduler.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'brief.js')).href),
    import(pathToFileURL(path.join(ARCHITECT_DIR, 'dispatchers', 'llm.js')).href).catch(() => null),
  ]);
  // Phase 15-A proposal store (architect emits proposals into it)
  const storeMod = await import(
    pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'self-improvement', 'store.js')).href
  );
  architectModules = {
    createKnowledgeBase: kbMod.createKnowledgeBase,
    createResearcher: researcherMod.createResearcher,
    createStubDispatcher: researcherMod.createStubDispatcher,
    createLLMDispatcher: llmDispMod?.createLLMDispatcher || null,
    createArchitectProposer: proposerMod.createArchitectProposer,
    createArchitect: architectMod.createArchitect,
    createProposalStore: storeMod.createProposalStore,
    createCadenceDaemon: schedulerMod.createCadenceDaemon,
    runBrief: briefMod.runBrief,
    composeBriefPrompt: briefMod.composeBriefPrompt,
  };
  return architectModules;
}

/**
 * Phase 21-B: pick the dispatcher for a pass based on the cadence/brief
 * config. Defaults to stub (= $0, synthetic findings — safe). Founder
 * must explicitly set `dispatcher: 'sonnet'` or `dispatcher: 'opus'` in
 * Standing Orders → cadences (or in a brief submission) to enable real
 * LLM research. Failure-mode is safe: if LLM dispatcher fails to load
 * (module missing, llm-router error), we fall back to stub silently.
 */
function pickDispatcher(A, dispatcherKey) {
  if (dispatcherKey === 'sonnet' || dispatcherKey === 'opus') {
    if (typeof A.createLLMDispatcher === 'function') {
      try {
        return A.createLLMDispatcher({ dispatcher: dispatcherKey });
      } catch (err) {
        console.warn(`[architect.dispatcher] LLM dispatcher init failed (${dispatcherKey}); falling back to stub:`, err?.message);
      }
    } else {
      console.warn(`[architect.dispatcher] requested '${dispatcherKey}' but createLLMDispatcher unavailable; using stub`);
    }
  }
  return A.createStubDispatcher();
}

// ─── Phase 14-B Tier B — factory queue worker boot ──────────────────────
// Runs alongside the architect cadence daemon. Polls the Phase 14-A
// queue (under <repo>/_jobs/) for jobs of kind pre_dev / dev / post_dev,
// leases them, dispatches via the registered handlers (each spawns the
// corresponding graph subprocess). Round-robin fairness across project_id
// shields multi-project queues from head-of-line blocking.
//
// `runSchedulerOnce({ drainOnly: false })` runs a long-lived worker loop
// that polls every 50ms when idle. We start it in the background and
// don't await — telemetry server stays responsive while jobs flow.
let queueWorkerStarted = false;
const QUEUE_WORKSPACE = '/home/subhash.thakur.india/Projects/agent-workspace';

// Phase 19-B HTTP surface — lazy-loaded shared customer portal instance.
// Constructed on first /api/customer-portal/* request (or first queue
// worker boot, whichever comes first) so the HTTP routes + the queue
// handler share the same instance (single source of truth for accounts +
// submissions + timeline).
let _customerPortalInstance = null;
async function getCustomerPortal() {
  if (_customerPortalInstance) return _customerPortalInstance;
  const portalMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'customer-portal', 'portal.js')).href);
  _customerPortalInstance = portalMod.createCustomerPortal({ rootDir: QUEUE_WORKSPACE });
  return _customerPortalInstance;
}

// Phase 19-B (D231) — lazy-loaded shared portal notifier instance.
// Constructed on first need (HTTP routes for /submit + /cancel; SLA
// scanner; future intake handler / back-feed wrapper wirings). Shares
// the same Courier instance across all callsites — single source of
// truth for outbound customer notifications.
// Fail-tolerant: if notifier module or Courier module is missing /
// crashes, returns null and callers no-op (notifications skipped, but
// the request itself succeeds — same fail-isolated posture as the
// scanner wiring).
// Opt-out: NOTIFIER_DISABLED=true (also honoured by bootSlaBreachScanner).
// Shared module-level Courier instance — single in-memory event history
// for the process. Both getPortalNotifier (writes via dispatch) and the
// admin /api/factory-admin/courier/* endpoints (reads via getHistory)
// reach the same instance. UI-D (Notifications panel) consumes the
// history for the live event feed.
let _sharedCourierInstance = null;
let _sharedCourierInitTried = false;
async function getSharedCourier() {
  if (_sharedCourierInstance) return _sharedCourierInstance;
  if (_sharedCourierInitTried) return null;
  _sharedCourierInitTried = true;
  try {
    const courierMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'courier', 'service.js')).href);
    _sharedCourierInstance = await courierMod.getCourier();
    return _sharedCourierInstance;
  } catch (err) {
    console.warn('[courier] init failed:', err?.message || err);
    return null;
  }
}

let _portalNotifierInstance = null;
let _portalNotifierInitTried = false;
async function getPortalNotifier() {
  if (_portalNotifierInstance) return _portalNotifierInstance;
  if (_portalNotifierInitTried) return null;  // tried + failed once → don't keep retrying per-request
  _portalNotifierInitTried = true;
  if (process.env.NOTIFIER_DISABLED === 'true') return null;
  try {
    const courier = await getSharedCourier();
    if (!courier) return null;
    const notifierMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'customer-portal', 'notifier.js')).href);
    _portalNotifierInstance = notifierMod.createPortalNotifier({
      courier,
      onLog: (line) => {
        try { addLog('system', `📨 [portal.notifier] ${line.substring(0, 220)}`); broadcast(); } catch {}
      },
    });
    return _portalNotifierInstance;
  } catch (err) {
    console.warn('[portal.notifier] init failed (continuing without notifications):', err?.message || err);
    return null;
  }
}

// Extract the bearer token from `Authorization: Bearer <token>` header.
function extractBearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Map portal error codes (UNAUTHORIZED / FORBIDDEN / QUOTA_EXCEEDED /
// VALIDATION / NOT_FOUND) to HTTP statuses + JSON body.
function portalErrorToHttp(res, err) {
  const code = err?.code || 'INTERNAL';
  const status = {
    UNAUTHORIZED:    401,
    FORBIDDEN:       403,
    NOT_FOUND:       404,
    QUOTA_EXCEEDED:  429,
    VALIDATION:      400,
  }[code] || 500;
  return jsonResponse(res, status, { error: err?.message || String(err), code });
}
async function bootQueueWorker() {
  if (queueWorkerStarted) return;
  queueWorkerStarted = true;
  try {
    const [
      queueMod, registryMod, schedulerMod, handlersMod, archHandlerMod,
      trainingGenHandlerMod, trainingGenStoreMod, trainingGenRegistryMod, trainingGenPipelineMod,
      videoHandlerMod, videoStoreMod, videoProviderRegistryMod, videoPipelineMod,
      intakeHandlerMod, customerPortalMod, backfeedWrapperMod,
    ] = await Promise.all([
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handler-registry.js')).href),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'scheduler.js')).href),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'factory-handlers.js')).href),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'architect-handler.js')).href),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'training-gen-handler.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-gen', 'store.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-gen', 'generators.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-gen', 'pipeline.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'training-video-handler.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-videos', 'store.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-videos', 'providers', 'registry.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'training-videos', 'pipeline.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'project-intake-handler.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'customer-portal', 'portal.js')).href).catch(() => null),
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'handlers', 'customer-backfeed-wrapper.js')).href).catch(() => null),
    ]);
    const queue = queueMod.createQueue(QUEUE_WORKSPACE);

    // Phase 14-B orphan reaper (D223) — on every telemetry boot, scan
    // _jobs/in-flight/ for jobs whose lease is older than LEASE_TIMEOUT_MS
    // (default 30 min). Stale ones are re-failed → existing fail()
    // machinery requeues or moves to failed/ based on max_attempts.
    // Fail-open: a reaper error must NEVER block worker boot.
    try {
      const reaperMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'orphan-reaper.js')).href);
      const reapResult = await reaperMod.reapOrphans({
        queue,
        logger: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
      });
      if (reapResult.scanned > 0 || reapResult.reaped > 0) {
        const summary = `🩹 Orphan reaper: scanned=${reapResult.scanned} reaped=${reapResult.reaped} (requeued=${reapResult.requeued_ids.length} failed=${reapResult.failed_ids.length}) kept=${reapResult.kept}${reapResult.errors.length ? ` errors=${reapResult.errors.length}` : ''}`;
        console.log(summary);
        if (reapResult.reaped > 0) {
          try { addLog('system', summary); broadcast(); } catch {}
        }
      }
    } catch (err) {
      console.warn('[queue.worker] orphan reaper failed (continuing):', err?.message || err);
    }

    const registry = registryMod.createHandlerRegistry();
    handlersMod.registerFactoryHandlers(registry, {
      onLog: (kind, line, jobId) => {
        // Pipe job output into the existing Live Trace SSE stream so
        // the Dev-Hub sidebar shows pipeline activity.
        try { addLog('system', `[queue:${kind}:${jobId}] ${line.substring(0, 180)}`); broadcast(); } catch {}
      },
    });

    // Shared customer portal instance — used by both the back-feed
    // wrapper (re-registers pre_dev below) and the project_intake
    // handler (later in this function). Filesystem-backed, so even if
    // two callers held separate instances they'd see consistent state;
    // sharing is just a small efficiency + a single hook for ops.
    // Fail-tolerant: if customer-portal module is unavailable, both the
    // wrapper and the intake handler skip registration silently.
    let sharedCustomerPortal = null;
    if (customerPortalMod) {
      try {
        sharedCustomerPortal = customerPortalMod.createCustomerPortal({ rootDir: QUEUE_WORKSPACE });
      } catch (err) {
        console.warn('[queue.worker] shared customer portal init failed:', err?.message || err);
      }
    }

    // Phase 19-B Tier B (D227) — wrap pre_dev so that after the existing
    // factory pre_dev handler completes successfully, if the job has
    // customer_id+submission_id (threaded through by project_intake),
    // the parent submission transitions in_progress → delivered. For
    // non-customer pre_dev jobs (regular factory pipeline), this is a
    // no-op passthrough. Wrapper is fail-isolated: a back-feed error
    // does NOT propagate to the queue, so the job is still marked done.
    if (backfeedWrapperMod && sharedCustomerPortal) {
      try {
        const originalPreDev = registry.get('pre_dev');
        if (typeof originalPreDev === 'function') {
          const wrappedPreDev = backfeedWrapperMod.wrapForCustomerBackfeed(originalPreDev, {
            portal: sharedCustomerPortal,
            onLog: (line, jobId) => {
              try { addLog('system', `[queue:pre_dev:backfeed:${jobId}] ${line.substring(0, 180)}`); broadcast(); } catch {}
            },
          });
          registry.register('pre_dev', wrappedPreDev);
        }
      } catch (err) {
        console.warn('[queue.worker] customer back-feed wrapper not installed:', err?.message || err);
      }
    }

    // Phase 21-B.2 — architect_research handler.
    try {
      const A = await loadArchitect();
      const archKb = A.createKnowledgeBase(ARCHITECT_KB_ROOT);
      const archProposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);
      archHandlerMod.registerArchitectResearchHandler(registry, {
        A,
        kb: archKb,
        proposalStore: archProposalStore,
        pickDispatcher,
        onReportProduced: (report) => {
          try {
            addLog('system', `👑 Architect cycle report ready (via queue): ${report.id} (${report.cadence})`);
            broadcast();
          } catch {}
        },
      });
    } catch (err) {
      console.warn('[queue.worker] architect_research handler not registered:', err?.message || err);
    }

    // Phase 16-B Tier B — training_gen handler.
    if (trainingGenHandlerMod && trainingGenStoreMod && trainingGenRegistryMod && trainingGenPipelineMod) {
      try {
        trainingGenHandlerMod.registerTrainingGenHandler(registry, {
          createTrainingStore: trainingGenStoreMod.createTrainingStore,
          createGeneratorRegistry: trainingGenRegistryMod.createGeneratorRegistry,
          runPipeline: trainingGenPipelineMod.runPipeline,
          defaultStoreRoot: path.join(QUEUE_WORKSPACE, '_training-store'),
          onLog: (line, jobId) => {
            try { addLog('system', `[queue:training_gen:${jobId}] ${line.substring(0, 180)}`); broadcast(); } catch {}
          },
        });
      } catch (err) {
        console.warn('[queue.worker] training_gen handler not registered:', err?.message || err);
      }
    }

    // Phase 17-B Tier B — training_video_render handler. Same pattern.
    // All-null provider defaults (substrate at $0); real ElevenLabs/
    // Puppeteer/ffmpeg become opt-in per-job via payload.providerChoice.
    if (videoHandlerMod && videoStoreMod && videoProviderRegistryMod && videoPipelineMod) {
      try {
        videoHandlerMod.registerTrainingVideoRenderHandler(registry, {
          createVideoStore: videoStoreMod.createVideoStore,
          createProviderRegistry: videoProviderRegistryMod.createProviderRegistry,
          renderFromPhase17Payload: videoPipelineMod.renderFromPhase17Payload,
          defaultStoreRoot: path.join(QUEUE_WORKSPACE, '_videos-store'),
          onLog: (line, jobId) => {
            try { addLog('system', `[queue:training_video_render:${jobId}] ${line.substring(0, 180)}`); broadcast(); } catch {}
          },
        });
      } catch (err) {
        console.warn('[queue.worker] training_video_render handler not registered:', err?.message || err);
      }
    }

    // Phase 19-B Tier B — project_intake handler. Customer portal
    // submissions enqueue this kind via the (to-be-built) HTTP submit
    // surface. Handler walks submission through submitted→accepted→
    // in_progress and enqueues a downstream pre_dev job. Fail-tolerant
    // import: customer-portal module is optional at boot.
    if (intakeHandlerMod && sharedCustomerPortal) {
      try {
        intakeHandlerMod.registerProjectIntakeHandler(registry, {
          portal: sharedCustomerPortal,
          queue,  // same queue instance so downstream pre_dev jobs land here
          onLog: (line, jobId) => {
            try { addLog('system', `[queue:project_intake:${jobId}] ${line.substring(0, 180)}`); broadcast(); } catch {}
          },
        });
      } catch (err) {
        console.warn('[queue.worker] project_intake handler not registered:', err?.message || err);
      }
    }

    // drainOnly: false → keeps the worker loop alive forever, polling.
    // parallelism: 2 → up to 2 concurrent graph spawns. Matches Phase
    // 14-A defaults; tunable via cadenceConfig if/when 14-B exposes it.
    schedulerMod.runSchedulerOnce({
      queue,
      registry,
      workspaceRoot: QUEUE_WORKSPACE,
      drainOnly: false,
      config: { parallelism: 2, policy: 'round_robin', poll_interval_ms: 1000 },
    }).catch(err => {
      console.error('[queue.worker] crashed:', err);
      queueWorkerStarted = false;
    });

    console.log(`📥 Queue worker started — kinds: ${registry.list().join(', ')} · workspace: ${QUEUE_WORKSPACE}`);
  } catch (err) {
    console.error('[queue.worker] boot failed:', err);
    queueWorkerStarted = false;
  }
}

// ─── Architect cadence daemon ─────────────────────────────────────────────
// Boots once on telemetry startup. Each tick reads Standing Orders and fires
// any cadence whose configured local time/day matches the current minute.
// Stays paused if baseline.paused === true. All persistence + dedupe goes
// through the KB.
let cadenceDaemonHandle = null;
async function bootCadenceDaemon() {
  if (cadenceDaemonHandle) return cadenceDaemonHandle;
  try {
    const A = await loadArchitect();
    const kb = A.createKnowledgeBase(ARCHITECT_KB_ROOT);
    const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);

    cadenceDaemonHandle = A.createCadenceDaemon({
      readStandingOrders: () => kb.readStandingOrders(),
      recordCadenceFire:  (k, p) => kb.recordCadenceFire(k, p),
      lastCadenceFire:    (k)    => kb.lastCadenceFire(k),
      runCadencePass: async (cadenceKind, cadenceConfig) => {
        // Phase 21-B.2 — when USE_ARCHITECT_QUEUE=true, the daemon
        // enqueues the cycle as an architect_research job instead of
        // running it inline.
        if (process.env.USE_ARCHITECT_QUEUE === 'true') {
          try {
            const queueMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href);
            const q = queueMod.createQueue(QUEUE_WORKSPACE);
            const job = await q.enqueue({
              kind: 'architect_research',
              project_id: 'architect',
              payload: { cadence_kind: cadenceKind, cadence_config: cadenceConfig },
              priority: 30,
              max_attempts: 1,
            });
            addLog('system', `📅 Architect cadence ${cadenceKind} enqueued as ${job.id} (queue mode)`);
            broadcast();
            return { pass: { id: `queued:${job.id}`, queued: true, completed_at: new Date().toISOString() } };
          } catch (err) {
            console.error(`[architect.daemon] enqueue failed for ${cadenceKind}, falling back to inline:`, err?.message || err);
          }
        }
        // For each cadence we run a fresh architect.runPass with the
        // cadence's own dispatcher + budget. The pass label IS the cadence
        // kind so listPasses({pass_kind:"weekly"}) groups cycle reports.
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        // Phase 21-B: pick dispatcher per cadence config. Defaults to stub.
        // Real LLM dispatch fires only when cadenceConfig.dispatcher === 'sonnet' | 'opus'.
        const researcher = A.createResearcher({
          dispatchSubagent: pickDispatcher(A, cadenceConfig.dispatcher || 'stub'),
          budget_usd_per_pass: cadenceConfig.budget_usd ?? 1.5,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });
        const result = await architect.runPass(cadenceKind, {
          cadence: cadenceKind,
          cadence_config: cadenceConfig,
        });

        // If the cadence has report_enabled, synthesize a Report artifact.
        // (For Phase 21-A the report shape is real; the content is synthetic
        // since dispatcher=stub. 21-B fills with real prose.)
        if (cadenceConfig.report_enabled) {
          const findings = await kb.listFindings({ pass_id: result.pass?.id, limit: 200 });
          const sections = [
            {
              heading: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle summary`,
              kind: "narrative",
              body: `Cadence \`${cadenceKind}\` ran at ${new Date(result.pass?.completed_at || Date.now()).toISOString()}. Produced ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} candidate proposals at $${(result.cost_usd ?? 0).toFixed(2)} cost. ${result.cost_usd === 0 ? '_(stub dispatcher — synthetic findings; Phase 21-B replaces with real Sonnet research.)_' : ''}`,
            },
          ];
          if (findings.length) {
            sections.push({
              heading: "Findings by priority area",
              kind: "list",
              body: findings.map(f => `- **[${f.priority_area || 'untagged'}]** ${f.content || '(no content)'}`).join("\n"),
            });
          }
          if (cadenceKind === "monthly") {
            sections.push({
              heading: "Criteria health check",
              kind: "criteria-health",
              body: `_(stub)_ Architect should review the priority-area set against shipped modules and propose adding/removing/renaming areas. Phase 21-B implements this with the real dispatcher.`,
            });
          }
          const report = await kb.writeReport({
            kind: "cycle",
            cadence: cadenceKind,
            pass_id: result.pass?.id,
            title: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle — ${new Date().toISOString().slice(0,10)}`,
            summary: `Architect ${cadenceKind} cycle: ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals.`,
            sections,
            linked_findings: findings.map(f => f.id),
            linked_proposals: [],
            cost_usd: result.cost_usd ?? 0,
          });
          return { pass: result.pass, report };
        }
        return { pass: result.pass };
      },
      onReportProduced: (report) => {
        try {
          addLog('system', `👑 Architect cycle report ready: ${report.id} (${report.cadence})`);
          broadcast();
        } catch {}
      },
      logger: { info: (m) => console.log(m), warn: (m) => console.warn(m) },
    });

    const info = await cadenceDaemonHandle.start();
    console.log(`📅 Architect cadence daemon started (first tick in ${info.alignedFirstTickInMs}ms, period ${info.tickMs}ms)`);
  } catch (err) {
    console.error('[architect.daemon] failed to boot:', err);
    cadenceDaemonHandle = null;
  }
  return cadenceDaemonHandle;
}

// ─── SLA breach scanner (D228) ────────────────────────────────────────────
// Periodic scan that emits sla_breached timeline events for non-terminal
// customer submissions that have passed target_delivery_at without being
// delivered/rejected/cancelled. Idempotent via timeline dedup.
let slaBreachScannerHandle = null;
async function bootSlaBreachScanner() {
  if (slaBreachScannerHandle) return slaBreachScannerHandle;
  if (process.env.SLA_SCANNER_DISABLED === 'true') {
    console.log('🛎️  SLA breach scanner disabled (SLA_SCANNER_DISABLED=true)');
    return null;
  }
  try {
    const [scannerMod] = await Promise.all([
      import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'customer-portal', 'sla-breach-scanner.js')).href),
    ]);
    const portal = await getCustomerPortal();
    const intervalMs = Number(process.env.SLA_SCANNER_INTERVAL_MS) || 5 * 60 * 1000;

    // D231 — use the shared module-level notifier (also used by HTTP
    // routes for /submit and /cancel). Single Courier instance + single
    // event-history surface. getPortalNotifier() returns null if the
    // module is missing or NOTIFIER_DISABLED=true, in which case the
    // scanner runs without notifications (timeline events still land).
    const notifier = await getPortalNotifier();
    if (notifier) console.log('📨 Portal notifier wired (shared instance) — scanner + HTTP routes will dispatch customer.* events');

    slaBreachScannerHandle = scannerMod.createSlaBreachScanner({
      portal,
      notifier,            // null if disabled or wiring failed — scanner treats as no-op
      intervalMs,
      onLog: (line) => {
        try { addLog('system', `🛎️  [sla.scanner] ${line.substring(0, 220)}`); broadcast(); } catch {}
      },
    });
    const info = slaBreachScannerHandle.start();
    console.log(`🛎️  SLA breach scanner started — interval=${info.intervalMs}ms${notifier ? ' (notifier=on)' : ' (notifier=off)'}`);
  } catch (err) {
    console.error('[sla.scanner] failed to boot:', err);
    slaBreachScannerHandle = null;
  }
  return slaBreachScannerHandle;
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// ─── Phase 12-B Tier B: flag-override persistence ────────────────────────
// The admin-substrate registry reads flags from process.env. To make UI
// toggles "live" without a restart, we maintain a small JSON override file
// at <repo>/_factory_runtime/flag_overrides.json. On telemetry startup we
// apply the persisted overrides into process.env. Subsequent reads (incl.
// the architect daemon, child-process spawns that inherit env) see the
// new values immediately.
const RUNTIME_DIR = path.join(REPO_ROOT, '_factory_runtime');
const FLAG_OVERRIDES_FILE = path.join(RUNTIME_DIR, 'flag_overrides.json');
// Phase 9-B substrate — append-only audit log of feedback webhook hits.
// Read by GET /api/factory-admin/verify/state (tail of the JSONL) so the
// Verify panel can show a "recent feedback" list alongside the bundle list.
const VERIFY_FEEDBACK_LOG = path.join(RUNTIME_DIR, 'verify_feedback.jsonl');

function loadFlagOverrides() {
  try { return JSON.parse(fs.readFileSync(FLAG_OVERRIDES_FILE, 'utf-8')); } catch { return {}; }
}
function saveFlagOverrides(overrides) {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = FLAG_OVERRIDES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n');
  fs.renameSync(tmp, FLAG_OVERRIDES_FILE);
}
function applyFlagOverrides() {
  const overrides = loadFlagOverrides();
  for (const [envVar, value] of Object.entries(overrides)) {
    if (value === 'on') process.env[envVar] = 'true';
    else if (value === 'off') process.env[envVar] = 'false';
  }
}
applyFlagOverrides(); // run once at module load

// Seeding Standing Orders from example: the architect ships a hand-edited
// `standing_orders.example.yaml` (schema source-of-truth, comments preserved
// for the human reader), and a sibling `standing_orders.example.json` (same
// content, JSON-shaped, for runtime). The seed endpoint copies the JSON
// version directly — no YAML parser needed.
const SEED_JSON_PATH = path.join(ARCHITECT_DIR, 'standing_orders.example.json');

// Merge incoming custom_direction onto existing, preserving fields the
// editor doesn't expose. priority_areas are merged by id (incoming
// overrides existing fields per area; missing areas inherit from existing).
function mergeCustomDirection(existing = {}, incoming = {}) {
  const out = { ...(existing || {}), ...(incoming || {}) };
  if (existing?.overall_stance || incoming?.overall_stance) {
    out.overall_stance = { ...(existing?.overall_stance || {}), ...(incoming?.overall_stance || {}) };
  }
  if (existing?.effective_period || incoming?.effective_period) {
    out.effective_period = { ...(existing?.effective_period || {}), ...(incoming?.effective_period || {}) };
  }
  // Merge priority_areas by id
  const incomingAreas = Array.isArray(incoming?.priority_areas) ? incoming.priority_areas : null;
  const existingAreas = Array.isArray(existing?.priority_areas) ? existing.priority_areas : [];
  if (incomingAreas) {
    const byId = new Map(existingAreas.map(a => [a.id, a]));
    for (const a of incomingAreas) {
      const prev = byId.get(a.id) || {};
      byId.set(a.id, { ...prev, ...a });
    }
    // Preserve the canonical order: models, agents, languages, tools, output_quality, operations
    const ORDER = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'];
    out.priority_areas = ORDER.map(id => byId.get(id)).filter(Boolean);
  }
  // strategic_watch and notes pass through (editor doesn't touch yet)
  return out;
}

function getInitialState() {
  return {
    agents: [
      { id: 'picard', name: 'Picard', role: 'Solutions Arch', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'jane', room: 0 },
      { id: 'sisko', name: 'Sisko', role: 'Project Planner', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'spock', room: 0 },
      { id: 'troi', name: 'Troi', role: 'Enhancement', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'data', room: 0 },
      { id: 'jane', name: 'Jane', role: 'PM / Triage', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'jane', room: 0 },
      { id: 'spock', name: 'Spock', role: 'Auto-Research', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'spock', room: 1 },
      { id: 'torres', name: 'Torres', role: 'Junior Dev', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'torres', room: 2 },
      { id: 'data', name: 'Data', role: 'Sr. Architect', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'data', room: 2 },
      { id: 'tuvok', name: 'Tuvok', role: 'QA Reviewer', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'tuvok', room: 3 },
      { id: 'crusher', name: 'Crusher', role: 'Docs & Training', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'spock', room: 5 },
      { id: 'obrien', name: "O'Brien", role: 'SRE / Deploy', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'obrien', room: 5 }
    ],
    logs: [],
    workItems: [],
    completedItems: [] // Modules successfully through the pipeline
  };
}

let currentState = getInitialState();

function broadcast() {
  const data = `data: ${JSON.stringify(currentState)}\n\n`;
  for (const client of clients) client.write(data);
}

function addLog(agentId, message) {
  currentState.logs.unshift({
    time: new Date().toLocaleTimeString('en-US', {timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'}),
    agent: agentId || 'system',
    agentLabel: currentState.agents.find(a => a.id === agentId)?.name || 'System',
    message: message
  });
  if (currentState.logs.length > 50) currentState.logs.pop();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runSimulationLoop() {
  if (mockInterval) return;
  currentState = getInitialState();
  mockInterval = true;
  
  const t1 = { id: 'PR-101', name: 'UI Update', color: '#60a5fa' };
  const t2 = { id: 'BUG-40', name: 'Auth Fix', color: '#fb923c' };
  const t3 = { id: 'FEAT-9', name: 'Payments', color: '#c084fc' };
  
  const flow = [
    // Step 1: T1 enters Backlog
    async () => {
      currentState.workItems.push({ ...t1, room: 0 }); // Backlog
      currentState.agents.find(a=>a.id==='jane').status = 'working';
      addLog('jane', `Ingesting ${t1.id} into Backlog.`);
    },
    // Step 2: T1 to Build, T2 enters Backlog
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 2; // Build
      currentState.workItems.push({ ...t2, room: 0 });
      currentState.agents.find(a=>a.id==='torres').room = 2;
      currentState.agents.find(a=>a.id==='torres').status = 'working';
      addLog('torres', `Started dev on ${t1.id}.`);
      addLog('jane', `Triaging new ticket ${t2.id}.`);
    },
    // Step 3: T1 to QA, T2 to Build, T3 enters Backlog
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 3; // QA
      currentState.workItems.find(w=>w.id===t2.id).room = 2; // Build
      currentState.workItems.push({ ...t3, room: 0 });
      currentState.agents.find(a=>a.id==='jane').status = 'idle';
      currentState.agents.find(a=>a.id==='tuvok').status = 'working';
      currentState.agents.find(a=>a.id==='data').room = 2;
      currentState.agents.find(a=>a.id==='data').status = 'working';
      addLog('tuvok', `Testing ${t1.id} logic.`);
      addLog('data', `Jumping in to build ${t2.id}.`);
    },
    // Step 4: T1 to Review, T2 to QA, T3 to Build
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 4; // Review
      currentState.workItems.find(w=>w.id===t2.id).room = 3; // QA
      currentState.workItems.find(w=>w.id===t3.id).room = 2; // Build
      currentState.agents.find(a=>a.id==='data').room = 4; // Data reviews
      addLog('data', `Reviewing ${t1.id} PR.`);
      addLog('tuvok', `Testing ${t2.id} edge cases.`);
      addLog('torres', `Starting ${t3.id} architecture.`);
    },
    // Step 5: T1 to Ship, T2 to Review, T3 to QA
    async () => {
      currentState.workItems.find(w=>w.id===t1.id).room = 5; // Ship
      currentState.workItems.find(w=>w.id===t2.id).room = 4; // Review
      currentState.workItems.find(w=>w.id===t3.id).room = 3; // QA
      currentState.agents.find(a=>a.id==='obrien').status = 'working';
      currentState.agents.find(a=>a.id==='jane').room = 4; // PM reviews
      currentState.agents.find(a=>a.id==='jane').status = 'working';
      addLog('obrien', `Deploying ${t1.id} to production.`);
      addLog('jane', `Reviewing rushed ${t2.id}...`);
      addLog('tuvok', `QA passed for ${t3.id}...`);
    },
    // Step 6: T1 done, T2 to Ship, T3 to Review
    async () => {
      currentState.workItems = currentState.workItems.filter(w=>w.id!==t1.id);
      currentState.completedItems.unshift({ ...t1, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.workItems.find(w=>w.id===t2.id).room = 5;
      currentState.workItems.find(w=>w.id===t3.id).room = 4;
      currentState.agents.find(a=>a.id==='data').room = 4; // Data reviews t3
      addLog('obrien', `Deploying ${t2.id} to production.`);
      addLog('system', `${t1.id} successfully shipped!`);
    },
    // Step 7: T2 done, T3 to Ship
    async () => {
      currentState.workItems = currentState.workItems.filter(w=>w.id!==t2.id);
      currentState.completedItems.unshift({ ...t2, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.workItems.find(w=>w.id===t3.id).room = 5;
      currentState.agents.find(a=>a.id==='data').status = 'idle';
      currentState.agents.find(a=>a.id==='jane').status = 'idle';
      currentState.agents.find(a=>a.id==='tuvok').status = 'idle';
      currentState.agents.find(a=>a.id==='torres').status = 'idle';
      addLog('obrien', `Deploying ${t3.id} to production.`);
    },
    // Step 8: Complete
    async () => {
      currentState.workItems = [];
      currentState.completedItems.unshift({ ...t3, status: 'Live', time: new Date().toLocaleTimeString() });
      currentState.agents.forEach(a => a.status = 'idle');
      addLog('system', `All batches deployed. Pipeline clear.`);
    }
  ];

  for (const step of flow) {
    await step();
    broadcast();
    await sleep(4000);
  }

  mockInterval = null;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  if (req.url === '/api/telemetry/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Trigger Mock Pipeline
  if (req.url === '/api/telemetry/simulate' && req.method === 'POST') {
    runSimulationLoop(); // async background loop
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Simulation Pipeline Started' }));
    return;
  }

  // 🧠 REAL FACTORY: Pre-Dev Scope Ingestion
  if (req.url === '/api/factory/pre-dev' && req.method === 'POST') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', async () => {
      try {
        const payloadStr = Buffer.concat(body).toString('utf-8');
        const payload = JSON.parse(payloadStr);
        let finalTask = payload.task || '';

        if (payload.projectName && payload.projectName.trim() !== '') {
          finalTask = `PROJECT_NAME: ${payload.projectName.trim()}\n\n` + finalTask;
        }

        // Phase 4 — feature-flagged alternative path: spawn pre_dev_graph.js
        // (real LLM pipeline incl. Genovi intake) instead of the inline
        // template substitution below. Default off; flip PRE_DEV_USE_GRAPH=true
        // in env (or systemd unit) when OpenRouter credit is sufficient for
        // a full pipeline run (~\$0.50-\$2.00 per invocation).
        if (process.env.PRE_DEV_USE_GRAPH === 'true') {
          addLog('system', `🖖 Pre-Dev Pipeline engaged via cognitive-engine graph (real LLM)`);
          broadcast();
          const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/pre_dev_graph.js', finalTask], {
            cwd: '/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env },
          });
          child.stdout.on('data', (data) => {
            const line = data.toString().trim();
            if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
          });
          child.stderr.on('data', (data) => {
            const line = data.toString().trim();
            if (line && !line.includes('ExperimentalWarning')) {
              addLog('system', `⚠️ ${line.substring(0, 120)}`);
              broadcast();
            }
          });
          child.on('close', (code) => {
            addLog('system', code === 0 ? '✅ Pre-Dev graph complete (real docs via LLM).' : `❌ Pre-Dev graph exited with code ${code}`);
            broadcast();
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Pre-Dev pipeline engaged via cognitive-engine graph', mode: 'graph' }));
          return;
        }
        // Default path (template substitution) continues below — preserved for
        // credit-constrained operation and instant UI feedback during demos.

        if (payload.files && payload.files.length > 0) {
          addLog('system', `📥 Received ${payload.files.length} supplementary documents. Parsing...`);
          broadcast();
          finalTask += '\n\n--- INGESTED DOCUMENTATION ---\n';
          
          for (const file of payload.files) {
            if (!file.data) continue;
            try {
               const buf = Buffer.from(file.data, 'base64');
               let text = '';
               if (file.name.toLowerCase().endsWith('.pdf')) {
                 const pdfParse = (await import('pdf-parse')).default;
                 const data = await pdfParse(buf);
                 text = data.text;
               } else if (file.name.toLowerCase().endsWith('.docx')) {
                 const mammoth = (await import('mammoth')).default;
                 const data = await mammoth.extractRawText({buffer: buf});
                 text = data.value;
               } else {
                 text = buf.toString('utf-8');
               }
               finalTask += `\n[File: ${file.name}]\n${text}\n`; 
               addLog('system', `📄 Parsed ${file.name} successfully.`);
            } catch(e) { 
               console.error('Parse error:', e); 
               addLog('system', `⚠️ Error parsing ${file.name}: ${e.message}. Using raw text fallback.`);
               // Fallback: try raw text extraction
               try { 
                 const fallbackText = buf.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
                 if (fallbackText.length > 50) {
                   finalTask += `\n[File: ${file.name} (raw)]\n${fallbackText}\n`;
                   addLog('system', `📄 ${file.name} loaded via raw text fallback.`);
                 }
               } catch(e2) { /* truly unrecoverable */ }
            }
          }
        }
        
        if (!finalTask) { res.writeHead(400); res.end(JSON.stringify({ error: 'No task provided' })); return; }
        
        // Write FRS to temp file
        const taskFile = `/tmp/factory_run_${Date.now()}.txt`;
        fs.writeFileSync(taskFile, finalTask);
        
        let displayTask = payload.task || 'Document Upload';
        addLog('system', `🖖 Pre-Dev Pipeline engaged! Scope: "${displayTask.substring(0, 80)}"`);
        broadcast();

        // Determine project directory
        const datePrefix = new Date().toISOString().split('T')[0];
        const projNameRaw = payload.projectName || 'ingested-documentation';
        const safeName = projNameRaw.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        const projDirName = `${datePrefix}_${safeName}`;
        const base = path.join('/home/subhash.thakur.india/Projects/agent-workspace', projDirName);
        const pmdDir = path.join(base, 'PMD');
        const docsDir = path.join(base, 'docs');
        fs.mkdirSync(pmdDir, { recursive: true });
        fs.mkdirSync(docsDir, { recursive: true });
        fs.mkdirSync(path.join(base, 'src'), { recursive: true });
        fs.mkdirSync(path.join(base, 'tests'), { recursive: true });

        // Generate docs directly using templates + FRS content
        const templateBase = '/home/subhash.thakur.india/Projects/PMD/Agentryx Dev Plan';
        const projectLabel = safeName.replace(/-/g, ' ');
        const frsSnippet = finalTask.substring(0, 2000);

        const loadTemplate = (section, prefix) => {
          try {
            const tplPath = path.join(templateBase, section);
            const files = fs.readdirSync(tplPath);
            const tpl = files.find(f => f.startsWith(prefix));
            if (tpl) {
              let content = fs.readFileSync(path.join(tplPath, tpl), 'utf-8');
              content = content.replace(/\{Project Name\}/gi, projectLabel);
              content = content.replace(/\{Date\}/gi, datePrefix);
              content = content.replace(/\[Insert.*?\]/gi, frsSnippet.substring(0, 500));
              return content;
            }
          } catch(_) {}
          return null;
        };

        addLog('system', '📋 Picard analyzing source document...'); broadcast();

        // A-series (7 docs)
        const aSeries = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
        for (const id of aSeries) {
          let content = loadTemplate('A.Solution Scope', id);
          if (!content) {
            content = `# ${id}: Document — ${projectLabel}\n\n> Generated: ${datePrefix}\n\n## FRS Source\n\`\`\`\n${frsSnippet}\n\`\`\`\n`;
          }
          content += `\n\n---\n## Source FRS Extract\n\`\`\`\n${frsSnippet}\n\`\`\`\n`;
          fs.writeFileSync(path.join(pmdDir, `${id}_${id === 'A0' ? 'Source_Analysis' : id === 'A1' ? 'Solution_Brief' : id === 'A2' ? 'Solution_Architecture' : id === 'A3' ? 'Module_Breakdown' : id === 'A4' ? 'Dev_Plan_Phasing' : id === 'A5' ? 'PRD_Phase1' : 'Acceptance_Criteria'}.md`), content);
          addLog('system', `📄 ${id} generated`); broadcast();
        }

        addLog('system', '🔮 Troi injecting 110% enhancements...'); broadcast();

        // B-series (3 docs: B4, B6, B8)
        for (const id of ['B4', 'B6', 'B8']) {
          let content = loadTemplate('B.Agentryx Edge', id);
          if (!content) {
            content = `# ${id}: Document — ${projectLabel}\n\n> Generated: ${datePrefix}\n`;
          }
          fs.writeFileSync(path.join(docsDir, `${id}_${id === 'B4' ? 'AI_Enhancement_Report' : id === 'B6' ? 'Quick_Wins_110' : 'Infrastructure_Plan'}.md`), content);
          addLog('system', `📄 ${id} generated`); broadcast();
        }

        addLog('system', '🖖 Picard drafting executive summary...'); broadcast();

        // P0 Executive Summary
        let p0Content = loadTemplate('P.Project Management', 'P0');
        if (!p0Content) p0Content = `# P0: Executive Summary — ${projectLabel}\n\n> Generated: ${datePrefix}\n`;
        fs.writeFileSync(path.join(docsDir, 'P0_Executive_Summary.md'), p0Content);
        addLog('system', '📄 P0 generated'); broadcast();

        // AGENT_STATE
        fs.writeFileSync(path.join(base, 'AGENT_STATE.md'), `# AGENT_STATE — ${projectLabel}\n\n## IDENTITY\n\`\`\`yaml\nproject_name: "${projectLabel}"\nworkspace: "${projDirName}"\ncreated: "${datePrefix}"\n\`\`\`\n\n## CURRENT STATE\n\`\`\`yaml\nstatus: "Pre-Dev Complete"\noverall_completion: "15%"\ncurrent_phase: 0\nphases_total: 3\n\`\`\`\n\n## COMPLETED\n\`\`\`yaml\ndocuments: [A0, A1, A2, A3, A4, A5, A6, B4, B6, B8, P0, AGENT_STATE]\n\`\`\`\n\n## FRS SOURCE\n\`\`\`\n${frsSnippet}\n\`\`\`\n`);
        addLog('system', '📄 AGENT_STATE initialized'); broadcast();

        addLog('system', `✅ Pre-Dev complete! 12 documents generated in ${projDirName}`);
        broadcast();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Pre-Dev pipeline complete', project: projDirName }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 🧠 REAL FACTORY: Dev Pipeline (Jane to O'Brien)
  if (req.url === '/api/factory/dev' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project } = JSON.parse(body);
        if (!project) { res.writeHead(400); res.end(JSON.stringify({ error: 'No project provided' })); return; }
        
        // Spawn dev_graph.js with the project name
        const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/dev_graph.js', project], {
          cwd: '/home/subhash.thakur.india/Projects/cognitive-engine',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env }
        });
        
        addLog('system', `🏭 Dev floor engaged! Project: "${project}"`);
        broadcast();
        
        child.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
        });
        child.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (line && !line.includes('ExperimentalWarning')) {
            addLog('system', `⚠️ ${line.substring(0, 120)}`);
            broadcast();
          }
        });
        child.on('close', (code) => {
          addLog('system', code === 0 ? '✅ Dev complete. App deployed.' : `❌ Dev exited with code ${code}`);
          broadcast();
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Dev pipeline spawned' }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Save Config from UI
  // 🚀 POST-DEV: Ship & Deliver Pipeline (Crusher + Jane + O'Brien)
  if (req.url === '/api/factory/post-dev' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project } = JSON.parse(body);
        if (!project) { res.writeHead(400); res.end(JSON.stringify({ error: 'No project provided' })); return; }
        
        const child = spawn('node', ['/home/subhash.thakur.india/Projects/agentryx-factory/cognitive-engine/post_dev_graph.js', project], {
          cwd: '/home/subhash.thakur.india/Projects/cognitive-engine',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env }
        });
        
        addLog('system', `🚀 Post-Dev pipeline engaged! Project: "${project}"`);
        broadcast();
        
        child.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line) { addLog('system', line.substring(0, 120)); broadcast(); }
        });
        child.stderr.on('data', (data) => {
          const line = data.toString().trim();
          if (line && !line.includes('ExperimentalWarning')) {
            addLog('system', `⚠️ ${line.substring(0, 120)}`);
            broadcast();
          }
        });
        child.on('close', (code) => {
          addLog('system', code === 0 ? '🎉 Post-Dev complete. Project SHIPPED.' : `❌ Post-Dev exited with code ${code}`);
          broadcast();
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Post-Dev pipeline spawned' }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Save Config from UI
  if (req.url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        let envContent = '';
        if (config.github) envContent += `GITHUB_PAT=${config.github}\n`;
        if (config.perplexity) envContent += `PERPLEXITY_API_KEY=${config.perplexity}\n`;
        if (config.whatsappWebhook) envContent += `WHATSAPP_WEBHOOK=${config.whatsappWebhook}\n`;
        
        fs.writeFileSync(path.join(process.cwd(), '.env.factory'), envContent);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Test Connectivity API
  if (req.url === '/api/test-connection' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const config = JSON.parse(body);
        let githubStatus = 'untested';
        let perplexityStatus = 'untested';

        if (config.github) {
          try {
            const ghRes = await fetch('https://api.github.com/user', {
              headers: { 'Authorization': `token ${config.github}`, 'User-Agent': 'Agentryx-Factory' }
            });
            githubStatus = ghRes.ok ? 'success' : 'error';
          } catch(e) { githubStatus = 'error'; }
        }

        if (config.perplexity) {
          try {
            const pRes = await fetch('https://api.perplexity.ai/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${config.perplexity}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'sonar', messages: [{role: 'user', content: 'test'}] })
            });
            perplexityStatus = pRes.ok ? 'success' : 'error';
          } catch(e) { perplexityStatus = 'error'; }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ github: githubStatus, perplexity: perplexityStatus }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Remote agent states + workItem management
  if (req.url === '/api/telemetry/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        
        // Agent state updates
        if (update.agentId) {
            const agent = currentState.agents.find(a => a.id === update.agentId);
            if (agent) {
                if (update.room !== undefined) agent.room = update.room;
                if (update.status !== undefined) agent.status = update.status;
            }
        }
        
        // WorkItem lifecycle
        if (update.workItem) {
          const wi = update.workItem;
          if (wi.action === 'create') {
            currentState.workItems.push({ id: wi.id, name: wi.name, room: wi.room || 0, color: wi.color || '#60a5fa' });
          } else if (wi.action === 'move') {
            const item = currentState.workItems.find(w => w.id === wi.id);
            if (item) item.room = wi.room;
          } else if (wi.action === 'complete') {
            currentState.workItems = currentState.workItems.filter(w => w.id !== wi.id);
            currentState.completedItems.unshift({ id: wi.id, name: wi.name, color: wi.color || '#60a5fa', status: 'Live', time: new Date().toLocaleTimeString() });
          }
        }
        
        if (update.log) addLog(update.agentId, update.log);
        broadcast();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // Template count — reads the Agentryx Dev Plan directory for doc counts
  if (req.url === '/api/workspace/template-count' && req.method === 'GET') {
    try {
      const pmdBase = '/home/subhash.thakur.india/Projects/PMD/Agentryx Dev Plan';
      const countDir = (dir) => { try { return fs.readdirSync(path.join(pmdBase, dir)).filter(f => f.endsWith('.md') || f.endsWith('.json')).length; } catch(_) { return 0; } };
      const a = countDir('A.Solution Scope');
      const b = countDir('B.Agentryx Edge');
      const c = countDir('C.Project Delivery');
      const p = countDir('P.Project Management');
      const hasState = (() => { try { fs.accessSync(path.join(pmdBase, 'AGENT_STATE_TEMPLATE.md')); return 1; } catch(_) { return 0; } })();
      // Pre-Dev generates: A0-A6 (7) + B4,B6 (2) + B8 (1) + P0 (1) + AGENT_STATE (1) = 12
      const preDev = a + 2 + 1 + 1 + hasState; // A-series + Troi(B4,B6) + O'Brien(B8) + Picard(P0) + Jane(AGENT_STATE)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: preDev, total: a + b + c + p + hasState, preDev, a, b, c, p }));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: 12 })); // fallback
    }
    return;
  }

  // List all projects in workspace
  if (req.url === '/api/workspace/projects' && req.method === 'GET') {
    const agentWs = '/home/subhash.thakur.india/Projects/agent-workspace';
    try {
      const entries = fs.readdirSync(agentWs, { withFileTypes: true });
      const projects = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
          const projPath = path.join(agentWs, e.name);
          const stat = fs.statSync(projPath);
          const reportPath = path.join(projPath, 'B7_Factory_Report.json');
          let report = null;
          try { report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch(_) {}
          let completion = '0%';
          try {
            const stateContent = fs.readFileSync(path.join(projPath, 'AGENT_STATE.md'), 'utf-8');
            const match = stateContent.match(/overall_completion:\s*"?([^"\n]+)"?/);
            if (match) completion = match[1];
          } catch(_) {}
          // Count files recursively
          function countFiles(dir) {
            let count = 0;
            try {
              const items = fs.readdirSync(dir, { withFileTypes: true });
              for (const item of items) {
                if (item.name.startsWith('.') || item.name === 'node_modules') continue;
                if (item.isFile()) count++;
                else count += countFiles(path.join(dir, item.name));
              }
            } catch(_) {}
            return count;
          }
          return {
            name: e.name,
            created: stat.birthtime,
            modified: stat.mtime,
            fileCount: countFiles(projPath),
            status: report ? (report.qaVerdict || 'unknown') : (countFiles(projPath) < 3 ? 'generating-scope' : 'ready-for-dev'),
            hasReport: !!report,
            completion: completion
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ projects: [] }));
    }
    return;
  }

  // Delete a specific project
  const deleteMatch = req.url?.match(/^\/api\/workspace\/delete\?project=(.+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const project = decodeURIComponent(deleteMatch[1]);
    const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project);
    try {
      fs.rmSync(projPath, { recursive: true, force: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // List files within a specific project (recursive tree)
  const filesMatch = req.url?.match(/^\/api\/workspace\/files\?project=(.+)$/);
  if (filesMatch && req.method === 'GET') {
    const project = decodeURIComponent(filesMatch[1]);
    const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project);
    try {
      function buildTree(dir, prefix = '') {
        const items = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          const relPath = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) {
            items.push({ name: e.name, path: relPath, type: 'dir', children: buildTree(path.join(dir, e.name), relPath) });
          } else {
            const stat = fs.statSync(path.join(dir, e.name));
            items.push({ name: e.name, path: relPath, type: 'file', size: stat.size });
          }
        }
        return items;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ project, tree: buildTree(projPath) }));
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ project, tree: [] }));
    }
    return;
  }

  // Read a specific file from a project
  if (req.url?.startsWith('/api/workspace/read?') && req.method === 'GET') {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const project = params.get('project');
    const file = params.get('file');
    if (!project || !file) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing project or file' })); return; }
    const filePath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file, content }));
    } catch (err) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'File not found' }));
    }
    return;
  }

  // Run a file or npm command within a project
  if (req.url === '/api/workspace/run' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { project, command, background } = JSON.parse(body);
        const projPath = path.join('/home/subhash.thakur.india/Projects/agent-workspace', project || '');
        const cmd = command || 'npm start';
        
        if (background) {
            // Kill any previously running preview process on 8888
            try { execSync('lsof -ti:8888 | xargs kill -9 2>/dev/null || true'); } catch(e){}
            const bgChild = spawn('bash', ['-c', `PORT=8888 ${cmd}`], { cwd: projPath, detached: true, stdio: 'ignore' });
            bgChild.unref();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Preview server started on background port 8888', url: '/preview/' }));
            return;
        }

        const child = spawn('bash', ['-c', cmd], { cwd: projPath, timeout: 15000 });
        let output = '';
        child.stdout.on('data', d => output += d.toString());
        child.stderr.on('data', d => output += d.toString());
        child.on('close', (code) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ exitCode: code, output }));
        });
      } catch (err) {
        res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
      }
    }); return;
  }

  // ─── Phase 12-B Tier B (Admin) — flags / configs / audit / modules / queue / cost ─────
  // All routes namespaced /api/factory-admin/* (frontend hits via /telemetry/factory-admin/*).
  // Distinct from the existing /admin/api/* on port 4402 (the Phase 2.5 Key Console),
  // distinct from the architect routes. Read-only for v1 except flag toggles.

  if (req.url === '/api/factory-admin/flags' && req.method === 'GET') {
    (async () => {
      try {
        const { snapshotAllFlags } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'feature-flags.js')).href);
        applyFlagOverrides(); // ensure process.env reflects persisted overrides
        const snap = snapshotAllFlags();
        const overrides = loadFlagOverrides();
        // augment with override-source metadata so the UI can show "set via UI" vs "default"
        return jsonResponse(res, 200, {
          flags: snap.map(s => ({ ...s, override_source: overrides[s.flag.env_var] ? 'ui' : null })),
          overrides_path: FLAG_OVERRIDES_FILE,
        });
      } catch (err) {
        console.error('[factory-admin/flags GET]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.match(/^\/api\/factory-admin\/flags\/([^/]+)\/toggle$/) && req.method === 'POST') {
    (async () => {
      try {
        const envVar = req.url.match(/^\/api\/factory-admin\/flags\/([^/]+)\/toggle$/)[1];
        const body = await readRequestBody(req);
        const targetState = body.to === 'on' ? 'on' : body.to === 'off' ? 'off' : null;
        if (!targetState) return jsonResponse(res, 400, { error: 'body.to must be "on" or "off"' });

        const { isKnownFlag, readFlag } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'feature-flags.js')).href);
        if (!isKnownFlag(envVar)) return jsonResponse(res, 404, { error: `unknown flag: ${envVar}` });

        // Persist override + apply to running process
        const overrides = loadFlagOverrides();
        overrides[envVar] = targetState;
        saveFlagOverrides(overrides);
        process.env[envVar] = targetState === 'on' ? 'true' : 'false';

        // Best-effort audit (lib append; non-blocking)
        try {
          const { appendAudit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'audit.js')).href);
          await appendAudit({
            actor: body.actor || 'founder',
            action: 'flag.toggle',
            target: envVar,
            details: { to: targetState, prior: readFlag(envVar) },
          });
        } catch {}

        addLog('system', `🚦 Flag ${envVar} → ${targetState}`);
        broadcast();
        return jsonResponse(res, 200, { env_var: envVar, effective: targetState, persisted: true });
      } catch (err) {
        console.error('[factory-admin/flags toggle]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/configs' && req.method === 'GET') {
    (async () => {
      try {
        const { CONFIG_ENTRIES } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'registry.js')).href);
        const { readConfig, snapshotConfig } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'config-store.js')).href);
        const out = [];
        for (const entry of CONFIG_ENTRIES) {
          let value = null;
          let snapshot = null;
          try {
            const r = await readConfig(entry.id);
            value = r.value;
          } catch {}
          try { snapshot = await snapshotConfig(entry.id); } catch {}
          // For sensitive configs, redact value from the wire (UI shows
          // metadata only). Founder can still edit through a write-only
          // form when 12-B-full role-gated edits land for those.
          if (entry.sensitive) value = { _redacted: 'sensitive — edit via separate flow' };
          out.push({ entry, value, snapshot });
        }
        return jsonResponse(res, 200, { configs: out });
      } catch (err) {
        console.error('[factory-admin/configs]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // Phase 12-B-full — write a config (role-gated, JSON-validated, atomic, audited).
  // Body: { value: <new full JSON>, actor_role?: 'super_admin' (default), actor?: 'founder' }
  // Storage stays file-based for v0.0.1 (Postgres deferred to v3 when multi-tenant
  // matters). The cognitive-engine writeConfig() does atomic temp-file + rename and
  // schema_version checks; we layer role-gating + audit on top.
  if (req.url?.match(/^\/api\/factory-admin\/configs\/([^/]+)$/) && req.method === 'POST') {
    (async () => {
      try {
        const id = req.url.match(/^\/api\/factory-admin\/configs\/([^/]+)$/)[1];
        const body = await readRequestBody(req);
        const newValue = body.value;
        if (newValue === undefined) return jsonResponse(res, 400, { error: 'body.value required' });

        const { getConfigEntry, canRoleEdit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'registry.js')).href);
        const entry = getConfigEntry(id);
        if (!entry) return jsonResponse(res, 404, { error: `unknown config: ${id}` });

        // For v0.0.1 single-founder mode, the implicit caller role is super_admin.
        // When real auth lands, this comes from the session.
        const actorRole = body.actor_role || 'super_admin';
        if (!canRoleEdit(actorRole, entry)) {
          return jsonResponse(res, 403, { error: `role ${actorRole} cannot edit ${id} (requires ${entry.min_role_edit})` });
        }

        // Capture pre-write snapshot for audit (not the full content — just metadata)
        const { snapshotConfig, writeConfig } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'config-store.js')).href);
        let prior = null;
        try { prior = await snapshotConfig(id); } catch {}

        const writeResult = await writeConfig(id, newValue);

        // Append audit. Do NOT log the full value — configs may contain
        // secret references (provider keys, MCP URLs). Log the metadata only.
        try {
          const { appendAudit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'audit.js')).href);
          await appendAudit({
            actor: body.actor || 'founder',
            action: 'config.write',
            target: id,
            details: {
              role: actorRole,
              new_bytes: writeResult.bytes,
              new_sha256: writeResult.sha256,
              prior_sha256: prior?.sha256 || null,
            },
          });
        } catch {}

        addLog('system', `⚙️ Config ${id} updated (${writeResult.bytes} bytes)`);
        broadcast();
        return jsonResponse(res, 200, { id, ok: true, bytes: writeResult.bytes, sha256: writeResult.sha256 });
      } catch (err) {
        console.error('[factory-admin/configs POST]', err);
        return jsonResponse(res, 400, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 9-A surface — Verify Integration (read-only) ──────────────
  // Surfaces enabled state + client kind + REVIEW_DECISIONS enum + most-
  // recent inspectable mock-bundle store. Real HTTP cycle (Verify-stg auth
  // + multi-app mode) is full 9-B.
  if (req.url === '/api/factory-admin/verify/state' && req.method === 'GET') {
    (async () => {
      try {
        const [{ getVerifyClient, isEnabled: verifyEnabled }, { REVIEW_DECISIONS }] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'verify-integration', 'client.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'verify-integration', 'types.js')).href),
        ]);
        const client = getVerifyClient();
        const recent_bundles = typeof client._inspectStore === 'function' ? client._inspectStore() : [];
        // Phase 9-B substrate — tail the feedback log (append-only JSONL).
        let recent_feedback = [];
        try {
          const raw = fs.readFileSync(VERIFY_FEEDBACK_LOG, 'utf-8');
          recent_feedback = raw.split('\n').filter(Boolean).slice(-20).map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean).reverse();
        } catch { /* file may not exist yet — fine, empty list */ }
        return jsonResponse(res, 200, {
          enabled: verifyEnabled(),
          flag_required: 'USE_VERIFY_INTEGRATION',
          client_kind: client.kind,
          verify_url: process.env.VERIFY_URL || null,
          webhook_url: `${process.env.PUBLIC_TELEMETRY_BASE || ''}/api/factory-admin/verify/webhook`,
          review_decisions: [...REVIEW_DECISIONS],
          recent_bundles: recent_bundles.slice(-20).map(b => ({
            build_id: b.build_id,
            project_id: b.project_id,
            received_at: b.received_at,
            seq: b.seq,
          })),
          recent_feedback,
          note: client.kind === 'mock'
            ? 'Mock client active — bundles publish to an in-memory store (resets on telemetry restart). Real Verify portal requires VERIFY_URL + auth_token (Phase 9-B). Webhook is live: POST to /api/factory-admin/verify/webhook with a FeedbackPayload.'
            : 'HTTP client active. Webhook live at /api/factory-admin/verify/webhook.',
        });
      } catch (err) {
        console.error('[factory-admin/verify/state]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 9-B substrate — Verify portal feedback webhook ───────────
  // POST body: FeedbackPayload + optional project_id. HMAC-verified
  // when VERIFY_WEBHOOK_SECRET is set; dev-bypass when unset (warn).
  // Writes user_note observation + plans FixRoute + appends JSONL.
  if (req.url === '/api/factory-admin/verify/webhook' && req.method === 'POST') {
    (async () => {
      try {
        // Phase 9-B HMAC verification (D218). Read raw bytes first so
        // the HMAC sees exactly what Verify-stg signed.
        const rawBytes = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', reject);
        });

        const hmacMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'verify-integration', 'hmac.js')).href);
        const auth = hmacMod.authorizeWebhookRequest(
          rawBytes,
          req.headers[hmacMod.HMAC_HEADER_NAME],
          process.env.VERIFY_WEBHOOK_SECRET
        );
        if (!auth.ok) {
          addLog('system', `🔒 Verify webhook: rejected — ${auth.reason}`);
          broadcast();
          return jsonResponse(res, 401, { error: 'webhook authorization failed', reason: auth.reason });
        }
        if (auth.bypassed) {
          console.warn('[verify/webhook]', auth.warning);
        }

        let body;
        try { body = rawBytes.length ? JSON.parse(rawBytes.toString('utf-8')) : {}; }
        catch (parseErr) { return jsonResponse(res, 400, { error: `invalid JSON: ${parseErr.message}` }); }
        const project_id = body.project_id || 'unknown';

        const [typesMod, recvMod, memMod] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'verify-integration', 'types.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'verify-integration', 'feedback-receiver.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'memory-layer', 'service.js')).href),
        ]);

        const { project_id: _drop, ...payload } = body;
        const vErr = typesMod.validateFeedbackPayload(payload);
        if (vErr) return jsonResponse(res, 400, { error: vErr });

        const memory = memMod.getMemoryService();
        const result = await recvMod.handleFeedback(payload, { memory, projectId: project_id });

        // Audit log — every hit, success or failure.
        try {
          fs.mkdirSync(RUNTIME_DIR, { recursive: true });
          const record = {
            received_at: new Date().toISOString(),
            project_id,
            build_id: payload.build_id,
            decision: payload.decision,
            reviewer: payload.reviewer,
            review_item_id: payload.review_item_id || null,
            comments_preview: (payload.comments || '').slice(0, 200),
            ok: result.ok,
            route_lane: result.route?.lane || null,
            route_agent: result.route?.agent || null,
            observation_id: result.observation_id || null,
            error: result.error || null,
          };
          fs.appendFileSync(VERIFY_FEEDBACK_LOG, JSON.stringify(record) + '\n');
        } catch (logErr) {
          console.warn('[verify/webhook] feedback log append failed:', logErr?.message || logErr);
        }

        if (!result.ok) {
          addLog('system', `⚠️ Verify webhook: ${payload.build_id} → ${result.error}`);
          broadcast();
          return jsonResponse(res, 400, { error: result.error });
        }

        const lane = result.route?.lane || 'none';
        const agent = result.route?.agent ? ` → ${result.route.agent}` : '';
        addLog('system', `✅ Verify webhook: ${payload.build_id} (${payload.decision}) by ${payload.reviewer} → lane=${lane}${agent}`);
        broadcast();
        return jsonResponse(res, 200, {
          ok: true,
          observation_id: result.observation_id,
          route: result.route,
          router_result: result.router_result,
        });
      } catch (err) {
        console.error('[factory-admin/verify/webhook]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 19-B HTTP surface — customer portal (D225) ───────────────
  // Customer-facing routes. Bearer-token auth via the Phase 19-A
  // account store. Successful submitProject auto-enqueues a
  // project_intake job so the submission walks through the queue
  // handler chain (D224) on its own.
  //
  // Admin routes (no bearer; v0.0.1 single-VM single-founder — same
  // posture as the queue submit endpoint). Phase 22 adds proper auth.

  // POST /api/customer-portal/admin/customers — register a new customer.
  // Body: { email, name?, tier?: 'free'|'starter'|'pro' }
  // Returns: { customer, token } — token shown ONCE, hashed at rest.
  if (req.url === '/api/customer-portal/admin/customers' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        if (!body?.email) return jsonResponse(res, 400, { error: 'body.email required' });
        const portal = await getCustomerPortal();
        if (!body?.display_name) return jsonResponse(res, 400, { error: 'body.display_name required' });
        const account = await portal.registerCustomer({
          email: body.email,
          display_name: body.display_name,
          tier: body.tier || 'free',
        });
        addLog('system', `🧾 Customer portal: registered ${account.account.id} (${body.email}, tier=${account.account.tier})`);
        broadcast();
        return jsonResponse(res, 201, account);  // includes plaintext token ONCE
      } catch (err) {
        console.error('[customer-portal/admin/customers]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // GET /api/customer-portal/admin/customers — list all customers (no secrets).
  if (req.url === '/api/customer-portal/admin/customers' && req.method === 'GET') {
    (async () => {
      try {
        const portal = await getCustomerPortal();
        const customers = await portal.listCustomers();
        return jsonResponse(res, 200, { customers });
      } catch (err) {
        console.error('[customer-portal/admin/customers/list]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // GET /api/customer-portal/admin/submissions — flat list of all
  // submissions across all customers, with each customer's tier joined
  // in + SLA status computed at request time. Optional filters via
  // query string: ?status=in_progress&tier=free.
  // PR-C admin surface for the Customer Portal tab. No auth in v0.0.1
  // per the same posture as other admin endpoints (founder is sole
  // operator; nginx restricts external access; Phase 22 hardens).
  if (req.url?.startsWith('/api/customer-portal/admin/submissions') && req.method === 'GET' && !req.url.includes('/cancel')) {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const detailMatch = url.pathname.match(/^\/api\/customer-portal\/admin\/submissions\/([^/]+)\/([^/]+)$/);
        const portal = await getCustomerPortal();

        if (detailMatch) {
          // Single submission detail: record + timeline + SLA status.
          const customerId = decodeURIComponent(detailMatch[1]);
          const submissionId = decodeURIComponent(detailMatch[2]);
          const submission = await portal.submissions.get(customerId, submissionId);
          if (!submission) return jsonResponse(res, 404, { error: 'submission not found' });
          const account = await portal.accounts.getById(customerId);
          const timeline = await portal.timeline.read(customerId, submissionId);
          const slaStatus = account ? portal.sla.computeStatus(submission, account.tier) : null;
          return jsonResponse(res, 200, { submission, account: account || null, timeline, sla_status: slaStatus });
        }

        // Flat list across all customers.
        const statusFilter = url.searchParams.get('status') || null;
        const tierFilter   = url.searchParams.get('tier')   || null;
        const customers = await portal.listCustomers();
        const rows = [];
        for (const c of customers) {
          if (tierFilter && c.tier !== tierFilter) continue;
          let subs = [];
          try { subs = await portal.submissions.list(c.id); }
          catch (err) {
            // One customer's read failure shouldn't blank the whole admin
            // page — record + continue (D229 fail-isolation pattern).
            console.warn(`[admin/submissions] list failed for ${c.id}:`, err?.message || err);
            continue;
          }
          for (const s of subs) {
            if (statusFilter && s.status !== statusFilter) continue;
            // Inject customer_id + tier (index entries omit these by
            // design — D229 lesson) so the UI doesn't need a second
            // lookup per row.
            const withRefs = { ...s, customer_id: c.id, customer_email: c.email, tier: c.tier };
            // Compute SLA status inline so the UI can colour breach rows
            // without doing N round-trips.
            try {
              const full = await portal.submissions.get(c.id, s.id);
              if (full) withRefs.sla_status = portal.sla.computeStatus(full, c.tier);
            } catch {}
            rows.push(withRefs);
          }
        }
        // Newest-first across all customers (each per-customer list is
        // already newest-first per Phase 19-A; merge sort by submitted_at).
        rows.sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
        return jsonResponse(res, 200, {
          submissions: rows,
          counts: {
            total: rows.length,
            by_status: rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
            by_tier:   rows.reduce((acc, r) => { acc[r.tier]   = (acc[r.tier]   || 0) + 1; return acc; }, {}),
            breached:  rows.filter(r => r.sla_status?.status === 'breached').length,
          },
        });
      } catch (err) {
        console.error('[customer-portal/admin/submissions]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // POST /api/customer-portal/admin/submissions/:cid/:sid/cancel — admin
  // cancel (founder operating on behalf of customer). Bypasses the
  // submitted/accepted-only customer cancel guard but still goes through
  // the same state-machine — illegal transitions (delivered/cancelled/
  // rejected) will refuse.
  if (req.url?.match(/^\/api\/customer-portal\/admin\/submissions\/([^/]+)\/([^/]+)\/cancel$/) && req.method === 'POST') {
    (async () => {
      try {
        const match = req.url.match(/^\/api\/customer-portal\/admin\/submissions\/([^/]+)\/([^/]+)\/cancel$/);
        const customerId = decodeURIComponent(match[1]);
        const submissionId = decodeURIComponent(match[2]);
        const body = await readRequestBody(req).catch(() => ({}));
        const portal = await getCustomerPortal();
        // Direct state-machine transition — bypasses the customer-route
        // cancel guard that refuses cancel on in_progress.
        let updated;
        try {
          updated = await portal.transitionSubmission(customerId, submissionId, 'cancelled', { note: body?.note });
        } catch (err) {
          return jsonResponse(res, 400, { error: err?.message || String(err), code: 'VALIDATION' });
        }
        await portal.recordTimelineEvent(customerId, submissionId, {
          kind: 'cancelled',
          note: body?.note || 'cancelled by admin',
        });
        addLog('system', `🛑 Admin cancel: ${customerId}/${submissionId}${body?.note ? ` (${body.note})` : ''}`);
        // D231 onCancelled — fail-isolated.
        try {
          const notifier = await getPortalNotifier();
          const account = await portal.accounts.getById(customerId);
          if (notifier && account) {
            await notifier.onCancelled({ account, submission: updated, note: body?.note });
          }
        } catch (notifyErr) {
          console.warn('[admin/cancel] notifier.onCancelled failed:', notifyErr?.message || notifyErr);
        }
        broadcast();
        return jsonResponse(res, 200, { submission: updated });
      } catch (err) {
        console.error('[customer-portal/admin/cancel]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // POST /api/customer-portal/submit — Bearer auth.
  // Body: { project_title, intake_payload, tags?, meta? }
  // Returns: SubmissionReceipt — also auto-enqueues project_intake.
  if (req.url === '/api/customer-portal/submit' && req.method === 'POST') {
    (async () => {
      try {
        const token = extractBearerToken(req);
        if (!token) return jsonResponse(res, 401, { error: 'Authorization: Bearer <token> required' });
        const body = await readRequestBody(req);
        const portal = await getCustomerPortal();
        const receipt = await portal.submitProject(token, {
          project_title: body.project_title,
          intake_payload: body.intake_payload,
          tags: body.tags,
          meta: body.meta,
        });
        addLog('system', `🧾 Customer portal: submission ${receipt.submission_id} from ${receipt.tier}-tier customer (target: ${receipt.target_delivery_at})`);

        // Auto-enqueue project_intake so the queue handler chain (D224)
        // picks it up. Resolve customer_id from the submission record
        // (portal.submitProject returns receipt without it).
        let resolvedAccount = null;
        let subRecord = null;
        try {
          resolvedAccount = await portal.accounts.authenticate(token);
          subRecord = await portal.submissions.get(resolvedAccount.id, receipt.submission_id);
          const queueMod = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href);
          const q = queueMod.createQueue(QUEUE_WORKSPACE);
          await q.enqueue({
            kind: 'project_intake',
            project_id: `${subRecord.customer_id}_${receipt.submission_id}`,
            payload: { customer_id: subRecord.customer_id, submission_id: receipt.submission_id },
            priority: 40,    // between architect (30) and pre_dev (50)
            max_attempts: 2,
          });
          addLog('system', `📥 Queue: project_intake enqueued for ${receipt.submission_id}`);
        } catch (enqErr) {
          // Auto-enqueue failure is logged but doesn't reject the
          // submission — the founder can manually re-enqueue from the
          // Admin → Queue panel. The submission record persists.
          console.warn('[customer-portal/submit] auto-enqueue failed (submission accepted, manual queue needed):', enqErr?.message || enqErr);
        }

        // D231 — fire customer.submission_received Courier event.
        // Fail-isolated: a notifier failure must not reject the submission
        // (submission is already persisted + auto-enqueued). Notifier's own
        // dispatchSafely catches throws + maps ok:false; we just discard
        // the result here (logged via notifier's onLog).
        try {
          const notifier = await getPortalNotifier();
          if (notifier && resolvedAccount && subRecord) {
            await notifier.onSubmitted({ account: resolvedAccount, submission: subRecord });
          }
        } catch (notifyErr) {
          // Defence-in-depth — notifier swore not to throw, but never propagate.
          console.warn('[customer-portal/submit] notifier.onSubmitted failed:', notifyErr?.message || notifyErr);
        }

        broadcast();
        return jsonResponse(res, 201, receipt);
      } catch (err) {
        console.error('[customer-portal/submit]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // GET /api/customer-portal/submissions — Bearer auth → list customer's own.
  if (req.url === '/api/customer-portal/submissions' && req.method === 'GET') {
    (async () => {
      try {
        const token = extractBearerToken(req);
        if (!token) return jsonResponse(res, 401, { error: 'Authorization: Bearer <token> required' });
        const portal = await getCustomerPortal();
        const submissions = await portal.listMyProjects(token, {});
        return jsonResponse(res, 200, { submissions });
      } catch (err) {
        console.error('[customer-portal/submissions]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // GET /api/customer-portal/submissions/:id — Bearer auth → full status.
  if (req.url?.match(/^\/api\/customer-portal\/submissions\/([^/]+)$/) && req.method === 'GET') {
    (async () => {
      try {
        const token = extractBearerToken(req);
        if (!token) return jsonResponse(res, 401, { error: 'Authorization: Bearer <token> required' });
        const submissionId = decodeURIComponent(req.url.match(/^\/api\/customer-portal\/submissions\/([^/]+)$/)[1]);
        const portal = await getCustomerPortal();
        const status = await portal.getStatus(token, submissionId);
        return jsonResponse(res, 200, status);
      } catch (err) {
        console.error('[customer-portal/submissions/:id]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // POST /api/customer-portal/submissions/:id/cancel — Bearer auth.
  // Body: { note? }
  if (req.url?.match(/^\/api\/customer-portal\/submissions\/([^/]+)\/cancel$/) && req.method === 'POST') {
    (async () => {
      try {
        const token = extractBearerToken(req);
        if (!token) return jsonResponse(res, 401, { error: 'Authorization: Bearer <token> required' });
        const submissionId = decodeURIComponent(req.url.match(/^\/api\/customer-portal\/submissions\/([^/]+)\/cancel$/)[1]);
        const body = await readRequestBody(req).catch(() => ({}));
        const portal = await getCustomerPortal();
        const updated = await portal.cancelSubmission(token, submissionId, { note: body?.note });
        addLog('system', `🛑 Customer portal: cancelled ${submissionId}${body?.note ? ` (${body.note})` : ''}`);

        // D231 — fire customer.submission_cancelled Courier event.
        // Fail-isolated; cancellation is already persisted.
        try {
          const notifier = await getPortalNotifier();
          if (notifier) {
            const account = await portal.accounts.authenticate(token);
            await notifier.onCancelled({ account, submission: updated, note: body?.note });
          }
        } catch (notifyErr) {
          console.warn('[customer-portal/cancel] notifier.onCancelled failed:', notifyErr?.message || notifyErr);
        }

        broadcast();
        return jsonResponse(res, 200, { submission: updated });
      } catch (err) {
        console.error('[customer-portal/submissions/:id/cancel]', err);
        return portalErrorToHttp(res, err);
      }
    })();
    return;
  }

  // ─── Phase 10-A surface — Courier (read-only) ────────────────────────
  // Surfaces enabled state + EVENT_TYPES + CHANNELS + SEVERITIES +
  // current routing config + most-recent dispatched events. Real
  // Slack/GitHub/SMTP backends + Hermes deploy = full 10-B.
  if (req.url === '/api/factory-admin/courier/state' && req.method === 'GET') {
    (async () => {
      try {
        const [{ EVENT_TYPES, CHANNELS, SEVERITIES }, routerMod] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'courier', 'types.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'courier', 'router.js')).href),
        ]);
        // Try to load the routing config from the Phase 12-A admin path
        let routing = null;
        try {
          const routingPath = path.join(REPO_ROOT, 'configs', 'courier-routing.json');
          routing = await routerMod.loadRoutingConfig(routingPath);
        } catch (err) {
          routing = { error: err?.message || 'failed to load courier-routing.json' };
        }
        // UI-D — surface recent events from the shared Courier instance.
        // The fake backend records every dispatch in memory (in addition
        // to the courier-level history); both are inspectable now that
        // the notifier + admin endpoints share one instance.
        const courier = await getSharedCourier();
        const history = courier ? courier.getHistory() : [];
        return jsonResponse(res, 200, {
          enabled: process.env.USE_COURIER === 'true',
          flag_required: 'USE_COURIER',
          event_types: [...EVENT_TYPES],
          channels: [...CHANNELS],
          severities: [...SEVERITIES],
          routing,
          backend_kind: courier?.backend?.kind || null,
          recent_events: history.slice(-20).reverse(), // newest-first, last 20
          history_count: history.length,
          note: 'Default backend=fake (in-memory). Set COURIER_BACKEND=http + provide Hermes credentials for real Slack/email/etc delivery (10-B).',
        });
      } catch (err) {
        console.error('[factory-admin/courier/state]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // UI-D — Courier history endpoint with filters. Powers the
  // Notifications panel feed. Query params: ?type=customer.sla_breached
  // &severity=warn&limit=100 (defaults: no filters, limit=200).
  if (req.url?.startsWith('/api/factory-admin/courier/history') && req.method === 'GET') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const typeFilter     = url.searchParams.get('type') || null;
        const severityFilter = url.searchParams.get('severity') || null;
        const limit          = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1000);
        const courier = await getSharedCourier();
        if (!courier) {
          return jsonResponse(res, 200, { events: [], count: 0, error: 'no shared Courier instance available' });
        }
        const all = courier.getHistory();
        const filtered = all.filter(entry => {
          if (typeFilter     && entry.event.type     !== typeFilter)     return false;
          if (severityFilter && entry.event.severity !== severityFilter) return false;
          return true;
        });
        // Newest-first.
        const events = filtered.slice(-limit).reverse();
        return jsonResponse(res, 200, {
          events,
          count: events.length,
          total_unfiltered: all.length,
          backend_kind: courier.backend?.kind || null,
        });
      } catch (err) {
        console.error('[factory-admin/courier/history]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 15-B Tier B — Run self-improvement proposer ──────────────
  // Founder-triggered. Reads memory observations + emits ProposalDrafts
  // through Phase 15-A's runProposerIntoStore (with dedupe). Body:
  //   { proposer: 'heuristic' | 'llm', scope?, since?, min_support? }
  // Default = heuristic (always works, $0). LLM opt-in fires real LLM
  // calls (cost depends on observation pool size).
  if (req.url === '/api/factory-admin/self-improvement/propose' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const proposerKind = body.proposer || 'heuristic';

        const [{ getMemoryService }, { createHeuristicProposer, runProposerIntoStore }] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'memory-layer', 'service.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'self-improvement', 'proposer.js')).href),
        ]);
        const A = await loadArchitect();
        const proposalStore = A.createProposalStore(REPO_ROOT);
        const memoryService = getMemoryService();

        let proposer;
        if (proposerKind === 'llm') {
          try {
            const { createLLMProposer } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'self-improvement', 'llm-proposer.js')).href);
            proposer = createLLMProposer({ task: body.task || 'architect' });
          } catch (err) {
            console.warn('[self-improvement.propose] LLM proposer unavailable, falling back to heuristic:', err?.message);
            proposer = createHeuristicProposer({ minSupport: body.min_support ?? 2 });
          }
        } else {
          proposer = createHeuristicProposer({ minSupport: body.min_support ?? 2 });
        }

        addLog('system', `🪶 Self-improvement proposer (${proposer.id}) running…`);
        broadcast();

        const created = await runProposerIntoStore({
          proposer,
          store: proposalStore,
          ctx: {
            memory: memoryService,
            scope: body.scope,
            since: body.since,
          },
        });

        addLog('system', `🪶 Proposer (${proposer.id}) emitted ${created.length} proposal(s).`);
        broadcast();
        return jsonResponse(res, 200, { proposer: proposer.id, created_count: created.length, proposals: created });
      } catch (err) {
        console.error('[factory-admin/self-improvement/propose]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 7-E — Sync memory observations from artifacts ─────────────
  // Founder-triggered. Walks <agent-workspace>/<project>/_artifacts/ via
  // walkArtifacts(), groups by run_id, writes one `lesson` observation per
  // run (idempotent via _sync_state.json) + one `pattern` per agent
  // (refreshed each sync). Lights up the Memory Layer page once 6-B
  // produces real artifacts.
  if (req.url === '/api/factory-admin/memory/sync-from-artifacts' && req.method === 'POST') {
    (async () => {
      try {
        const [{ getMemoryService }, { syncFromArtifacts }] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'memory-layer', 'service.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'memory-layer', 'sync-from-artifacts.js')).href),
        ]);
        // Same agent-workspace path Replay uses
        const AGENT_WORKSPACE = '/home/subhash.thakur.india/Projects/agent-workspace';
        const memSvc = getMemoryService();
        const result = await syncFromArtifacts({
          workspaceRoot: AGENT_WORKSPACE,
          memoryService: memSvc,
          memoryRootDir: memSvc.rootDir,
        });
        addLog('system', `🧠 Memory sync: ${result.synced} observations written (${result.skipped} skipped, ${result.artifacts_scanned} artifacts scanned)`);
        broadcast();
        return jsonResponse(res, 200, result);
      } catch (err) {
        console.error('[factory-admin/memory/sync-from-artifacts]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 7-A surface — Memory Layer (read-only) ────────────────────
  // Lists scopes + observations from the configured memory backend
  // (default = filesystem at ~/Projects/agent-workspace/_factory-memory).
  // Empty until pipeline runs / agents write observations through the
  // service. No write path here in v1 — that's an authored flow handled
  // by individual agents, not the admin UI.
  if (req.url?.startsWith('/api/factory-admin/memory') && req.method === 'GET') {
    (async () => {
      try {
        const { getMemoryService } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'memory-layer', 'service.js')).href);
        const svc = getMemoryService();
        const url = new URL(req.url, 'http://localhost');
        const route = req.url.match(/^\/api\/factory-admin\/memory(\/[^?]*)?(?:\?.*)?$/)?.[1] || '';

        if (route === '/scopes' || route === '') {
          // Without a real index of scopes we walk known kinds and aggregate.
          // Filesystem backend has listForScope but we need scope discovery.
          // Cheap path: ask recall() for everything, then group.
          const all = await svc.recall({ limit: 1000 });
          const byScope = {};
          const byKind = {};
          for (const o of all) {
            byScope[o.scope || 'unknown'] = (byScope[o.scope || 'unknown'] || 0) + 1;
            byKind[o.kind || 'unknown'] = (byKind[o.kind || 'unknown'] || 0) + 1;
          }
          return jsonResponse(res, 200, {
            scopes: Object.entries(byScope).map(([scope, count]) => ({ scope, count })).sort((a, b) => b.count - a.count),
            kinds: byKind,
            total: all.length,
            backend: process.env.MEMORY_BACKEND || 'filesystem',
            flag_required: 'USE_MEMORY_LAYER',
            note: all.length === 0
              ? 'No observations yet — agents and pipelines write here through getMemoryService(). Phase 7-A scaffold ships with a filesystem backend; populated automatically once USE_MEMORY_LAYER is on (Admin → Flags) and agents start writing.'
              : null,
          });
        }

        if (route === '/observations') {
          const scope = url.searchParams.get('scope') || undefined;
          const kind = url.searchParams.get('kind') || undefined;
          const limit = Number(url.searchParams.get('limit')) || 100;
          const obs = await svc.recall({ scope, kind, limit });
          return jsonResponse(res, 200, { observations: obs, scope, kind, limit });
        }

        return jsonResponse(res, 404, { error: 'unknown memory route' });
      } catch (err) {
        console.error('[factory-admin/memory]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 13-B Tier B — Replay (read-only visualization) ─────────────
  // The execution path (LLM stub + cross-pipeline replay) is full 13-B and
  // needs OpenRouter credit; today we surface the read side: list past runs
  // + return a single run's artifact graph for timeline rendering.
  // Workspace root for replay is the agent-workspace where Pre-Dev / Dev /
  // Post-Dev pipelines actually deposit artifacts — different from REPO_ROOT.
  const AGENT_WORKSPACE = '/home/subhash.thakur.india/Projects/agent-workspace';

  if (req.url === '/api/factory-admin/replay/runs' && req.method === 'GET') {
    (async () => {
      try {
        const { listRunIds } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'run-collector.js')).href);
        const runIds = await listRunIds(AGENT_WORKSPACE);
        return jsonResponse(res, 200, {
          runs: runIds.map(id => ({ id })),
          workspace: AGENT_WORKSPACE,
          flag_required: 'USE_ARTIFACT_STORE',
          note: runIds.length === 0
            ? 'No past runs visible — Phase 6-B (USE_ARTIFACT_STORE) is OFF, so pipeline runs aren\'t writing replayable artifacts yet.'
            : null,
        });
      } catch (err) {
        console.error('[factory-admin/replay/runs]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.match(/^\/api\/factory-admin\/replay\/runs\/([^/]+)$/) && req.method === 'GET') {
    (async () => {
      try {
        const runId = decodeURIComponent(req.url.match(/^\/api\/factory-admin\/replay\/runs\/([^/]+)$/)[1]);
        const { collectRun } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'run-collector.js')).href);
        const snapshot = await collectRun(AGENT_WORKSPACE, runId);
        if (!snapshot) return jsonResponse(res, 404, { error: `run not found: ${runId}` });
        return jsonResponse(res, 200, { snapshot });
      } catch (err) {
        console.error('[factory-admin/replay/runs/:id]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // Phase 13-B full — execute a replay via the LLM-stub.
  // POST body: { replay_from_artifact_id, substitutions?, dispatcher?, project_dir? }
  // Returns: ReplayResult { ok, new_run_id, new_artifact_ids, produced, duration_ms, error? }
  if (req.url?.match(/^\/api\/factory-admin\/replay\/runs\/([^/]+)\/execute$/) && req.method === 'POST') {
    (async () => {
      try {
        const runId = decodeURIComponent(req.url.match(/^\/api\/factory-admin\/replay\/runs\/([^/]+)\/execute$/)[1]);
        const body = await readRequestBody(req);
        if (!body?.replay_from_artifact_id) {
          return jsonResponse(res, 400, { error: 'body.replay_from_artifact_id required' });
        }
        const [collectorMod, plannerMod, executorMod, llmStubMod] = await Promise.all([
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'run-collector.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'planner.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'executor.js')).href),
          import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'replay', 'llm-stub.js')).href),
        ]);
        const snapshot = await collectorMod.collectRun(AGENT_WORKSPACE, runId);
        if (!snapshot) return jsonResponse(res, 404, { error: `run not found: ${runId}` });

        const plan = plannerMod.buildReplayPlan(snapshot, {
          replayFromArtifactId: body.replay_from_artifact_id,
          substitutions: body.substitutions || {},
        });
        if (!plan?.replay_artifact_ids?.length) {
          return jsonResponse(res, 400, { error: 'plan empty — replay_from_artifact_id not found in snapshot' });
        }

        const dispatcherKey = body.dispatcher || 'stub';
        let llmCall;
        if (dispatcherKey === 'stub') {
          llmCall = async ({ user }) => ({
            content: `[stub replay] (dispatcher=stub — no real LLM spend.)\n\n${user.substring(0, 500)}\n\n...`,
            cost_usd: 0,
            model: 'stub:replay',
            latency_ms: 1,
          });
        } else {
          try {
            const A = await loadArchitect();
            const dispatcher = pickDispatcher(A, dispatcherKey);
            llmCall = async ({ system, user, agent, kind }) => {
              const r = await dispatcher.dispatch({
                topic: `replay:${agent}:${kind}`,
                question: `${system}\n\n${user}`,
                area: 'replay',
                depth: 'standard',
                budget_usd: 1.0,
              });
              return {
                content: r?.summary || r?.text || JSON.stringify(r).slice(0, 4000),
                cost_usd: r?.cost_usd ?? 0,
                model: r?.model || dispatcherKey,
                latency_ms: r?.latency_ms ?? 0,
              };
            };
          } catch (dErr) {
            console.warn('[replay/execute] dispatcher init failed; falling back to stub:', dErr?.message || dErr);
            llmCall = async () => ({ content: '[stub fallback]', cost_usd: 0, latency_ms: 1 });
          }
        }

        const nodeStubs = llmStubMod.createLLMNodeStubsForPlan(plan, snapshot, { llmCall });
        const projectDir = body.project_dir || (snapshot.project_id ? path.join(AGENT_WORKSPACE, snapshot.project_id) : null);
        if (!projectDir) return jsonResponse(res, 400, { error: 'project_dir not resolvable' });

        addLog('system', `🔁 Replay started: ${runId} from ${body.replay_from_artifact_id} (dispatcher=${dispatcherKey}, ${plan.replay_artifact_ids.length} steps)`);
        broadcast();

        const result = await executorMod.executeReplay(plan, { projectDir, nodeStubs, snapshot });

        const verdict = result.ok ? '✅' : '⚠️';
        addLog('system', `${verdict} Replay complete: ${result.new_run_id} (${result.new_artifact_ids.length} artifacts, ${result.duration_ms}ms)${result.error ? ' — ' + result.error : ''}`);
        broadcast();
        return jsonResponse(res, result.ok ? 200 : 500, result);
      } catch (err) {
        console.error('[factory-admin/replay/runs/:id/execute]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/factory-admin/audit') && req.method === 'GET') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const { readAudit } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'admin-substrate', 'audit.js')).href);
        const entries = await readAudit({
          actor: url.searchParams.get('actor') || undefined,
          action: url.searchParams.get('action') || undefined,
          target: url.searchParams.get('target') || undefined,
          limit: Number(url.searchParams.get('limit')) || 100,
        });
        return jsonResponse(res, 200, { entries });
      } catch (err) {
        console.error('[factory-admin/audit]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/modules' && req.method === 'GET') {
    (async () => {
      try {
        const { createMarketplaceStore } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'marketplace', 'store.js')).href);
        const store = createMarketplaceStore(REPO_ROOT);
        // store may need to be initialized; built-ins live in the registry
        const list = typeof store.list === 'function' ? store.list() : [];
        const stats = typeof store.stats === 'function' ? store.stats() : null;
        // If the store is empty (built-ins haven't been registered in this telemetry process),
        // surface the catalogue manifests directly so the UI isn't blank.
        let modules = list;
        if (!modules.length) {
          try {
            const { BUILTIN_MANIFESTS } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'marketplace', 'catalogue.js')).href);
            modules = BUILTIN_MANIFESTS.map(m => ({ ...m, status: 'catalogued' }));
          } catch (e) { console.warn('[factory-admin/modules] catalogue fallback failed:', e?.message); }
        }
        return jsonResponse(res, 200, { modules, stats });
      } catch (err) {
        console.error('[factory-admin/modules]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // Phase 14-B Tier B — submit a job into the queue.
  // Body: { kind: 'pre_dev'|'dev'|'post_dev', project_id: string, payload?: {...}, priority?: number }
  // Worker (booted at telemetry startup) leases + dispatches via the
  // handler registry. Founder watches Admin → Queue panel for state.
  if (req.url === '/api/factory-admin/queue/submit' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const kind = body.kind;
        const project_id = body.project_id;
        if (!kind || !project_id) {
          return jsonResponse(res, 400, { error: 'body.kind and body.project_id required' });
        }
        const VALID_KINDS = new Set(['pre_dev', 'dev', 'post_dev']);
        if (!VALID_KINDS.has(kind)) {
          return jsonResponse(res, 400, { error: `kind must be one of ${[...VALID_KINDS].join(', ')}` });
        }
        // Phase 14-B per-project quota gate. Reads configs/cost-thresholds.json
        // and refuses if the project has hit its daily/monthly hard_cap_usd
        // (or the global cap). Implicit pass when no matching threshold exists.
        try {
          const { checkProjectQuota } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'cost-tracker', 'project-quota.js')).href);
          const quota = await checkProjectQuota({ project_id, workspaceRoot: QUEUE_WORKSPACE });
          if (!quota.ok) {
            addLog('system', `🚫 Queue: refused ${kind} for "${project_id}" — quota breached (${quota.breach.key} ${quota.breach.window} $${quota.breach.current_usd.toFixed(2)} / $${quota.breach.hard_cap_usd.toFixed(2)})`);
            broadcast();
            return jsonResponse(res, 429, { error: 'quota exceeded', breach: quota.breach });
          }
        } catch (qErr) {
          // Fail-open: a broken quota check should never block the queue.
          // The breach (if any) will resurface on the next submission once
          // thresholds.json is fixed.
          console.warn('[factory-admin/queue/submit] quota check skipped:', qErr?.message || qErr);
        }
        const { createQueue } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href);
        const queue = createQueue(QUEUE_WORKSPACE);
        const job = await queue.enqueue({
          project_id,
          kind,
          payload: body.payload || {},
          priority: body.priority ?? 50,
          max_attempts: body.max_attempts ?? 3,
        });
        addLog('system', `📥 Queue: enqueued ${kind} job ${job.id} for project "${project_id}"`);
        broadcast();
        // Make sure the worker is running (idempotent). Don't await — fire and forget.
        bootQueueWorker().catch(() => {});
        return jsonResponse(res, 200, { ok: true, job });
      } catch (err) {
        console.error('[factory-admin/queue/submit]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/factory-admin/queue' && req.method === 'GET') {
    (async () => {
      try {
        const { createQueue } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'concurrency', 'queue.js')).href);
        const queue = createQueue(REPO_ROOT);
        const [stats, queued, inFlight] = await Promise.all([
          queue.stats(),
          queue.listQueued(),
          queue.listInFlight(),
        ]);
        return jsonResponse(res, 200, { stats, queued, in_flight: inFlight });
      } catch (err) {
        console.error('[factory-admin/queue]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/factory-admin/cost') && req.method === 'GET') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const { getRollup } = await import(pathToFileURL(path.join(REPO_ROOT, 'cognitive-engine', 'cost-tracker', 'service.js')).href);
        // artifact-source filter uses `from` / `to` (not since/until); accept
        // both query-param names for back-compat with anything wired to the
        // old shape.
        const since = url.searchParams.get('since') || url.searchParams.get('from') || undefined;
        const until = url.searchParams.get('until') || url.searchParams.get('to')   || undefined;
        // Fix (was: workspace_root in filter; getRollup expected workspaceRoot
        // in opts AND artifacts live under QUEUE_WORKSPACE/<project>/_artifacts/
        // — REPO_ROOT was wrong). Cost rollup now reads the real per-project
        // artifact stores written by the Phase 6-B RouterChatModel chokepoint.
        const rollup = await getRollup(
          { from: since, to: until },
          { source: 'artifacts', workspaceRoot: QUEUE_WORKSPACE },
        );
        return jsonResponse(res, 200, { rollup, period: { since, until } });
      } catch (err) {
        console.error('[factory-admin/cost]', err);
        // Cost-tracker may have no data yet — return an empty rollup rather than 500
        return jsonResponse(res, 200, { rollup: null, error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── UI-E: Services Health endpoint ─────────────────────────────────
  // Pings every factory service in parallel + returns a single rollup so
  // the React "Services Health" tab can render a status grid without
  // 10+ network round-trips from the browser. Per-service config:
  //   - kind: 'http' (probe via fetch) | 'tcp' (probe via net.connect)
  //   - check_url: full URL the probe hits (must respond < 3s)
  //   - console_url: where the user clicks to actually USE the service
  //   - has_console: true if there's a real web UI (vs API/JSON only)
  // Fail-isolated: one slow/down service doesn't block the others
  // (Promise.allSettled + per-probe timeout).
  if (req.url?.startsWith('/api/factory-admin/services/health') && req.method === 'GET') {
    (async () => {
      try {
        const net = await import('node:net');
        const SERVICES = [
          // Own services
          { id: 'telemetry',  name: 'Factory Telemetry',     port: 4401, kind: 'http', check_url: 'http://127.0.0.1:4401/api/factory-admin/flags', console_url: null,                                       has_console: false, role: 'own',     note: 'This dashboard\'s backend' },
          { id: 'dashboard',  name: 'Factory Dashboard (Vite)', port: 5173, kind: 'tcp', check_url: null,                                     console_url: 'https://dev-hub.agentryx.dev/',            has_console: true,  role: 'own',     note: 'This React app' },
          { id: 'metrics',    name: 'Factory Metrics',       port: 4400, kind: 'http', check_url: 'http://127.0.0.1:4400/api/health',        console_url: null,                                       has_console: false, role: 'own',     note: 'API only — feeds Cost Panel + Memory Layer' },
          { id: 'key-console',name: 'Key Console (Phase 2.5)', port: 4402, kind: 'tcp', check_url: null,                                     console_url: 'https://dev-hub.agentryx.dev/admin/api/',  has_console: true,  role: 'own',     note: 'LLM provider keys + presets' },
          { id: 'paperclip',  name: 'Paperclip',             port: 3101, kind: 'http', check_url: 'http://127.0.0.1:3101/api/health',        console_url: 'https://dev-hub.agentryx.dev/paperclip/',  has_console: true,  role: 'own',     note: 'Document parser (React UI)' },
          { id: 'claw-web',   name: 'Claw Code (terminal)',  port: 7681, kind: 'tcp', check_url: null,                                     console_url: 'https://claw-code.agentryx.dev/',          has_console: true,  role: 'own',     note: 'Web terminal (ttyd)' },
          // Docker-hosted infra services
          { id: 'litellm',    name: 'LiteLLM',               port: 4000, kind: 'http', check_url: 'http://127.0.0.1:4000/litellm/health/liveliness', console_url: 'https://dev-hub.agentryx.dev/litellm/ui/',  has_console: true,  role: 'infra',   note: 'LLM proxy (admin UI at /litellm/ui/; SERVER_ROOT_PATH-prefixed)' },
          { id: 'n8n',        name: 'n8n Workflows',         port: 5678, kind: 'http', check_url: 'http://127.0.0.1:5678/healthz',           console_url: 'https://dev-hub.agentryx.dev/n8n/',        has_console: true,  role: 'infra',   note: 'Workflow automation' },
          { id: 'langfuse',   name: 'Langfuse',              port: 3000, kind: 'http', check_url: 'http://127.0.0.1:3000/api/public/health', console_url: null,                                       has_console: false, role: 'infra',   note: 'Running but UI not embeddable (Next.js basePath baked at build time); no traces sent yet' },
          { id: 'chromadb',   name: 'ChromaDB',              port: 8000, kind: 'http', check_url: 'http://127.0.0.1:8000/api/v2/heartbeat',  console_url: null,                                       has_console: false, role: 'infra',   note: 'Vector store (API only)' },
          { id: 'postgres',   name: 'PostgreSQL',            port: 5432, kind: 'tcp', check_url: null,                                     console_url: null,                                       has_console: false, role: 'infra',   note: 'Primary DB' },
          { id: 'redis',      name: 'Redis',                 port: 6379, kind: 'tcp', check_url: null,                                     console_url: null,                                       has_console: false, role: 'infra',   note: 'Cache' },
          // Not currently deployed but documented for visibility
          { id: 'hermes',     name: 'Hermes Agent (Lab)',    port: null, kind: 'absent', check_url: null,                                  console_url: null,                                       has_console: true,  role: 'lab',     note: 'Container present at hermes/docker-compose.yml — not currently running (evaluation only, Phase 2.75)' },
          { id: 'honcho',     name: 'Honcho (Lab — pending)', port: null, kind: 'absent', check_url: null,                                console_url: null,                                       has_console: true,  role: 'lab',     note: 'Memory backend candidate — not yet deployed (Phase 7-E Lab profile)' },
          // External services
          { id: 'openrouter', name: 'OpenRouter',            port: null, kind: 'external', check_url: null,                               console_url: 'https://openrouter.ai/settings/credits',   has_console: true,  role: 'external', note: 'LLM provider account + billing' },
          { id: 'anthropic',  name: 'Anthropic Console',     port: null, kind: 'external', check_url: null,                               console_url: 'https://console.anthropic.com/',           has_console: true,  role: 'external', note: 'Direct API key (BYOK path)' },
          { id: 'gcp',        name: 'GCP Console',           port: null, kind: 'external', check_url: null,                               console_url: 'https://console.cloud.google.com/compute', has_console: true,  role: 'external', note: 'VM + infra' },
          { id: 'github',     name: 'GitHub Repo',           port: null, kind: 'external', check_url: null,                               console_url: 'https://github.com/agentryx2026-hash/agentryx-factory', has_console: true, role: 'external', note: 'Source + PRs + tags' },
        ];

        const PROBE_TIMEOUT_MS = 4000;

        async function probeHttp(svc) {
          const t0 = Date.now();
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
          try {
            const res = await fetch(svc.check_url, { signal: controller.signal });
            return { status: res.ok ? 'up' : 'degraded', http_status: res.status, latency_ms: Date.now() - t0 };
          } catch (err) {
            return { status: 'down', latency_ms: Date.now() - t0, error: err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err)) };
          } finally { clearTimeout(timer); }
        }

        function probeTcp(svc) {
          return new Promise((resolve) => {
            const t0 = Date.now();
            const sock = new net.Socket();
            const finish = (status, extra) => {
              try { sock.destroy(); } catch {}
              resolve({ status, latency_ms: Date.now() - t0, ...extra });
            };
            sock.setTimeout(PROBE_TIMEOUT_MS);
            sock.once('connect', () => finish('up'));
            sock.once('timeout', () => finish('down', { error: 'timeout' }));
            sock.once('error', (err) => finish('down', { error: err?.message || 'connect failed' }));
            sock.connect(svc.port, '127.0.0.1');
          });
        }

        const probed = await Promise.allSettled(SERVICES.map(async (svc) => {
          let probe;
          if (svc.kind === 'http' && svc.check_url) probe = await probeHttp(svc);
          else if (svc.kind === 'tcp' && svc.port)  probe = await probeTcp(svc);
          else if (svc.kind === 'absent')           probe = { status: 'absent' };
          else if (svc.kind === 'external')         probe = { status: 'external' };
          else                                       probe = { status: 'unknown' };
          return { ...svc, ...probe, checked_at: new Date().toISOString() };
        }));
        const services = probed.map(p => p.status === 'fulfilled' ? p.value : { status: 'down', error: p.reason?.message || 'probe rejected' });
        return jsonResponse(res, 200, {
          services,
          summary: {
            total:      services.length,
            up:         services.filter(s => s.status === 'up').length,
            degraded:   services.filter(s => s.status === 'degraded').length,
            down:       services.filter(s => s.status === 'down').length,
            absent:     services.filter(s => s.status === 'absent').length,
            external:   services.filter(s => s.status === 'external').length,
            with_console: services.filter(s => s.has_console).length,
          },
        });
      } catch (err) {
        console.error('[factory-admin/services/health]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Phase 21-A: Master Architect ─────────────────────────────────────
  // All routes are namespaced under /api/architect/* and read/write the
  // factory's KB at <repo>/_kb/. The architect ships with a stub
  // dispatcher (= $0 cost), so "Run a pass" is safe to invoke from the UI.

  if (req.url === '/api/architect/state' && req.method === 'GET') {
    (async () => {
      try {
        const { createKnowledgeBase, createProposalStore } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const store = createProposalStore(ARCHITECT_KB_ROOT);
        const [standing_orders, summary, passes, findings, allProposals, briefs, reports, unreadCount] = await Promise.all([
          kb.readStandingOrders(),
          kb.summary(),
          kb.listPasses({ limit: 5 }),
          kb.listFindings({ limit: 30 }),
          store.list(),
          kb.listBriefs({ limit: 30 }),
          kb.listReports({ limit: 30 }),
          kb.unreadReportCount(),
        ]);
        // Architect-owned proposal kinds only — keep the surface focused
        const ARCH_KINDS = new Set(['tool_adoption', 'kb_update', 'research_finding']);
        const proposals = allProposals
          .filter(p => ARCH_KINDS.has(p.kind))
          .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
          .slice(0, 25);
        return jsonResponse(res, 200, {
          standing_orders,
          summary,
          passes,
          findings,
          proposals,
          briefs,
          reports,
          unread_report_count: unreadCount,
          paused: standing_orders?.baseline?.paused === true,
          kb_root: ARCHITECT_KB_ROOT,
          has_seed: fs.existsSync(SEED_JSON_PATH),
        });
      } catch (err) {
        console.error('[architect/state]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/seed' && req.method === 'POST') {
    (async () => {
      try {
        if (!fs.existsSync(SEED_JSON_PATH)) {
          return jsonResponse(res, 404, { error: `seed not found: ${SEED_JSON_PATH}` });
        }
        const seed = JSON.parse(fs.readFileSync(SEED_JSON_PATH, 'utf-8'));
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const existing = await kb.readStandingOrders();
        if (existing) {
          return jsonResponse(res, 409, {
            error: 'Standing Orders already exist; refusing to overwrite. Edit _kb/standing_orders.json directly or delete it first.',
          });
        }
        await kb.writeStandingOrders(seed);
        addLog('system', '👑 Architect: Standing Orders seeded from example (v1).');
        broadcast();
        return jsonResponse(res, 200, { success: true, seeded: true, version: seed.version });
      } catch (err) {
        console.error('[architect/seed]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/standing_orders' && req.method === 'POST') {
    // Founder save from the Standing Orders editor. Body shape:
    //   { standing_orders: <partial-or-full SO>, bump_version?: boolean }
    // The handler MERGES the incoming object onto whatever is on disk
    // (so the editor can ship without exposing every field), then writes
    // via kb.writeStandingOrders which validates + appends history.
    (async () => {
      try {
        const body = await readRequestBody(req);
        const incoming = body.standing_orders;
        if (!incoming || typeof incoming !== 'object') {
          return jsonResponse(res, 400, { error: 'standing_orders object required in body' });
        }
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const existing = (await kb.readStandingOrders()) || {};

        // Deep-merge custom_direction so the editor can omit arrays it
        // doesn't expose (hard_constraints, anti_goals, etc.) without
        // wiping them. Priority areas are merged by id.
        const merged = {
          ...existing,
          ...incoming,
          baseline: { ...(existing.baseline || {}), ...(incoming.baseline || {}) },
          custom_direction: mergeCustomDirection(existing.custom_direction, incoming.custom_direction),
        };

        // Bump version unless caller opted out (default: bump on every save
        // so the architect's version-watermark detector picks it up).
        if (body.bump_version !== false) {
          merged.version = Number(existing.version || 0) + 1;
        } else if (typeof merged.version !== 'number') {
          merged.version = Number(existing.version || 1);
        }

        const written = await kb.writeStandingOrders(merged);
        addLog('system', `👑 Architect: Standing Orders saved (v${written.version}).`);
        broadcast();
        return jsonResponse(res, 200, { success: true, version: written.version, standing_orders: written });
      } catch (err) {
        console.error('[architect/standing_orders POST]', err);
        return jsonResponse(res, 400, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url === '/api/architect/run_pass' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const passKind = body.passKind || 'manual';
        const {
          createKnowledgeBase, createResearcher, createStubDispatcher,
          createArchitectProposer, createArchitect, createProposalStore,
        } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) {
          return jsonResponse(res, 412, {
            error: 'No Standing Orders configured. Click "Seed from example" first, or write _kb/standing_orders.json directly.',
          });
        }
        const proposalStore = createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = createArchitectProposer({ proposalStore, kb });
        // Phase 21-B: manual run-pass honors body.dispatcher if supplied
        // (e.g., "Run with Sonnet" button); defaults to 'stub'.
        const A = await loadArchitect();
        const dispatcherKey = body.dispatcher || 'stub';
        const researcher = createResearcher({
          dispatchSubagent: pickDispatcher(A, dispatcherKey),
          budget_usd_per_pass: so.baseline?.daily_budget_usd ?? 1.5,
        });
        const architect = createArchitect({ kb, researcher, proposer });

        addLog('system', `👑 Architect: launching ${passKind} research pass (${dispatcherKey} dispatcher)…`);
        broadcast();
        const result = await architect.runPass(passKind);
        const findingsCount = result.findings_count ?? 0;
        const proposalsCount = result.proposals_count ?? 0;
        addLog(
          'system',
          `👑 Architect: pass ${result.pass?.id || ''} done — ${findingsCount} findings, ${proposalsCount} proposals.`,
        );
        broadcast();
        return jsonResponse(res, 200, result);
      } catch (err) {
        console.error('[architect/run_pass]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Pause / resume the cadence daemon (writes baseline.paused) ───────
  if ((req.url === '/api/architect/pause' || req.url === '/api/architect/resume') && req.method === 'POST') {
    (async () => {
      try {
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) return jsonResponse(res, 412, { error: 'no Standing Orders configured' });
        const paused = req.url.endsWith('pause');
        const merged = { ...so, baseline: { ...(so.baseline || {}), paused } };
        merged.version = Number(so.version || 0) + 1;
        const written = await kb.writeStandingOrders(merged);
        addLog('system', `👑 Architect ${paused ? 'paused' : 'resumed'} (v${written.version}).`);
        broadcast();
        return jsonResponse(res, 200, { success: true, paused, version: written.version });
      } catch (err) {
        console.error('[architect/pause-resume]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Briefs (Founder R&D Brief tab) ───────────────────────────────────
  if (req.url === '/api/architect/brief' && req.method === 'POST') {
    (async () => {
      try {
        const body = await readRequestBody(req);
        const A = await loadArchitect();
        const kb = A.createKnowledgeBase(ARCHITECT_KB_ROOT);
        const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        // Phase 21-B: brief honors body.dispatcher (e.g. 'sonnet' for Seven's
        // first-hand evaluations). Defaults to stub for safety / cost.
        const briefDispatcherKey = body.dispatcher || 'stub';
        const researcher = A.createResearcher({
          dispatchSubagent: pickDispatcher(A, briefDispatcherKey),
          budget_usd_per_pass: body.budget_usd || 3,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });

        addLog('system', `🔬 Architect: brief submitted — "${(body.title || '').slice(0, 60)}" (${briefDispatcherKey})`);
        broadcast();

        const out = await A.runBrief({ kb, architect, briefInput: body });
        addLog('system', `🔬 Architect: brief ${out.brief.id} done · ${out.report?.id || 'no report'}`);
        broadcast();
        return jsonResponse(res, 200, out);
      } catch (err) {
        console.error('[architect/brief POST]', err);
        return jsonResponse(res, 400, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/architect/briefs') && req.method === 'GET') {
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/briefs(?:\/([^/?]+))?(?:\?.*)?$/);
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        if (m && m[1]) {
          const b = await kb.readBrief(m[1]);
          if (!b) return jsonResponse(res, 404, { error: 'brief not found' });
          return jsonResponse(res, 200, b);
        }
        const briefs = await kb.listBriefs({ limit: 50 });
        return jsonResponse(res, 200, { briefs });
      } catch (err) {
        console.error('[architect/briefs]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Reports (cycle reports + brief reports) ──────────────────────────
  if (req.url?.startsWith('/api/architect/reports') && req.method === 'GET') {
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/reports(?:\/([^/?]+))?(?:\?.*)?$/);
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        if (m && m[1]) {
          const r = await kb.readReport(m[1]);
          if (!r) return jsonResponse(res, 404, { error: 'report not found' });
          return jsonResponse(res, 200, r);
        }
        // List
        const url = new URL(req.url, 'http://localhost');
        const reports = await kb.listReports({
          limit: Number(url.searchParams.get('limit')) || 30,
          kind: url.searchParams.get('kind') || undefined,
          cadence: url.searchParams.get('cadence') || undefined,
          unread_only: url.searchParams.get('unread_only') === 'true',
        });
        const unreadCount = await kb.unreadReportCount();
        return jsonResponse(res, 200, { reports, unread_count: unreadCount });
      } catch (err) {
        console.error('[architect/reports]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.match(/^\/api\/architect\/reports\/([^/]+)\/read$/) && req.method === 'POST') {
    (async () => {
      try {
        const id = req.url.match(/^\/api\/architect\/reports\/([^/]+)\/read$/)[1];
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const updated = await kb.markReportRead(id);
        if (!updated) return jsonResponse(res, 404, { error: 'report not found' });
        return jsonResponse(res, 200, updated);
      } catch (err) {
        console.error('[architect/reports/read]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  // ─── Manual cadence run (for "Run a [weekly] now" buttons in the UI) ──
  if (req.url?.match(/^\/api\/architect\/cadence\/(daily|weekly|monthly)\/run$/) && req.method === 'POST') {
    (async () => {
      try {
        const cadenceKind = req.url.match(/^\/api\/architect\/cadence\/(daily|weekly|monthly)\/run$/)[1];
        await bootCadenceDaemon(); // ensure handler exists
        if (!cadenceDaemonHandle) return jsonResponse(res, 500, { error: 'daemon failed to boot' });
        // Manually invoke the same code path as a scheduled tick — but force
        // the cadence regardless of clock. We do this by calling runCadencePass
        // through a fresh architect setup, mirroring what the daemon would do.
        const { createKnowledgeBase } = await loadArchitect();
        const kb = createKnowledgeBase(ARCHITECT_KB_ROOT);
        const so = await kb.readStandingOrders();
        if (!so) return jsonResponse(res, 412, { error: 'no Standing Orders configured' });
        const cfg = so.baseline?.cadences?.[cadenceKind] || { budget_usd: 1.5, report_enabled: true };
        // Reuse the daemon's runCadencePass via a public hook. We exposed it
        // through a tiny adapter on the closure earlier — call it via a fresh
        // architect setup here for simplicity.
        const A = await loadArchitect();
        const proposalStore = A.createProposalStore(ARCHITECT_KB_ROOT);
        const proposer = A.createArchitectProposer({ proposalStore, kb });
        // Phase 21-B: manual cadence run honors the cadence's configured dispatcher
        const researcher = A.createResearcher({
          dispatchSubagent: pickDispatcher(A, cfg.dispatcher || 'stub'),
          budget_usd_per_pass: cfg.budget_usd ?? 1.5,
        });
        const architect = A.createArchitect({ kb, researcher, proposer });
        const result = await architect.runPass(cadenceKind);
        await kb.recordCadenceFire(cadenceKind, result.pass?.id);
        let report = null;
        if (cfg.report_enabled !== false) {
          const findings = await kb.listFindings({ pass_id: result.pass?.id, limit: 200 });
          report = await kb.writeReport({
            kind: "cycle",
            cadence: cadenceKind,
            pass_id: result.pass?.id,
            title: `${cadenceKind[0].toUpperCase()}${cadenceKind.slice(1)} cycle — ${new Date().toISOString().slice(0,10)}`,
            summary: `Architect ${cadenceKind} cycle: ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals.`,
            sections: [
              { heading: "Summary", kind: "narrative", body: `Manually-triggered ${cadenceKind} cycle. ${result.findings_count ?? 0} findings, ${result.proposals_count ?? 0} proposals. ${result.cost_usd === 0 ? '_(stub dispatcher — synthetic.)_' : ''}` },
              { heading: "Findings", kind: "list", body: findings.map(f => `- **[${f.priority_area || 'untagged'}]** ${f.content || '(no content)'}`).join("\n") || "_(none)_" },
            ],
            linked_findings: findings.map(f => f.id),
            cost_usd: result.cost_usd ?? 0,
          });
        }
        addLog('system', `👑 Architect manual ${cadenceKind} cycle done${report ? ` (report ${report.id})` : ''}`);
        broadcast();
        return jsonResponse(res, 200, { pass: result.pass, report });
      } catch (err) {
        console.error('[architect/cadence/run]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  if (req.url?.startsWith('/api/architect/proposal/') && req.method === 'POST') {
    // /api/architect/proposal/:id/:action  where action is approve|reject
    (async () => {
      try {
        const m = req.url.match(/^\/api\/architect\/proposal\/([^/]+)\/(approve|reject)$/);
        if (!m) return jsonResponse(res, 400, { error: 'expected /proposal/:id/:action' });
        const [, id, action] = m;
        const body = await readRequestBody(req);
        const { createProposalStore } = await loadArchitect();
        const store = createProposalStore(ARCHITECT_KB_ROOT);
        const reviewer = body.reviewer || 'founder';
        const note = body.note;
        let updated;
        if (action === 'reject') {
          // reject is allowed from any non-terminal state
          updated = await store.reject(id, { reviewer, note });
        } else {
          // The architect ships proposals in `draft`. Per Phase 21-A design
          // (D190 + README), research_finding and kb_update fast-track since
          // they're low-stakes / informational; tool_adoption is the only
          // founder-gated kind. Walk the chain explicitly so the audit log
          // captures every transition.
          const proposal = await store.get(id);
          if (!proposal) return jsonResponse(res, 404, { error: `proposal ${id} not found` });
          const chain = ['evaluating', 'ready', 'approved'];
          let cur = proposal;
          for (const next of chain) {
            if (cur.state === next) continue;
            if (cur.state === 'approved') break;
            cur = await store.transition(id, next, { actor: reviewer, note });
          }
          updated = cur;
        }
        addLog('system', `👑 Architect: proposal ${id} ${action}d.`);
        broadcast();
        return jsonResponse(res, 200, updated);
      } catch (err) {
        console.error('[architect/proposal]', err);
        return jsonResponse(res, 500, { error: err?.message || String(err) });
      }
    })();
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📡 Telemetry running on :${PORT}`);
  // Phase 21-A.1 — boot the architect cadence daemon. Failures are
  // logged but don't crash the telemetry server (architect is optional).
  bootCadenceDaemon().catch(err => console.error('[architect.daemon] boot error:', err));
  // Phase 14-B Tier B — boot the queue worker so jobs of kind
  // pre_dev/dev/post_dev get processed automatically.
  bootQueueWorker().catch(err => console.error('[queue.worker] boot error:', err));
  // Phase 19-B (D228) — boot the SLA breach scanner. Periodically
  // (default 5 min) scans every customer's non-terminal submissions
  // and emits sla_breached timeline events for any that have aged
  // past target_delivery_at without reaching a terminal state.
  // Idempotent: existing sla_breached events dedup via timeline scan.
  // Opt-out: SLA_SCANNER_DISABLED=true skips boot (used by tests +
  // local dev where customer-portal data may not exist).
  bootSlaBreachScanner().catch(err => console.error('[sla.scanner] boot error:', err));
});

// Phase 5-B cleanup — on SIGTERM/SIGINT (systemctl stop, Ctrl+C, etc.),
// disconnect any cached MCP subprocesses before the Node process exits.
// Without this, leaving USE_MCP_TOOLS=true long-term leaks subprocesses
// on every restart cycle. Best-effort: a 5-second deadline prevents a
// hung MCP server from delaying graceful shutdown indefinitely.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n📡 ${signal} received — shutting down telemetry…`);

  // Stop the SLA breach scanner first — it's a setInterval that would
  // otherwise keep the event loop alive past server.close().
  try {
    if (slaBreachScannerHandle && typeof slaBreachScannerHandle.stop === 'function') {
      slaBreachScannerHandle.stop();
      console.log('🛎️  SLA breach scanner stopped.');
    }
  } catch (err) {
    console.warn('[shutdown] SLA scanner stop failed (continuing):', err?.message || err);
  }

  try {
    // Lazy import so the shutdown hook doesn't pin the MCP module
    // into the boot path if it's broken or missing.
    //
    // Relative ESM path keeps this independent of pathToFileURL +
    // REPO_ROOT (both introduced by this same #42 ship); either form
    // would work now, but the relative path is cheaper to reason about.
    const mcpClient = await import('../../cognitive-engine/mcp/client.js');
    if (typeof mcpClient.disconnectAll === 'function') {
      await Promise.race([
        mcpClient.disconnectAll(),
        new Promise((resolve) => setTimeout(resolve, 5000)), // 5s deadline
      ]);
      console.log('📡 MCP connections closed.');
    }
  } catch (err) {
    console.warn('[shutdown] MCP disconnect failed (continuing):', err?.message || err);
  }

  // Close the HTTP server so in-flight requests can finish (with a
  // short grace period before forcibly exiting).
  server.close(() => {
    console.log('📡 HTTP server closed.');
    process.exit(0);
  });
  // Hard exit after 8s total — well within typical systemd
  // TimeoutStopSec=10 — so a stuck client request can't hold us forever.
  setTimeout(() => {
    console.warn('📡 Forcing exit after grace period.');
    process.exit(0);
  }, 8000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
