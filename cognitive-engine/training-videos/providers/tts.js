/**
 * TTS providers — TtsProvider contract (D154, D155).
 *
 * Each provider's `synth(beat, opts) → {audio_ref, actual_duration_ms, cost_usd}`
 * is invoked per narration beat. The renderer supplies an `out_dir` via opts
 * where the provider writes its audio asset (or marker file for null).
 *
 * 17-A ships three variants per category (stub-elevenlabs, stub-openai, null).
 * 17-B replaces them with real backends sharing the same interface.
 */

import fs from "node:fs/promises";
import path from "node:path";

// Crude but consistent: words-per-minute estimate for fallback durations.
const AVG_WPM = 150;
const MS_PER_WORD = (60 * 1000) / AVG_WPM;

function estimateDurationMsFromText(text, fallback) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return typeof fallback === "number" ? fallback : 2000;
  return Math.round(words * MS_PER_WORD);
}

async function writeAssetFile(outDir, filename, body) {
  await fs.mkdir(outDir, { recursive: true });
  const fullPath = path.join(outDir, filename);
  await fs.writeFile(fullPath, body, "utf-8");
  return path.basename(fullPath);
}

/**
 * Null TTS provider — writes a tiny marker file; zero cost, zero bytes.
 * Useful for tests that don't care about audio presence.
 */
export function createNullTtsProvider() {
  return {
    id: "tts:null",
    async synth(beat, opts = {}) {
      const filename = `${beat.id}.null`;
      await writeAssetFile(opts.out_dir || ".", filename, `null-tts:${beat.id}\n`);
      return {
        audio_ref: filename,
        actual_duration_ms: beat.target_duration_ms || 0,
        cost_usd: 0,
      };
    },
  };
}

/**
 * Stub ElevenLabs provider — writes a JSON metadata file shaped like what the
 * real ElevenLabs client would return (voice id, model, character count,
 * synthesis timing). Duration is estimated from word count. Cost is a rough
 * approximation of ElevenLabs' character-based pricing.
 *
 * Opts:
 *   voice_id    default "rachel"
 *   model_id    default "eleven_monolingual_v2"
 *   price_per_char_usd default 0.00003 (~$30 per 1M chars for the Creator tier)
 */
export function createStubElevenLabsProvider(init = {}) {
  const voiceId = init.voice_id || "rachel";
  const modelId = init.model_id || "eleven_monolingual_v2";
  const pricePerChar = init.price_per_char_usd ?? 0.00003;

  return {
    id: `tts:stub:elevenlabs:${voiceId}`,
    async synth(beat, opts = {}) {
      const text = beat.narrator_text || "";
      const chars = text.length;
      const duration = estimateDurationMsFromText(text, beat.target_duration_ms);
      const filename = `${beat.id}.stub.json`;
      const payload = {
        kind: "stub-audio",
        provider: "elevenlabs",
        voice_id: voiceId,
        model_id: modelId,
        beat_id: beat.id,
        narrator_text: text,
        estimated_duration_ms: duration,
        target_duration_ms: beat.target_duration_ms,
        char_count: chars,
      };
      await writeAssetFile(opts.out_dir || ".", filename, JSON.stringify(payload, null, 2) + "\n");
      return {
        audio_ref: filename,
        actual_duration_ms: duration,
        cost_usd: Math.round(chars * pricePerChar * 1_000_000) / 1_000_000,
        voice_metadata: { voice_id: voiceId, model_id: modelId },
      };
    },
  };
}

/**
 * Stub OpenAI TTS provider — same contract, different cost model.
 *
 * Opts:
 *   voice        default "alloy"
 *   model        default "tts-1"
 *   price_per_char_usd default 0.000015 (~$15 per 1M chars on tts-1)
 */
export function createStubOpenAiProvider(init = {}) {
  const voice = init.voice || "alloy";
  const model = init.model || "tts-1";
  const pricePerChar = init.price_per_char_usd ?? 0.000015;

  return {
    id: `tts:stub:openai:${model}:${voice}`,
    async synth(beat, opts = {}) {
      const text = beat.narrator_text || "";
      const chars = text.length;
      const duration = estimateDurationMsFromText(text, beat.target_duration_ms);
      const filename = `${beat.id}.stub.json`;
      const payload = {
        kind: "stub-audio",
        provider: "openai",
        model,
        voice,
        beat_id: beat.id,
        narrator_text: text,
        estimated_duration_ms: duration,
        target_duration_ms: beat.target_duration_ms,
        char_count: chars,
      };
      await writeAssetFile(opts.out_dir || ".", filename, JSON.stringify(payload, null, 2) + "\n");
      return {
        audio_ref: filename,
        actual_duration_ms: duration,
        cost_usd: Math.round(chars * pricePerChar * 1_000_000) / 1_000_000,
        voice_metadata: { model, voice },
      };
    },
  };
}

export const DEFAULT_TTS_PROVIDERS = Object.freeze({
  "tts:null":                                createNullTtsProvider,
  "tts:stub:elevenlabs:rachel":              createStubElevenLabsProvider,
  "tts:stub:openai:tts-1:alloy":             createStubOpenAiProvider,
});
