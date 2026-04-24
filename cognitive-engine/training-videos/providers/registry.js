/**
 * Provider registry — three categories (tts, capture, stitcher), each with
 * its own map of `id → instance`.
 *
 * D154: RenderJob carries provider *ids*, not function references, so the
 * job is serialisable (survives Phase 14-A queue round-trip). The registry
 * resolves ids to instances at render-time.
 */

import { DEFAULT_TTS_PROVIDERS } from "./tts.js";
import { DEFAULT_CAPTURE_BACKENDS } from "./capture.js";
import { DEFAULT_STITCHERS } from "./stitcher.js";
import { PROVIDER_CATEGORIES, isValidCategory } from "../types.js";

/**
 * @param {Object} [init]
 * @param {boolean} [init.defaults=true]  register the null + stub backends per category
 */
export function createProviderRegistry({ defaults = true } = {}) {
  const maps = {
    tts: new Map(),
    capture: new Map(),
    stitcher: new Map(),
  };

  if (defaults) {
    for (const [id, factory] of Object.entries(DEFAULT_TTS_PROVIDERS)) {
      maps.tts.set(id, factory());
    }
    for (const [id, factory] of Object.entries(DEFAULT_CAPTURE_BACKENDS)) {
      maps.capture.set(id, factory());
    }
    for (const [id, factory] of Object.entries(DEFAULT_STITCHERS)) {
      maps.stitcher.set(id, factory());
    }
  }

  return {
    register(category, instance) {
      if (!isValidCategory(category)) throw new Error(`registry.register: invalid category ${category}`);
      if (!instance?.id) throw new Error("registry.register: instance.id required");
      const expectedMethod = methodForCategory(category);
      if (typeof instance[expectedMethod] !== "function") {
        throw new Error(`registry.register: ${category} instance must implement ${expectedMethod}()`);
      }
      maps[category].set(instance.id, instance);
    },

    get(category, id) {
      if (!isValidCategory(category)) throw new Error(`registry.get: invalid category ${category}`);
      return maps[category].get(id) || null;
    },

    has(category, id) {
      return isValidCategory(category) && maps[category].has(id);
    },

    list(category) {
      if (!isValidCategory(category)) throw new Error(`registry.list: invalid category ${category}`);
      return [...maps[category].keys()];
    },

    /** Resolve a full ProviderChoice → concrete instances, throwing on missing ids. */
    resolve({ tts, capture, stitcher }) {
      const out = {};
      for (const [category, id] of Object.entries({ tts, capture, stitcher })) {
        const instance = maps[category].get(id);
        if (!instance) throw new Error(`registry.resolve: unknown ${category} provider "${id}"`);
        out[category] = instance;
      }
      return out;
    },

    categories() { return PROVIDER_CATEGORIES.slice(); },
  };
}

function methodForCategory(category) {
  if (category === "tts") return "synth";
  if (category === "capture") return "capture";
  if (category === "stitcher") return "assemble";
  return "";
}
