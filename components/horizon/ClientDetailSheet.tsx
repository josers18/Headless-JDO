"use client";

// Full 360 client sheet, opened from PriorityQueue. Scaffolded now, wired
// to MCP on Day 4 per CLAUDE.md §8.
export function ClientDetailSheet({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
      <aside className="h-full w-full max-w-[520px] border-l border-border bg-surface p-8">
        <button
          onClick={onClose}
          className="text-[11px] uppercase tracking-[0.18em] text-text-muted hover:text-text"
        >
          Close
        </button>
        <div className="mt-6 font-mono text-xs text-text-muted">
          client · {clientId}
        </div>
        <div className="mt-4 font-display text-2xl">Client detail</div>
        <p className="mt-6 text-sm text-text-muted">
          Full 360 view arrives Day 4.
        </p>
      </aside>
    </div>
  );
}
