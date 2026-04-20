"use client";

// HeaderClock — renders the banker's current day + time + timezone
// abbreviation using the browser's local clock. Previously app/page.tsx
// rendered `new Date().toLocaleTimeString(...)` on the server, which on
// Heroku (UTC) meant a banker in ET saw something like "4:00 AM" mid-
// morning. Moving this to a client component lets it read the viewer's
// actual wall clock.
//
// Strategy:
//   - Mount-gated render so there's no hydration mismatch against the
//     server-rendered HTML shell (which we intentionally ship without the
//     clock). Until the effect runs, we render an invisible placeholder
//     of the same size so the header doesn't reflow.
//   - Minute-accurate tick via setInterval. We don't need per-second
//     precision here — the clock is a subtle orientation cue, not a
//     stopwatch.
//   - Timezone abbreviation (ET, PT, GMT, etc.) is derived via Intl's
//     `timeZoneName: "short"` formatter, which respects the browser's
//     local zone automatically. We parse it out of the formatted string
//     because there's no dedicated accessor.

import { useEffect, useState } from "react";

function formatParts(d: Date): {
  dayLine: string;
  time: string;
  tzAbbrev: string;
} {
  const dayLine = d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const time = d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Intl formats the full time with a tz-name token at the tail; we pull
  // the last whitespace-delimited token as the abbreviation. Falls back
  // to empty string if the browser's locale doesn't surface one (rare).
  const tzFull = new Intl.DateTimeFormat([], {
    hour: "numeric",
    timeZoneName: "short",
  }).format(d);
  const tzAbbrev = tzFull.split(" ").slice(-1)[0] ?? "";

  return { dayLine, time, tzAbbrev };
}

export function HeaderClock() {
  const [parts, setParts] = useState<ReturnType<typeof formatParts> | null>(
    null
  );

  useEffect(() => {
    const tick = () => setParts(formatParts(new Date()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!parts) {
    return (
      <div
        className="flex items-center gap-4 text-[11px] uppercase tracking-[0.2em] text-text-muted"
        aria-hidden
      >
        <span className="hidden sm:inline-block opacity-0">—</span>
        <span className="h-[10px] w-px bg-border/70" aria-hidden />
        <span className="font-mono text-[11px] normal-case tracking-normal opacity-0">
          —
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-4 text-[11px] uppercase tracking-[0.2em] text-text-muted"
      suppressHydrationWarning
    >
      <span className="hidden sm:inline-block">{parts.dayLine}</span>
      <span className="h-[10px] w-px bg-border/70" aria-hidden />
      <span className="font-mono text-[11px] normal-case tracking-normal text-text">
        {parts.time}
        {parts.tzAbbrev ? (
          <span className="ml-1.5 text-text-muted">{parts.tzAbbrev}</span>
        ) : null}
      </span>
    </div>
  );
}
