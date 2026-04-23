/**
 * HTTP Courier backend — POSTs to Hermes gateway.
 * Phase 10-B will deploy Hermes; 10-A ships this backend as a contract ready to
 * swap-in. Fail-open: gateway unreachable = logged, pipeline continues.
 */

export function createHttpBackend(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.HERMES_GATEWAY_URL;
  if (!baseUrl) throw new Error("createHttpBackend: HERMES_GATEWAY_URL env var required");
  const authToken = opts.auth_token || process.env.HERMES_GATEWAY_TOKEN;
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (authToken) headers["authorization"] = `Bearer ${authToken}`;

  return {
    kind: "http",
    async send(channel, event, target) {
      const url = `${baseUrl}/channels/${encodeURIComponent(channel)}/send`;
      const body = JSON.stringify({
        target: target || null,
        event,
      });
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          return { ok: false, error: `gateway ${res.status}: ${errBody.slice(0, 200)}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message, fail_open: true };
      }
    },
  };
}
