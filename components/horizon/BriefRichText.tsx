"use client";

import { useEffect, useMemo, useState } from "react";
import {
  inferSalesforceObjectFromId,
  lightningRecordViewUrl,
  segmentTextWithSalesforceIds,
} from "@/lib/salesforce/recordLink";
import { resolveSfLabels } from "@/lib/client/sfLabelsCache";
import { extractNamesForProbing } from "@/lib/client/extractNamesForProbing";
import { lookupEntityLabel } from "@/lib/salesforce/labelLookup";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { cn } from "@/lib/utils";
import type { BriefEntityLink } from "@/types/horizon";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens to try matching in prose for a single Salesforce Id. */
function displayNameHints(
  id: string,
  labels: Record<string, string>,
  explicit?: string
): string[] {
  const out: string[] = [];
  const ex = explicit?.trim();
  if (ex) {
    for (const part of ex.split(/\s*\|\s*/)) {
      const p = part.trim();
      if (p.length > 1) out.push(p);
    }
  }
  const resolved = lookupEntityLabel(labels, id)?.trim();
  if (resolved) {
    out.push(resolved);
    const beforeComma = resolved.split(",")[0]?.trim();
    if (
      beforeComma &&
      beforeComma.length >= 2 &&
      beforeComma !== resolved
    ) {
      out.push(beforeComma);
    }
    const dashHead = resolved.split(/\s+-\s+/)[0]?.trim();
    if (
      dashHead &&
      dashHead.length >= 2 &&
      dashHead !== resolved &&
      !out.includes(dashHead)
    ) {
      out.push(dashHead);
    }
    const firstToken = resolved.match(/^[\w'.&-]+/u)?.[0];
    if (
      firstToken &&
      firstToken.length >= 3 &&
      firstToken !== resolved &&
      !out.includes(firstToken)
    ) {
      out.push(firstToken);
    }
  }
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length > 1))];
}

type NameAnchor = { name: string; href: string };

