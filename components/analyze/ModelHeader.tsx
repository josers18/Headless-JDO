import type { SemanticModelProfile } from "@/lib/analyze/types";
import { BusinessPreferencesPanel } from "./BusinessPreferencesPanel";

/**
 * Server-rendered model profile block. Sits at the top of
 * /analyze/[modelId]. Shows label, description, categories, and the
 * model's "business preferences" hint string when present.
 *
 * Per Q-T2-2-a = C: rendered server-side so first paint is complete
 * (no loading shimmer for the profile itself). The slower metrics
 * fetch runs client-side in ModelMetricsPills.
 */
export function ModelHeader({ profile }: { profile: SemanticModelProfile }) {
  return (
    <section className="mt-8 animate-fade-rise">
      <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
        Model
      </div>
      <h1 className="mt-2 font-display text-2xl tracking-tight text-text md:text-3xl">
        {profile.label}
      </h1>
      {profile.description && (
        <p className="mt-3 max-w-2xl text-[14px] text-text-muted">
          {profile.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span>
          <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-text">
            {profile.apiName}
          </code>
        </span>
        {profile.dataspace && (
          <span>
            dataspace ·{" "}
            <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-text">
              {profile.dataspace}
            </code>
          </span>
        )}
        {profile.categories.length > 0 && (
          <span>categories · {profile.categories.join(", ")}</span>
        )}
        {profile.lastModifiedDate && (
          <span>
            updated · {new Date(profile.lastModifiedDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {profile.businessPreferences && (
        <BusinessPreferencesPanel value={profile.businessPreferences} />
      )}
    </section>
  );
}
