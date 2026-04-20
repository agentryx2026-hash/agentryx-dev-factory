// Config loader. JSON for 2A scaffold (zero deps). YAML upgrade tracked as
// optional stretch; JSON is sufficient for machine-written config and Phase 12
// admin UI will edit via a database-backed schema anyway.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Walk upward from this file until we find the repo root (marked by a `configs/` dir
// alongside `llm-router/`). This makes the loader work regardless of cwd.
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, 'configs', 'llm-routing.json'))) return dir;
    dir = resolve(dir, '..');
  }
  throw new Error('Could not find configs/llm-routing.json walking up from ' + __dirname);
}

let _cache = null;
let _pricesCache = null;

export function loadConfig({ force = false } = {}) {
  if (_cache && !force) return _cache;
  const root = findRepoRoot();
  const path = resolve(root, 'configs', 'llm-routing.json');
  const raw = readFileSync(path, 'utf8');
  _cache = JSON.parse(raw);
  validateConfig(_cache);
  return _cache;
}

export function loadPrices({ force = false } = {}) {
  if (_pricesCache && !force) return _pricesCache;
  const root = findRepoRoot();
  const path = resolve(root, 'configs', 'llm-prices.json');
  const raw = readFileSync(path, 'utf8');
  _pricesCache = JSON.parse(raw);
  return _pricesCache;
}

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('llm-routing.json must be an object');
  if (!cfg.tasks || typeof cfg.tasks !== 'object') {
    throw new Error('llm-routing.json must have a "tasks" object');
  }
  for (const [name, t] of Object.entries(cfg.tasks)) {
    if (!t.primary) throw new Error(`task "${name}" missing "primary"`);
    if (t.fallbacks && !Array.isArray(t.fallbacks)) {
      throw new Error(`task "${name}": fallbacks must be an array`);
    }
  }
}
