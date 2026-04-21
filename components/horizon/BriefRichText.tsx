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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest names first so "Okafor Capital Holdings" wins over "Okafor Capital". */
function splitByAnyNames(
  text: string,
  names: string[]
): Array<{ kind: "text" | "name"; value: string }> {
  const uniq = [
    ...new Set(names.map((n) => n.trim()).filter((n) => n.length > 1)),
  ].sort((a, b) => b.length - a.length);
  if (uniq.length === 0) return [{ kind: "text", value: text }];
  const re = new RegExp(`(?:${uniq.map(escapeRegExp).join("|")})`, "gi");
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
 * when `client_id` is set, also resolve that record's Name and link every
 * occurrence of known display strings (model `client_name` + API label).
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
    const ids = new Set(collectIdsFromText(text));
    if (clientId?.trim()) ids.add(clientId.trim());
    const list = [...ids];
    if (list.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    void resolveSfLabels(list).then((map) => {
      if (!cancelled) setLabels(map);
    });
    return () => {
      cancelled = true;
    };
  }, [text, clientId]);

  const namesToLink = useMemo(() => {
    const n = new Set<string>();
    const cn = clientName?.trim();
    if (cn) n.add(cn);
    const cid = clientId?.trim();
    if (cid && labels[cid]) {
      const resolved = labels[cid]!;
      n.add(resolved);
      const beforeComma = resolved.split(",")[0]?.trim();
      if (
        beforeComma &&
        beforeComma.length >= 2 &&
        beforeComma !== resolved
      ) {
        n.add(beforeComma);
      }
      const firstToken = resolved.match(/^[\w'.&-]+/u)?.[0];
      if (
        firstToken &&
        firstToken.length >= 3 &&
        firstToken !== resolved &&
        !n.has(firstToken)
      ) {
        n.add(firstToken);
      }
    }
    return [...n].sort((a, b) => b.length - a.length);
  }, [clientName, clientId, labels]);

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
            {splitByAnyNames(seg.value, namesToLink).map((piece, j) => {
              if (piece.kind === "name" && clientHref) {
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
