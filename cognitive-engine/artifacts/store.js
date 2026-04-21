import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ARTIFACT_KINDS, SCHEMA_VERSION, isValidKind } from "./types.js";

const DIR_NAME = "_artifacts";
const INDEX_FILE = "index.jsonl";

function storeDir(projectDir) {
  return path.join(projectDir, DIR_NAME);
}

function indexPath(projectDir) {
  return path.join(storeDir(projectDir), INDEX_FILE);
}

async function ensureStore(projectDir) {
  await fs.mkdir(storeDir(projectDir), { recursive: true });
  try {
    await fs.access(indexPath(projectDir));
  } catch {
    await fs.writeFile(indexPath(projectDir), "", "utf-8");
  }
}

async function readIndex(projectDir) {
  await ensureStore(projectDir);
  const raw = await fs.readFile(indexPath(projectDir), "utf-8");
  if (!raw.trim()) return [];
  return raw
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

async function nextId(projectDir) {
  const entries = await readIndex(projectDir);
  const maxN = entries
    .map(e => parseInt(String(e.id).replace(/^ART-/, ""), 10))
    .filter(n => !isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  const next = maxN + 1;
  return `ART-${String(next).padStart(4, "0")}`;
}

function pickExtension(kind, content) {
  if (typeof content === "string") return ".md";
  return ".json";
}

function serializeContent(content) {
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2);
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * @param {string} projectDir
 * @param {import("./types.js").WriteArtifactInput} input
 * @returns {Promise<import("./types.js").Artifact>}
 */
export async function writeArtifact(projectDir, input) {
  if (!isValidKind(input.kind)) {
    throw new Error(`invalid artifact kind: ${input.kind}. Valid: ${ARTIFACT_KINDS.join(",")}`);
  }
  await ensureStore(projectDir);

  const id = await nextId(projectDir);
  const ext = pickExtension(input.kind, input.content);
  const contentFile = `${id}${ext}`;
  const contentRef = contentFile;
  const absContentPath = path.join(storeDir(projectDir), contentFile);
  const serialized = serializeContent(input.content);

  await fs.writeFile(absContentPath, serialized, "utf-8");

  const record = {
    id,
    kind: input.kind,
    schema_version: SCHEMA_VERSION,
    produced_by: input.produced_by || {},
    produced_at: new Date().toISOString(),
    content_ref: contentRef,
    content_sha256: sha256(Buffer.from(serialized, "utf-8")),
  };
  if (input.cost_usd != null) record.cost_usd = input.cost_usd;
  if (input.latency_ms != null) record.latency_ms = input.latency_ms;
  if (input.parent_ids?.length) record.parent_ids = input.parent_ids;
  if (input.tags?.length) record.tags = input.tags;
  if (input.meta) record.meta = input.meta;

  await fs.appendFile(indexPath(projectDir), JSON.stringify(record) + "\n", "utf-8");
  return record;
}

export async function listArtifacts(projectDir, { kind } = {}) {
  const all = await readIndex(projectDir);
  if (!kind) return all;
  return all.filter(a => a.kind === kind);
}

export async function getArtifact(projectDir, id) {
  const all = await readIndex(projectDir);
  const record = all.find(a => a.id === id);
  if (!record) return null;
  const absContentPath = path.join(storeDir(projectDir), record.content_ref);
  const content = await fs.readFile(absContentPath, "utf-8");
  return { record, content };
}

export async function verifyArtifact(projectDir, id) {
  const entry = await getArtifact(projectDir, id);
  if (!entry) return { ok: false, reason: "not_found" };
  const actualSha = sha256(Buffer.from(entry.content, "utf-8"));
  if (actualSha !== entry.record.content_sha256) {
    return { ok: false, reason: "sha_mismatch", expected: entry.record.content_sha256, actual: actualSha };
  }
  return { ok: true };
}

export function isEnabled() {
  return process.env.USE_ARTIFACT_STORE === "true";
}
