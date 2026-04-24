/**
 * Capture backends — CaptureBackend contract (D154, D155).
 *
 * Each backend's `capture(cue, opts) → {image_ref, width, height, cost_usd?}`
 * is invoked per beat that carries a `screen_capture` cue. Output is a PNG or
 * JPG inside the render's capture/ directory.
 *
 * 17-A ships null + two stubs (puppeteer, playwright). 17-B will replace the
 * stubs with real browser automation.
 */

import fs from "node:fs/promises";
import path from "node:path";

async function writeAssetFile(outDir, filename, body) {
  await fs.mkdir(outDir, { recursive: true });
  const fullPath = path.join(outDir, filename);
  await fs.writeFile(fullPath, body, "utf-8");
  return path.basename(fullPath);
}

/**
 * Null capture backend — writes a 0-byte marker per cue.
 */
export function createNullCaptureBackend() {
  return {
    id: "capture:null",
    async capture(cue, opts = {}) {
      const beatId = opts.beat_id || "UNKNOWN";
      const filename = `${beatId}.null`;
      await writeAssetFile(opts.out_dir || ".", filename, `null-capture:${beatId}\n`);
      return { image_ref: filename, width: 0, height: 0, cost_usd: 0 };
    },
  };
}

function stubCaptureMetadata(cue, { width, height, backend }) {
  return {
    kind: "stub-image",
    backend,
    url: cue.url,
    selector: cue.selector,
    wait: cue.wait,
    action: cue.action,
    input: cue.input,
    width,
    height,
  };
}

/**
 * Stub Puppeteer capture — writes JSON metadata (no actual browser launch).
 *
 * Opts:
 *   width   default 1280
 *   height  default 720
 *   price_per_capture_usd default 0 (local Chromium is free)
 */
export function createStubPuppeteerBackend(init = {}) {
  const width = init.width ?? 1280;
  const height = init.height ?? 720;
  const priceUsd = init.price_per_capture_usd ?? 0;
  return {
    id: `capture:stub:puppeteer:${width}x${height}`,
    async capture(cue, opts = {}) {
      const beatId = opts.beat_id || "UNKNOWN";
      const filename = `${beatId}.stub.json`;
      const payload = stubCaptureMetadata(cue, { width, height, backend: "puppeteer" });
      await writeAssetFile(opts.out_dir || ".", filename, JSON.stringify(payload, null, 2) + "\n");
      return { image_ref: filename, width, height, cost_usd: priceUsd };
    },
  };
}

/**
 * Stub Playwright capture — identical semantics, different provider id so
 * registries can mount both and tests can swap between them.
 *
 * Opts:
 *   width   default 1280
 *   height  default 720
 *   price_per_capture_usd default 0
 */
export function createStubPlaywrightBackend(init = {}) {
  const width = init.width ?? 1280;
  const height = init.height ?? 720;
  const priceUsd = init.price_per_capture_usd ?? 0;
  return {
    id: `capture:stub:playwright:${width}x${height}`,
    async capture(cue, opts = {}) {
      const beatId = opts.beat_id || "UNKNOWN";
      const filename = `${beatId}.stub.json`;
      const payload = stubCaptureMetadata(cue, { width, height, backend: "playwright" });
      await writeAssetFile(opts.out_dir || ".", filename, JSON.stringify(payload, null, 2) + "\n");
      return { image_ref: filename, width, height, cost_usd: priceUsd };
    },
  };
}

export const DEFAULT_CAPTURE_BACKENDS = Object.freeze({
  "capture:null":                                  createNullCaptureBackend,
  "capture:stub:puppeteer:1280x720":               createStubPuppeteerBackend,
  "capture:stub:playwright:1280x720":              createStubPlaywrightBackend,
});
