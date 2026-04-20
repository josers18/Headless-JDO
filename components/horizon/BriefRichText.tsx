"use client";

import { useEffect, useMemo, useState } from "react";
import {
  inferSalesforceObjectFromId,
  lightningRecordViewUrl,
  segmentTextWithSalesforceIds,
} from "@/lib/salesforce/recordLink";
import { resolveSfLabels } from "@/lib/client/sfLabelsCache";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { cn } from "@/lib/utils";

function splitByClientName(
  text: string,
  name: string | undefined
): Array<{ kind: "text" | "name"; value: string }> {
  const n = name?.trim();
  if (!n) return [{ kind: "text", value: text }];
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc, "gi");
  const out: Array<{ kind: "text" | "name"; value: string }> = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    const chunk = match[0] ?? "";
    if (idx > last) {
      out.push({ kind: "text", value: text.slice(last, idx) });
    }
    out.push({ kind: "name", value: chunk });
    last = idx + chunk.length;
  }
  if (last < text.length) {
    out.push({ kind: "text", value: text.slice(last) });
  }
  if (out.length === 0) out.push({ kind: "text", value: text });
  return out;
}

function collectIdsFromText(text: string): string[] {
  return segmentTextWithSalesforceIds(text)
    .filter((s) => s.kind === "id")
    .map((s) => s.value);
}

/**
 * Brief / hero copy: Salesforce Id links show resolved labels when possible;
 * optional `client_id` + `client_name` turn matching name substrings into
 * record links (same Id as client_id).
 */
export function BriefRichText({
  text,
  className,
  linkClassName,
  clientId,
  clientName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
  /** When set with clientName, occurrences of clientName link to this record. */
  clientId?: string;
  clientName?: string;
}) {
  const base = useSfInstanceUrl();
  const clientHref =
    base && clientId && inferSalesforceObjectFromId(clientId)
      ? lightningRecordViewUrl(base, clientId)
      : null;

  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = collectIdsFromText(text);
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
  }, [text]);

  const topSegs = useMemo(() => segmentTextWithSalesforceIds(text), [text]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {topSegs.map((seg, i) => {
        if (seg.kind === "id") {
          const href = base ? lightningRecordViewUrl(base, seg.value) : null;
          const display = labels[seg.value] ?? seg.value;
          const isResolved = display !== seg.value;
          if (!href) {
            return (
              <span
                key={i}
                className={cn(
                  "text-[0.96em]",
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
                "text-[0.96em] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent",
                !isResolved && "font-mono",
                linkClassName
              )}
            >
              {display}
            </a>
          );
        }
        return (
          <span key={i}>
            {splitByClientName(seg.value, clientName).map((piece, j) => {
              if (
                piece.kind === "name" &&
                clientHref &&
                clientId &&
                clientName
              ) {
                return (
                  <a
                    key={`${i}-${j}-n`}
                    href={clientHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent",
                      linkClassName
                    )}
                  >
                    {piece.value}
                  </a>
                );
              }
              const inner = segmentTextWithSalesforceIds(piece.value);
              return (
                <span key={`${i}-${j}-t`}>
                  {inner.map((s, k) => {
                    if (s.kind === "text") {
                      return <span key={k}>{s.value}</span>;
                    }
                    const href = base
                      ? lightningRecordViewUrl(base, s.value)
                      : null;
                    const display = labels[s.value] ?? s.value;
                    const isResolved = display !== s.value;
                    if (!href) {
                      return (
                        <span
                          key={k}
                          className={cn(
                            "text-[0.96em]",
                            isResolved ? "text-text" : "font-mono text-text-muted"
                          )}
                        >
                          {display}
                        </span>
                      );
                    }
                    return (
                      <a
                        key={k}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "text-[0.96em] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent",
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
            })}
          </span>
        );
      })}
    </span>
  );
}
