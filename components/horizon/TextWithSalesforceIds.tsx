"use client";

import { useEffect, useMemo, useState } from "react";
import {
  lightningRecordViewUrl,
  segmentTextWithSalesforceIds,
} from "@/lib/salesforce/recordLink";
import { resolveSfLabels } from "@/lib/client/sfLabelsCache";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { cn } from "@/lib/utils";

export function TextWithSalesforceIds({
  text,
  className,
  linkClassName,
  /** When true (default), resolve Id anchor text to Name/Subject via `/api/sf/labels`. */
  resolveLabels = true,
}: {
  text: string;
  className?: string;
  /** Extra classes on each record link (underline, color). */
  linkClassName?: string;
  resolveLabels?: boolean;
}) {
  const base = useSfInstanceUrl();
  const segments = useMemo(() => segmentTextWithSalesforceIds(text), [text]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!resolveLabels) {
      setLabels({});
      return;
    }
    const ids = segments
      .filter((s) => s.kind === "id")
      .map((s) => s.value);
    if (ids.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    void resolveSfLabels(ids).then((map) => {
      if (!cancelled) setLabels(map);
    });
    return () => {
      cancelled = true;
    };
  }, [resolveLabels, text, segments]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.value}</span>;
        }
        const href = base ? lightningRecordViewUrl(base, seg.value) : null;
        const display = labels[seg.value] ?? seg.value;
        const isResolved = display !== seg.value;
        if (!href) {
          return (
            <span
              key={i}
              className={cn(
                "text-[0.92em]",
                isResolved ? "text-text" : "font-mono text-text-muted"
              )}
            >
              {display}
            </span>
          );
        }
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-[0.92em] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent",
              !isResolved && "font-mono",
              linkClassName
            )}
          >
            {display}
          </a>
        );
      })}
    </span>
  );
}