function buildNameAnchors(
  base: string | null,
  primaryId: string | undefined,
  primaryName: string | undefined,
  entityLinks: BriefEntityLink[] | undefined,
  labels: Record<string, string>
): NameAnchor[] {
  const list: NameAnchor[] = [];
  const seen = new Set<string>();

  const push = (name: string, id: string) => {
    const href =
      base && inferSalesforceObjectFromId(id)
        ? lightningRecordViewUrl(base, id)
        : null;
    if (!href) return;
    const n = name.trim();
    if (n.length < 2) return;
    const key = `${n.toLowerCase()}\t${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ name: n, href });
  };

  const addEntity = (idRaw: string | undefined, nameRaw?: string) => {
    const id = idRaw?.trim();
    if (!id) return;
    for (const hint of displayNameHints(id, labels, nameRaw)) {
      push(hint, id);
    }
  };

  addEntity(primaryId, primaryName);
  for (const e of entityLinks ?? []) {
    addEntity(e.client_id, e.client_name);
  }

  return list.sort((a, b) => b.name.length - a.name.length);
}

/**
 * Split `text` into text + link runs. Alternation is longest-name-first so
 * "Okafor Capital Holdings" wins over "Okafor Capital".
 */
function splitByNamedAnchors(
  text: string,
  anchors: NameAnchor[]
): Array<
  | { kind: "text"; value: string }
  | { kind: "link"; value: string; href: string }
> {
  if (anchors.length === 0) return [{ kind: "text", value: text }];
  const re = new RegExp(
    anchors.map((a) => escapeRegExp(a.name)).join("|"),
    "gi"
  );
  const out: Array<
    | { kind: "text"; value: string }
    | { kind: "link"; value: string; href: string }
  > = [];
  let last = 0;
  for (const match of text.matchAll(re)) {
    const idx = match.index ?? 0;
    const chunk = match[0] ?? "";
    if (idx > last) {
      out.push({ kind: "text", value: text.slice(last, idx) });
    }
    const href =
      anchors.find((a) => a.name.toLowerCase() === chunk.toLowerCase())
        ?.href ?? anchors[0]?.href;
    if (href) {
      out.push({ kind: "link", value: chunk, href });
    } else {
      out.push({ kind: "text", value: chunk });
    }
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
 * Rich text: Id → resolved label + Lightning link; optional CRM entities link
 * matched display names to the correct record (`client_id` + `entity_links`).
 */
export function BriefRichText({
  text,
  className,
  linkClassName,
  clientId,
  clientName,
  entityLinks,
  /** SOQL-resolve capitalized names in this string (comma lists, "Name and Name"). */
  probeCoListedNames,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
  clientId?: string;
  clientName?: string;
  /** Extra Accounts/Contacts/etc. named in this copy (e.g. "Also today" multi-account). */
  entityLinks?: BriefEntityLink[];
  probeCoListedNames?: boolean;
}) {
  const base = useSfInstanceUrl();

  const [probedEntities, setProbedEntities] = useState<BriefEntityLink[]>([]);

  useEffect(() => {
    if (!probeCoListedNames || !text.trim()) {
      setProbedEntities([]);
      return;
    }
    const names = extractNamesForProbing(text);
    if (names.length === 0) {
      setProbedEntities([]);
      return;
    }
    let cancelled = false;
    void fetch("/api/sf/entity-by-names", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ names }),
    })
      .then((r) => r.json())
      .then((j: { entities?: BriefEntityLink[] }) => {
        if (!cancelled) setProbedEntities(Array.isArray(j.entities) ? j.entities : []);
      })
      .catch(() => {
        if (!cancelled) setProbedEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [probeCoListedNames, text]);

  const mergedEntityLinks = useMemo(() => {
    const m = new Map<string, BriefEntityLink>();
    const merge = (e: BriefEntityLink) => {
      const id = e.client_id?.trim();
      if (!id) return;
      const nm = e.client_name?.trim() ?? "";
      const prev = m.get(id);
      if (!prev) {
        m.set(id, { ...e, client_id: id });
        return;
      }
      const parts = new Set<string>();
      for (const s of (prev.client_name ?? "").split(/\s*\|\s*/)) {
        const t = s.trim();
        if (t) parts.add(t);
      }
      for (const s of nm.split(/\s*\|\s*/)) {
        const t = s.trim();
        if (t) parts.add(t);
      }
      m.set(id, {
        ...prev,
        client_id: id,
        client_name: [...parts].join(" | ") || prev.client_name,
      });
    };
    for (const e of entityLinks ?? []) merge(e);
    for (const e of probedEntities) merge(e);
    return [...m.values()];
  }, [entityLinks, probedEntities]);

  const mergedEntityKey = useMemo(
    () =>
      mergedEntityLinks
        .map((e) => `${e.client_id}:${(e.client_name ?? "").trim()}`)
        .sort()
        .join("|"),
    [mergedEntityLinks]
  );

  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = new Set(collectIdsFromText(text));
    const cid = clientId?.trim();
    if (cid) ids.add(cid);
    for (const e of mergedEntityLinks) {
      const id = e.client_id?.trim();
      if (id) ids.add(id);
    }
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
  }, [text, clientId, mergedEntityKey, mergedEntityLinks]);

  const nameAnchors = useMemo(
    () =>
      buildNameAnchors(
        base,
        clientId,
        clientName,
        mergedEntityLinks,
        labels
      ),
    [base, clientId, clientName, mergedEntityLinks, labels]
  );

  const topSegs = useMemo(() => segmentTextWithSalesforceIds(text), [text]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {topSegs.map((seg, i) => {
        if (seg.kind === "id") {
          const href = base ? lightningRecordViewUrl(base, seg.value) : null;
          const display = lookupEntityLabel(labels, seg.value) ?? seg.value;
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
            {splitByNamedAnchors(seg.value, nameAnchors).map((piece, j) => {
              if (piece.kind === "link") {
                return (
                  <a
                    key={`${i}-${j}-l`}
                    href={piece.href}
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
                    const display =
                      lookupEntityLabel(labels, s.value) ?? s.value;
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
