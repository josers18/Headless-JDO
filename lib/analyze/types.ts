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

/**
 * Model detail — what the main column on /analyze/[modelId] renders at
 * the top. Richer than the sidebar summary because this is the focus
 * of the page.
 */
export type SemanticModelProfile = {
  id: string;
  apiName: string;
  label: string;
  description?: string;
  /**
   * Free-form "business preferences" guidance string the SDM author
   * provides; often contains #-prefixed hints the Analytics Agent uses.
   */
  businessPreferences?: string;
  dataspace?: string;
  lastModifiedDate?: string;
  categories: string[];
};

/**
 * Named metric attached to a semantic model. Populated from
 * list_semantic_model_metrics and rendered as a clickable pill in the
 * main column. Clicking a pill pre-fills the Ask bar (T2-3+).
 */
export type SemanticModelMetric = {
  apiName: string;
  label: string;
  description?: string;
};
