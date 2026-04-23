/**
 * Template-based training generators — one per TrainingKind.
 *
 * D148: Each generator is a pure function:
 *
 *   generator(ctx: ProjectContext, opts?: object) → Promise<GeneratorOutput>
 *
 *   GeneratorOutput = {
 *     title: string,
 *     content: string | object,         // string → markdown, object → json payload
 *     parent_ids?: string[],             // upstream TART ids (storyboard parents voiceover)
 *     meta?: Record<string, any>,
 *     tags?: string[],
 *   }
 *
 * 16-A implementations produce useful scaffolding (titles, section headers, beat
 * skeletons, feature lists, cue templates) but not publication-ready prose.
 * 16-B swaps template generators for LLM-backed ones behind the same interface.
 *
 * Registry:
 *   createGeneratorRegistry({ defaults: true }) → { register, get, has, list }
 *   The default set is 6 template generators matching the 6 TrainingKinds.
 */

import { isValidKind, TRAINING_KINDS } from "./types.js";

const DEFAULT_BEAT_DURATION_MS = 6000;

function firstParagraph(text) {
  if (!text) return "";
  return String(text).split("\n\n", 1)[0].trim();
}

function bulletList(items) {
  return (items || []).map(x => `- ${x}`).join("\n");
}

function baseUrlFromRuntime(runtime) {
  return runtime?.base_url || "http://localhost:3000";
}

// ---------------------------------------------------------------------------
// user_guide — long-form markdown walkthrough
// ---------------------------------------------------------------------------
function userGuideTemplate(ctx /*, opts */) {
  const features = ctx.features || [];
  const sections = features.map(f => [
    `## ${f.title}`,
    "",
    f.description ? firstParagraph(f.description) : "_(feature description pending)_",
    "",
    f.entry_points?.length ? `**Entry points:** ${f.entry_points.map(e => "`" + e + "`").join(", ")}` : null,
    "",
  ].filter(v => v !== null).join("\n")).join("\n");

  const body = [
    `# ${ctx.project_title} — User Guide`,
    "",
    ctx.project_summary ? firstParagraph(ctx.project_summary) : "_(project summary pending)_",
    "",
    "## Features",
    "",
    features.length
      ? bulletList(features.map(f => `**${f.title}** — ${firstParagraph(f.description || "") || "(no description)"}`))
      : "_(no features catalogued)_",
    "",
    sections,
    "",
    "## Next steps",
    "",
    "- Read the quick-start for a 5-minute intro.",
    "- Follow a how-to for your specific task.",
    "- See the reference doc for config details.",
  ].join("\n");

  return {
    title: `${ctx.project_title} — User Guide`,
    content: body,
    meta: { feature_count: features.length },
    tags: ["user-guide"],
  };
}

// ---------------------------------------------------------------------------
// quick_start — task-focused 5-minute onboarding
// ---------------------------------------------------------------------------
function quickStartTemplate(ctx, opts = {}) {
  const baseUrl = baseUrlFromRuntime(ctx.runtime);
  const steps = opts.steps || [
    `Open ${baseUrl} in your browser.`,
    "Sign in (or create an account if this is your first visit).",
    "Take the guided tour from the dashboard.",
    "Try one small task end-to-end.",
    "Bookmark the how-to that matches your daily workflow.",
  ];

  const body = [
    `# ${ctx.project_title} — Quick Start`,
    "",
    "You'll be up and running in about 5 minutes.",
    "",
    "## Steps",
    "",
    steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "## What's next",
    "",
    "- Read a how-to for a specific task.",
    "- Explore the user guide for the full feature tour.",
  ].join("\n");

  return {
    title: `${ctx.project_title} — Quick Start`,
    content: body,
    meta: { step_count: steps.length },
    tags: ["quick-start"],
  };
}

