"use client";

import { useEffect, useState } from "react";
import type { PriorityClient } from "@/types/horizon";

export function PriorityQueue() {
  const [clients, setClients] = useState<PriorityClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/priority")
      .then(async (r) => {
        if (r.status === 401) {
          if (!cancelled) setError("Sign in to load your priority queue.");
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (!j || cancelled) return;
        if (Array.isArray(j?.clients)) setClients(j.clients);
        else setError("No priorities available yet.");
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h2 className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Priority queue
      </h2>
      <ul className="mt-6 divide-y divide-border/60">
        {clients === null && !error && (
          <li className="h-12 rounded-md shimmer" aria-hidden />
        )}
        {error && (
          <li className="py-4 text-sm text-text-muted">{error}</li>
        )}
        {clients?.map((c) => (
          <li
            key={c.client_id}
            className="flex items-start justify-between gap-6 py-5"
          >
            <div>
              <div className="font-medium text-text">{c.name}</div>
              <div className="mt-1 text-sm text-text-muted">{c.reason}</div>
            </div>
            <div className="shrink-0 font-mono text-xs text-accent">
              {c.score.toFixed(0)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
