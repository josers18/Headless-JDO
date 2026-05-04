/**
 * Shared types for the Analyze surface.
 *
 * The Tableau Next `list_semantic_models` response on this org has 18
 * fields per model; we flatten to what the UI actually renders, plus a
 * pass-through raw bag for future polish without reshaping the API.
 */

export type SemanticModelSummary = {
  /** Stable ID — the URL segment on /analyze/[modelId]. */
  id: string;
  /** API name (e.g. Agentforce_Interactions_Explorer_Semantic_Model). */
  apiName: string;
  /** Human-readable label for the picker. */
  label: string;
  /** Optional business description. */
  description?: string;
  /** Dataspace the SDM lives in (default: "default"). */
  dataspace?: string;
  /** ISO timestamp from Tableau. */
  lastModifiedDate?: string;
  /** Categories (e.g. ["Banking", "Sales"]). Empty when unscoped. */
  categories: string[];
};
