/**
 * Renderers — convert TrainingArtifact content into the final form that
 * external consumers (humans reading markdown; Phase 17 video pipeline)
 * want to see.
 *
 * Generators already produce content in the target format for their kind
 * (markdown strings for prose kinds, structured objects for voiceover/
 * storyboard). The renderer adds:
 *   - a human-facing summary (used by the Verify portal + CLI)
 *   - a Phase-17-ready payload for voiceover/storyboard kinds that splits
 *     the script into the fields ElevenLabs and the headless-browser
 *     renderer need
 *   - a SRT-like captions text so the video pipeline has a subtitles file
 */

import { formatFor, isValidKind } from "./types.js";

/**
 * Human-facing summary line for any artifact + content pair.
 * Used by the Verify portal index and the training-gen CLI.
 */
export function summarize(record, content) {
  if (!record) return "";
  switch (record.kind) {
    case "user_guide":
    case "quick_start":
    case "how_to":
    case "reference_doc": {
      const firstLine = typeof content === "string"
        ? content.split("\n", 1)[0].replace(/^#+\s*/, "")
        : record.title;
      return firstLine;
    }
    case "voiceover_script": {
      const count = content?.beats?.length || 0;
      const total = (content?.beats || []).reduce((a, b) => a + (b.target_duration_ms || 0), 0);
      return `${record.title} — ${count} beats, ~${Math.round(total / 1000)}s`;
    }
    case "video_storyboard": {
      const count = content?.beats?.length || 0;
      return `${record.title} — ${count} scenes`;
    }
    default:
      return record.title;
  }
}

/**
 * Convert milliseconds into SRT timestamp (HH:MM:SS,mmm).
 */
function msToSrtTime(ms) {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/**
 * Build an SRT captions file from a voiceover_script.
 *
 * Each beat becomes one caption entry. Timing is cumulative by
 * target_duration_ms — accurate enough for Phase 17's first render pass;
 * re-timing can happen after real ElevenLabs duration is known.
 */
export function captionsFromVoiceover(voiceoverContent) {
  if (!voiceoverContent?.beats) return "";
  const lines = [];
  let cursor = 0;
  voiceoverContent.beats.forEach((beat, i) => {
    const start = cursor;
    const end = cursor + (beat.target_duration_ms || 0);
    cursor = end;
    lines.push(String(i + 1));
    lines.push(`${msToSrtTime(start)} --> ${msToSrtTime(end)}`);
    lines.push((beat.narrator_text || "").replace(/\s+/g, " ").trim());
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Phase 17 consumer payload.
 *
 * @param {Object} record              voiceover_script record
 * @param {Object} content             voiceover_script content
 * @returns {{
 *   narration: Array<{id, text, target_duration_ms}>,
 *   capture_plan: Array<{beat_id, url, selector?, wait?, action?, input?}>,
 *   transitions: Array<{beat_id, transition}>,
 *   captions_srt: string,
 *   total_duration_ms: number,
 * }}
 */
export function renderVoiceoverForPhase17(record, content) {
  if (!record || record.kind !== "voiceover_script") {
    throw new Error("renderVoiceoverForPhase17: record.kind must be voiceover_script");
  }
  const beats = content?.beats || [];
  const narration = beats.map(b => ({
    id: b.id,
    text: (b.narrator_text || "").trim(),
    target_duration_ms: b.target_duration_ms || 0,
  }));
  const capture_plan = beats
    .filter(b => b.screen_capture)
    .map(b => ({
      beat_id: b.id,
      url: b.screen_capture.url,
      selector: b.screen_capture.selector,
      wait: b.screen_capture.wait,
      action: b.screen_capture.action,
      input: b.screen_capture.input,
    }));
  const transitions = beats
    .filter(b => b.transition)
    .map(b => ({ beat_id: b.id, transition: b.transition }));
  const total_duration_ms = narration.reduce((a, n) => a + n.target_duration_ms, 0);

  return {
    narration,
    capture_plan,
    transitions,
    captions_srt: captionsFromVoiceover(content),
    total_duration_ms,
  };
}

/**
 * Markdown rendering for prose kinds. For voiceover/storyboard, returns a
 * human-readable table instead of raw JSON (useful for Verify portal diff).
 */
export function renderMarkdown(record, content) {
  if (!record) return "";
  if (!isValidKind(record.kind)) throw new Error(`renderMarkdown: invalid kind ${record.kind}`);

  if (formatFor(record.kind) === "markdown") {
    return typeof content === "string" ? content : String(content);
  }

  // voiceover_script / video_storyboard — tabular preview
  if (record.kind === "voiceover_script") {
    const beats = content?.beats || [];
    const rows = beats.map(b => [
      b.id,
      `${(b.target_duration_ms || 0) / 1000}s`,
      (b.narrator_text || "").replace(/\|/g, "\\|").replace(/\n/g, " "),
      b.screen_capture?.url || "",
      b.transition || "",
    ].join(" | "));
    return [
      `# ${record.title}`,
      "",
      `**${beats.length} beats, ~${Math.round(beats.reduce((a, b) => a + (b.target_duration_ms || 0), 0) / 1000)}s total**`,
      "",
      "| Beat | Duration | Narration | Capture URL | Transition |",
      "|---|---|---|---|---|",
      ...rows,
    ].join("\n");
  }

  if (record.kind === "video_storyboard") {
    const beats = content?.beats || [];
    const rows = beats.map(b => [
      b.id,
      b.title || "",
      (b.camera_plan || "").replace(/\|/g, "\\|"),
      (b.on_screen_text || "").replace(/\|/g, "\\|"),
    ].join(" | "));
    return [
      `# ${record.title}`,
      "",
      `**${beats.length} scenes**`,
      "",
      "| Beat | Title | Camera plan | On-screen text |",
      "|---|---|---|---|",
      ...rows,
    ].join("\n");
  }

  return `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\``;
}
