/**
 * Fake Courier backend — records events in memory without delivering anywhere.
 * Default for Phase 10-A smoke tests and factory dev. Inspectable via internal APIs.
 */

export function createFakeBackend() {
  const _sent = [];

  return {
    kind: "fake",
    async send(channel, event, target) {
      _sent.push({ channel, target, event, sent_at: new Date().toISOString() });
      return { ok: true };
    },
    _getSent() { return _sent.slice(); },
    _clear() { _sent.length = 0; },
    _count() { return _sent.length; },
    _byChannel() {
      const out = {};
      for (const row of _sent) {
        out[row.channel] = (out[row.channel] || 0) + 1;
      }
      return out;
    },
  };
}
