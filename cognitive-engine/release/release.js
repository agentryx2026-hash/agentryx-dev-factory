import { createUsageMeter } from "./metering.js";
import { createRetentionEngine } from "./retention.js";
import { createComplianceService } from "./compliance.js";
import { createReadinessAggregator } from "./readiness.js";
import { createBackupService } from "./backup.js";
import { DEFAULT_RETENTION_POLICIES } from "./types.js";

/**
 * Public Release orchestrator — composes all 5 substrate pieces behind one
 * entry point. 20-B's production wiring (cron jobs, HTTP health endpoints,
 * Stripe reporter) will call these methods directly.
 *
 * Callers pass `rootDir` on each method so a single orchestrator can serve
 * multiple workspaces if needed (future multi-tenant ops deployments).
 */

/**
 * @param {Object} [init]
 * @param {import("./types.js").RetentionPolicy[]} [init.retentionPolicies]
 * @param {(rootDir, tenantId) => Array<{data_class, rel_path}>} [init.tenantDirs]
 * @param {string[]} [init.backupExclude]
 */
export function createReleaseOrchestrator(init = {}) {
  // These stores are stateless across calls — factory kept for DI parity.
  const meterFactory = (rootDir) => createUsageMeter(rootDir);
  const retention = createRetentionEngine({ policies: init.retentionPolicies || DEFAULT_RETENTION_POLICIES });
  const compliance = createComplianceService({ tenantDirs: init.tenantDirs });
  const readiness = createReadinessAggregator();
  const backup = createBackupService({ exclude: init.backupExclude });

  return {
    // Expose the stores for low-level access (admin + tests)
    retention, compliance, readiness, backup,
    meter: (rootDir) => meterFactory(rootDir),

    /**
     * Record one usage event.
     */
    async recordUsage(rootDir, input) {
      return meterFactory(rootDir).record(input);
    },

    /**
     * Produce rollups for reporting / Stripe export.
     */
    async runDailyMetering(rootDir, { tenant_id, since, until } = {}) {
      return meterFactory(rootDir).rollup({ period_kind: "day", tenant_id, since, until });
    },

    /**
     * Dry-run retention across all classes.
     */
    async scanRetention(rootDir) {
      return retention.dryRun(rootDir);
    },

    /**
     * Apply retention with explicit confirmation.
     */
    async applyRetention(rootDir, opts) {
      return retention.apply(rootDir, opts);
    },

    /**
     * Route a compliance request end-to-end.
     */
    async handleComplianceRequest(rootDir, input) {
      return compliance.handleRequest(rootDir, input);
    },

    /**
     * Register a named readiness probe.
     */
    registerProbe(name, probe) {
      return readiness.register(name, probe);
    },

    /**
     * Aggregate all readiness probes into one HealthReport.
     */
    async assembleHealthReport() {
      return readiness.assemble();
    },

    /**
     * Take a workspace backup manifest snapshot.
     */
    async snapshotBackup(rootDir) {
      return backup.snapshot(rootDir);
    },

    async verifyBackup(rootDir, manifest) {
      return backup.verify(rootDir, manifest);
    },

    async listBackups(rootDir) {
      return backup.list(rootDir);
    },
  };
}