// ---------------------------------------------------------------------------
// how_to — one task, explicit steps
// ---------------------------------------------------------------------------
function howToTemplate(ctx, opts = {}) {
  const feature = opts.feature
    || (ctx.features && ctx.features[0])
    || { id: "FEAT-default", title: "a feature", description: "" };
  const baseUrl = baseUrlFromRuntime(ctx.runtime);
  const steps = opts.steps || [
    `Navigate to ${feature.entry_points?.[0] || baseUrl}.`,
    `Locate the ${feature.title} entry point.`,
    "Follow the on-screen prompts.",
    "Verify the expected outcome.",
  ];

  const body = [
    `# How to use ${feature.title}`,
    "",
    feature.description ? firstParagraph(feature.description) : "",
    "",
    "## Steps",
    "",
    steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    "",
    "## If something goes wrong",
    "",
    "- Re-read the step you were on.",
    "- Check the browser console for errors.",
    "- File an issue or contact support.",
  ].filter(Boolean).join("\n");

  return {
    title: `How to use ${feature.title}`,
    content: body,
    meta: { feature_id: feature.id, step_count: steps.length },
    tags: ["how-to", feature.id].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// reference_doc — API / config reference
// ---------------------------------------------------------------------------
function referenceDocTemplate(ctx, opts = {}) {
  const apis = opts.apis || (ctx.artifacts?.apis || []);
  const configs = opts.configs || (ctx.artifacts?.configs || []);

  const apiSection = apis.length
    ? [
      "## API",
      "",
      apis.map(a => [
        `### \`${a.method || "GET"} ${a.path}\``,
        a.description ? firstParagraph(a.description) : "",
        a.params?.length ? "\n**Parameters**\n" + bulletList(a.params.map(p => `\`${p.name}\` — ${p.description || p.type || "param"}`)) : "",
      ].filter(Boolean).join("\n")).join("\n\n"),
    ].join("\n")
    : "";

  const configSection = configs.length
    ? [
      "## Configuration",
      "",
      configs.map(c => `- \`${c.id}\` — ${c.description || "config entry"}`).join("\n"),
    ].join("\n")
    : "";

  const body = [
    `# ${ctx.project_title} — Reference`,
    "",
    "This doc catalogs the public API and configurable knobs.",
    "",
    apiSection,
    "",
    configSection,
    "",
    !apiSection && !configSection ? "_(no APIs or configs discovered — 16-B will populate from code scan)_" : "",
  ].filter(Boolean).join("\n");

  return {
    title: `${ctx.project_title} — Reference`,
    content: body,
    meta: { api_count: apis.length, config_count: configs.length },
    tags: ["reference"],
  };
}

// ---------------------------------------------------------------------------
// voiceover_script — structured beats (Phase 17 contract)
// ---------------------------------------------------------------------------
function voiceoverScriptTemplate(ctx, opts = {}) {
  const features = ctx.features || [];
  const baseUrl = baseUrlFromRuntime(ctx.runtime);
  const beatDuration = opts.beat_duration_ms ?? DEFAULT_BEAT_DURATION_MS;

  const beats = [];
  beats.push({
    id: "BEAT-1",
    narrator_text: `Welcome to ${ctx.project_title}. ${firstParagraph(ctx.project_summary || "") || "Let's take a quick tour."}`,
    target_duration_ms: beatDuration,
    screen_capture: { url: baseUrl, wait: "networkidle", action: "none" },
    transition: "fade",
  });
  features.slice(0, 5).forEach((f, i) => {
    beats.push({
      id: `BEAT-${i + 2}`,
      narrator_text: `${f.title}. ${firstParagraph(f.description || "") || "A quick look."}`,
      target_duration_ms: beatDuration,
      screen_capture: f.entry_points?.[0]
        ? { url: f.entry_points[0], wait: "networkidle", action: "none" }
        : { url: baseUrl, wait: "networkidle", action: "none" },
      transition: "cut",
    });
  });
  beats.push({
    id: `BEAT-${beats.length + 1}`,
    narrator_text: `That's ${ctx.project_title} in a nutshell. The links below take you to the user guide and the quick-start.`,
    target_duration_ms: beatDuration,
    transition: "fade",
    screen_capture: { url: baseUrl, wait: "networkidle", action: "none" },
  });

  const total_duration_ms = beats.reduce((a, b) => a + (b.target_duration_ms || 0), 0);

  return {
    title: `${ctx.project_title} — Voiceover Script`,
    content: {
      schema_version: 1,
      project_id: ctx.project_id,
      project_title: ctx.project_title,
      beats,
    },
    meta: {
      beat_count: beats.length,
      target_duration_total_ms: total_duration_ms,
      feature_ids: features.slice(0, 5).map(f => f.id),
    },
    tags: ["voiceover", "script"],
  };
}

// ---------------------------------------------------------------------------
// video_storyboard — ordered beats with screen-capture + camera plan
// Depends on (is produced from) a voiceover_script; 16-A's template generator
// will accept a `voiceover_script` payload in `opts.voiceover` if provided.
// ---------------------------------------------------------------------------
function videoStoryboardTemplate(ctx, opts = {}) {
  const voiceoverContent = opts.voiceover?.content || null;
  const voiceoverBeats = voiceoverContent?.beats || [];
  const parentId = opts.voiceover?.record?.id;

  const beats = voiceoverBeats.length
    ? voiceoverBeats.map((b, i) => ({
      id: b.id,
      title: `Scene ${i + 1}`,
      camera_plan: i === 0
        ? "wide establishing shot; app at full screen"
        : i === voiceoverBeats.length - 1
          ? "pull back to full screen; fade to outro card"
          : "focus on the current view; highlight active element if present",
      b_roll_hint: b.screen_capture?.selector ? `highlight element ${b.screen_capture.selector}` : null,
      on_screen_text: (b.narrator_text || "").split(".").slice(0, 1)[0].trim(),
    }))
    : [{
      id: "BEAT-1",
      title: "Scene 1",
      camera_plan: "(no voiceover script supplied — storyboard is a placeholder)",
    }];

  return {
    title: `${ctx.project_title} — Video Storyboard`,
    content: {
      schema_version: 1,
      project_id: ctx.project_id,
      project_title: ctx.project_title,
      beats,
    },
    parent_ids: parentId ? [parentId] : [],
    meta: {
      beat_count: beats.length,
      parented_to_voiceover: Boolean(parentId),
    },
    tags: ["storyboard", "video"],
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const DEFAULT_GENERATORS = Object.freeze({
  user_guide: {
    id: "generator:template:user_guide",
    fn: userGuideTemplate,
  },
  quick_start: {
    id: "generator:template:quick_start",
    fn: quickStartTemplate,
  },
  how_to: {
    id: "generator:template:how_to",
    fn: howToTemplate,
  },
  reference_doc: {
    id: "generator:template:reference_doc",
    fn: referenceDocTemplate,
  },
  voiceover_script: {
    id: "generator:template:voiceover_script",
    fn: voiceoverScriptTemplate,
  },
  video_storyboard: {
    id: "generator:template:video_storyboard",
    fn: videoStoryboardTemplate,
  },
});

/**
 * @param {Object} [init]
 * @param {boolean} [init.defaults=true]  register the 6 template generators
 * @returns {{ register, get, has, list }}
 */
export function createGeneratorRegistry({ defaults = true } = {}) {
  const map = new Map();
  if (defaults) {
    for (const [kind, def] of Object.entries(DEFAULT_GENERATORS)) map.set(kind, def);
  }

  return {
    register(kind, { id, fn }) {
      if (!isValidKind(kind)) throw new Error(`registry.register: invalid kind ${kind}`);
      if (typeof fn !== "function") throw new Error("registry.register: fn required");
      if (!id) throw new Error("registry.register: id required");
      map.set(kind, { id, fn });
    },
    get(kind) { return map.get(kind) || null; },
    has(kind) { return map.has(kind); },
    list() { return TRAINING_KINDS.filter(k => map.has(k)); },
  };
}

export {
  userGuideTemplate,
  quickStartTemplate,
  howToTemplate,
  referenceDocTemplate,
  voiceoverScriptTemplate,
  videoStoryboardTemplate,
};
