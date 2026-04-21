"use client";

import { useEffect, useMemo, useState } from "react";
import { Palette, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/client/useTheme";
import {
  FAMILY_LABELS,
  FAMILY_ORDER,
  THEMES,
  type ThemeMeta,
} from "@/lib/themes/registry";

/**
 * THEMES A-3 — Theme Switcher trigger + sheet. A discreet palette button
 * lives in the top-right of the signed-in header; clicking opens a sheet
 * grouped by family. Hovering a tile live-previews the theme on the whole
 * app; clicking commits it + persists to localStorage.
 *
 * Kept bespoke (no modal library) because we want the preview-on-hover
 * behavior which most headless modal kits don't expose cleanly.
 */
export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "dark" | "light" | "bank">("all");
  const { theme, commit, startPreview, stopPreview } = useTheme();

  // Stop any live preview when the sheet closes so we never leave the
  // banker on a different theme than they actually picked.
  useEffect(() => {
    if (!open) stopPreview();
  }, [open, stopPreview]);

  const grouped = useMemo(() => {
    const subset = THEMES.filter((t) => {
      if (filter === "all") return true;
      if (filter === "dark") return t.mode === "dark";
      if (filter === "light") return t.mode === "light";
      return Boolean(t.institution);
    });
    const byFamily = new Map<string, ThemeMeta[]>();
    for (const t of subset) {
      const list = byFamily.get(t.family) ?? [];
      list.push(t);
      byFamily.set(t.family, list);
    }
    return FAMILY_ORDER.filter((f) => byFamily.has(f)).map(
      (f) => [f, byFamily.get(f) ?? []] as const
    );
  }, [filter]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border-soft px-2.5 py-1.5 text-[11px] text-text-muted transition hover:border-accent/40 hover:text-text",
          open && "border-accent/60 text-text"
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Switch theme"
      >
        <Palette size={12} />
        <span className="hidden sm:inline">Theme</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative mx-4 max-h-[86vh] w-full max-w-[960px] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-[22px] tracking-tight text-text">
                  Themes
                </h2>
                <p className="text-[12px] text-text-muted">
                  42 institutional palettes. Hover a tile to preview live.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-text-muted transition hover:bg-surface2 hover:text-text"
                aria-label="Close themes"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {(["all", "dark", "light", "bank"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition",
                    filter === f
                      ? "border-accent/60 bg-accent/10 text-text"
                      : "border-border-soft text-text-muted hover:border-border hover:text-text"
                  )}
                >
                  {f === "all"
                    ? "All"
                    : f === "dark"
                    ? "Dark"
                    : f === "light"
                    ? "Light"
                    : "By bank"}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-8">
              {grouped.map(([family, items]) => (
                <section key={family}>
                  <h3 className="mb-3 text-[10px] uppercase tracking-[0.2em] text-text-muted">
                    {FAMILY_LABELS[family]}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {items.map((t) => (
                      <ThemePreviewTile
                        key={t.id}
                        theme={t}
                        active={theme === t.id}
                        onHover={() => startPreview(t.id)}
                        onLeave={() => stopPreview()}
                        onSelect={() => {
                          commit(t.id);
                          setOpen(false);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ThemePreviewTile({
  theme,
  active,
  onHover,
  onLeave,
  onSelect,
}: {
  theme: ThemeMeta;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-surface2/40 p-2 text-left transition",
        active
          ? "border-accent/80 shadow-glow"
          : "border-border-soft hover:border-border"
      )}
    >
      <div
        className="h-16 w-full overflow-hidden rounded-md"
        style={{ background: theme.preview.bg }}
        aria-hidden
      >
        <div
          className="m-2 h-10 rounded"
          style={{ background: theme.preview.surface }}
        >
          <div
            className="m-2 h-2 w-10 rounded-full"
            style={{ background: theme.preview.accent }}
          />
          <div
            className="mx-2 mt-1 h-1.5 w-16 rounded-full opacity-60"
            style={{ background: theme.preview.accent }}
          />
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium text-text">
          {theme.displayName}
        </div>
        {theme.institution ? (
          <div className="truncate text-[10px] uppercase tracking-[0.12em] text-accent/80">
            {theme.institution}
          </div>
        ) : (
          <div className="truncate text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
            {theme.mode}
          </div>
        )}
      </div>
    </button>
  );
}
