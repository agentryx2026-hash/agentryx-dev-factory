import fs from "node:fs/promises";
import path from "node:path";
import { SCHEMA_VERSION, isValidKind, isValidScope } from "../types.js";

const INDEX_FILE = "index.jsonl";

function vaultDir(rootDir) {
  return rootDir;
}

function scopeDir(rootDir, scope) {
  if (scope === "global") return path.join(rootDir, "global");
  const [kind, id] = scope.split(":", 2);
  if (kind === "agent") return path.join(rootDir, "agents", id);
  if (kind === "project") return path.join(rootDir, "projects", id);
  throw new Error(`unknown scope format: ${scope}`);
}

function indexPath(rootDir) {
  return path.join(rootDir, INDEX_FILE);
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function ensureVault(rootDir) {
  await fs.mkdir(rootDir, { recursive: true });
  try {
    await fs.access(indexPath(rootDir));
  } catch {
    await fs.writeFile(indexPath(rootDir), "", "utf-8");
  }
}

async function readIndex(rootDir) {
  await ensureVault(rootDir);
  const raw = await fs.readFile(indexPath(rootDir), "utf-8");
  if (!raw.trim()) return [];
  return raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
}

async function nextId(rootDir) {
  const entries = await readIndex(rootDir);
  const maxN = entries
    .map(e => parseInt(String(e.id).replace(/^OBS-/, ""), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `OBS-${String(maxN + 1).padStart(4, "0")}`;
}

function renderMarkdown(record) {
  const frontMatter = [
    "---",
    `id: ${record.id}`,
    `kind: ${record.kind}`,
    `schema_version: ${record.schema_version}`,
    `scope: ${record.scope}`,
    `produced_at: ${record.produced_at}`,
    record.tags?.length ? `tags: [${record.tags.map(t => `"${t}"`).join(", ")}]` : null,
    record.produced_by ? `produced_by: ${JSON.stringify(record.produced_by)}` : null,
    record.refs ? `refs: ${JSON.stringify(record.refs)}` : null,
    "---",
    "",
  ].filter(Boolean).join("\n");
  return `${frontMatter}\n${record.content}\n`;
}

export function createFilesystemBackend(rootDir) {
  return {
    /**
     * @param {import("../types.js").AddObservationInput} input
     * @returns {Promise<import("../types.js").Observation>}
     */
    async addObservation(input) {
      if (!isValidKind(input.kind)) throw new Error(`invalid kind: ${input.kind}`);
      if (!isValidScope(input.scope)) throw new Error(`invalid scope: ${input.scope}`);
      if (!input.content?.trim()) throw new Error("content is required");
      await ensureVault(rootDir);

      const id = await nextId(rootDir);
      const produced_at = new Date().toISOString();
      const record = {
        id,
        kind: input.kind,
        schema_version: SCHEMA_VERSION,
        scope: input.scope,
        content: input.content,
        produced_at,
      };
      if (input.tags?.length) record.tags = input.tags;
      if (input.refs) record.refs = input.refs;
      if (input.produced_by) record.produced_by = input.produced_by;

      const dir = scopeDir(rootDir, input.scope);
      await fs.mkdir(dir, { recursive: true });
      const slug = slugify(input.content.split("\n")[0]);
      const filename = `${id}${slug ? "-" + slug : ""}.md`;
      await fs.writeFile(path.join(dir, filename), renderMarkdown(record), "utf-8");

      const indexEntry = { ...record, _path: path.relative(rootDir, path.join(dir, filename)) };
      await fs.appendFile(indexPath(rootDir), JSON.stringify(indexEntry) + "\n", "utf-8");
      return record;
    },

    /**
     * @param {import("../types.js").RecallFilter} [filter]
     * @returns {Promise<import("../types.js").Observation[]>}
     */
    async recall(filter = {}) {
      const all = await readIndex(rootDir);
      let results = all;

      if (filter.scope) {
        results = results.filter(o =>
          filter.scope.endsWith(":")
            ? o.scope.startsWith(filter.scope)
            : o.scope === filter.scope
        );
      }
      if (filter.kind) results = results.filter(o => o.kind === filter.kind);
      if (filter.tags?.length) {
        results = results.filter(o =>
          filter.tags.every(t => (o.tags || []).includes(t))
        );
      }
      if (filter.text) {
        const needle = filter.text.toLowerCase();
        results = results.filter(o => String(o.content).toLowerCase().includes(needle));
      }
      const limit = filter.limit ?? 20;
      return results.slice(-limit).reverse();
    },

    async listForScope(scope) {
      const all = await readIndex(rootDir);
      return all.filter(o => o.scope === scope);
    },

    async getById(id) {
      const all = await readIndex(rootDir);
      const entry = all.find(o => o.id === id);
      if (!entry) return null;
      const fullPath = path.join(rootDir, entry._path);
      const content = await fs.readFile(fullPath, "utf-8");
      return { record: entry, markdown: content };
    },
  };
}
