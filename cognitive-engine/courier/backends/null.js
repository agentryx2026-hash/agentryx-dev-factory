/**
 * Null Courier backend — discards all events silently.
 * For deployments where outbound comms are intentionally disabled
 * (air-gapped factory, compliance lockdown, CI that must not ping Slack, etc.).
 */

export function createNullBackend() {
  let _count = 0;
  return {
    kind: "null",
    async send(_channel, _event, _target) {
      _count += 1;
      return { ok: true };
    },
    _count() { return _count; },
  };
}
