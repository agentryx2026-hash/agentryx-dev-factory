/**
 * Artifact types — JSDoc shapes for the artifact store.
 *
 * An artifact is a typed, content-addressed unit of work produced by an agent.
 * The manifest entry lives in index.jsonl; the content lives in a separate file.
 */

/**
 * @typedef {"code_output"|"test_output"|"qa_report"|"triage_spec"|"research_dossier"|"architect_review"|"deploy_status"|"pmd_doc"|"raw_extraction"} ArtifactKind
 */

/**
 * @typedef {Object} ArtifactProvenance
 * @property {string} [agent]       e.g. "troi", "picard", "genovi"
 * @property {string} [node]        e.g. "troiBackendNode"
 * @property {string} [model]       e.g. "openrouter:anthropic/claude-sonnet-4-5"
 * @property {string} [run_id]      correlates all artifacts of one pipeline run
 * @property {number} [iteration]   for retry loops
 */

/**
 * @typedef {Object} Artifact
 * @property {string} id                      e.g. "ART-0042"
 * @property {ArtifactKind} kind
 * @property {number} schema_version          default 1
 * @property {ArtifactProvenance} produced_by
 * @property {string} produced_at             ISO 8601 UTC
 * @property {number} [cost_usd]
 * @property {number} [latency_ms]
 * @property {string} content_ref             relative path inside _artifacts/
 * @property {string} content_sha256          hex digest of file content
 * @property {string[]} [parent_ids]          upstream artifacts that fed this one
 * @property {string[]} [tags]
 * @property {Record<string,any>} [meta]      free-form extension
 */

/**
 * @typedef {Object} WriteArtifactInput
 * @property {ArtifactKind} kind
 * @property {string|object} content           string saved as .md, object saved as .json
 * @property {ArtifactProvenance} [produced_by]
 * @property {number} [cost_usd]
 * @property {number} [latency_ms]
 * @property {string[]} [parent_ids]
 * @property {string[]} [tags]
 * @property {Record<string,any>} [meta]
 */

export const SCHEMA_VERSION = 1;

export const ARTIFACT_KINDS = Object.freeze([
  "code_output",
  "test_output",
  "qa_report",
  "triage_spec",
  "research_dossier",
  "architect_review",
  "deploy_status",
  "pmd_doc",
  "raw_extraction",
]);

export function isValidKind(k) {
  return ARTIFACT_KINDS.includes(k);
}
