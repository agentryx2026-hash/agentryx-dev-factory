import path from "node:path";
import os from "node:os";
import { createFilesystemBackend } from "./backends/filesystem.js";

const DEFAULT_ROOT = path.join(
  process.env.HOME || os.homedir() || "/tmp",
  "Projects",
  "agent-workspace",
  "_factory-memory"
);

/**
 * Factory for the configured MemoryService backend.
 * Reads MEMORY_BACKEND env (default "filesystem").
 * Reads FACTORY_MEMORY_ROOT env (default ~/Projects/agent-workspace/_factory-memory).
 */
export function getMemoryService(opts = {}) {
  const backend = opts.backend || process.env.MEMORY_BACKEND || "filesystem";
  const rootDir = opts.rootDir || process.env.FACTORY_MEMORY_ROOT || DEFAULT_ROOT;

  switch (backend) {
    case "filesystem":
      return createFilesystemBackend(rootDir);
    case "sqlite":
      throw new Error("sqlite backend not implemented yet (Phase 7-B)");
    case "postgres":
      throw new Error("postgres backend not implemented yet (Phase 7-C)");
    case "vector":
      throw new Error("vector backend not implemented yet (Phase 7-D)");
    default:
      throw new Error(`unknown MEMORY_BACKEND: ${backend}`);
  }
}

export function isEnabled() {
  return process.env.USE_MEMORY_LAYER === "true";
}
