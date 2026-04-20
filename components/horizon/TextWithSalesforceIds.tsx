"use client";

import { useMemo } from "react";
import {
  lightningRecordViewUrl,
  segmentTextWithSalesforceIds,
} from "@/lib/salesforce/recordLink";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { cn } from "@/lib/utils";

export function TextWithSalesforceIds({
  text,
  className,
  linkClassName,
}: {
  text: string;
  className?: string;
  /** Extra classes on each record link (underline, color). */
  linkClassName?: string;
}) {
  const base = useSfInstanceUrl();
  const segments = useMemo(() => segmentTextWithSalesforceIds(text), [text]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <span key={i}>{seg.value}</span>;
        }
        const href = base ? lightningRecordViewUrl(base, seg.value) : null;
        if (!href) {
          return (
            <span key={i} className="font-mono text-[0.92em]">
              {seg.value}
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
              "font-mono text-[0.92em] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent",
              linkClassName
            )}
          >
            {seg.value}
          </a>
        );
      })}
    </span>
  );
}
