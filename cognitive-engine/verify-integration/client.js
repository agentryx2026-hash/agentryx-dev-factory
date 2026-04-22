/**
 * Pluggable Verify-portal client.
 *
 *   "mock" — default. Stores bundles in memory, returns a deterministic build URL.
 *            Used for Phase 9-A smoke tests + local factory dev.
 *
 *   "http" — Phase 9-B. POSTs to ${VERIFY_URL}/api/projects/{project_id}/builds.
 *            Requires Verify multi-app mode + auth negotiation.
 *
 * Fail-open contract: any client error is captured + logged, pipeline continues.
 */

export function createMockClient() {
  const _store = new Map();
  let _seq = 0;

  return {
    kind: "mock",
    async publishBuild(bundle) {
      _seq += 1;
      const serverBuildId = bundle.build_id;
      _store.set(serverBuildId, { ...bundle, received_at: new Date().toISOString(), seq: _seq });
      return {
        ok: true,
        server_build_id: serverBuildId,
        portal_url: `mock://verify/projects/${bundle.project_id}/builds/${serverBuildId}`,
        received_at: new Date().toISOString(),
      };
    },
    async getPublishedBundle(build_id) {
      return _store.get(build_id) || null;
    },
    _inspectStore() { return Array.from(_store.values()); },
  };
}

export function createHttpClient(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.VERIFY_URL;
  if (!baseUrl) throw new Error("createHttpClient: VERIFY_URL env var required");
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (opts.auth_token) headers["authorization"] = `Bearer ${opts.auth_token}`;

  return {
    kind: "http",
    async publishBuild(bundle) {
      const url = `${baseUrl}/api/projects/${encodeURIComponent(bundle.project_id)}/builds`;
      try {
        const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(bundle) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false, status: res.status, error: body.error || res.statusText };
        }
        return { ok: true, server_build_id: body.build_id || bundle.build_id, portal_url: body.portal_url, received_at: body.received_at };
      } catch (err) {
        return { ok: false, error: err.message, fail_open: true };
      }
    },
  };
}

export function getVerifyClient(opts = {}) {
  const kind = opts.kind || process.env.VERIFY_CLIENT || "mock";
  if (kind === "mock") return createMockClient();
  if (kind === "http") return createHttpClient(opts);
  throw new Error(`unknown VERIFY_CLIENT: ${kind}`);
}

export function isEnabled() {
  return process.env.USE_VERIFY_INTEGRATION === "true";
}
