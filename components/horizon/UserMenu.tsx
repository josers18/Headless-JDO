"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { HORIZON_SIGN_OUT } from "@/lib/client/horizonEvents";
import { ASK_THREAD_STORAGE_KEY } from "@/types/ask-thread";

function firstInitial(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const first = [...t][0];
  return first ? first.toUpperCase() : "?";
}

export function UserMenu({
  bankerName,
  bankerEmail,
}: {
  bankerName: string;
  bankerEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 72, right: 16 });
  const wrapRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => firstInitial(bankerName), [bankerName]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setMenuPos({
      top: r.bottom + 8,
      right: Math.max(16, window.innerWidth - r.right),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const el = wrapRef.current;
      if (el?.contains(t)) return;
      if (t.closest("[data-horizon-user-menu]")) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open]);

  const onSignOut = () => {
    window.dispatchEvent(new CustomEvent(HORIZON_SIGN_OUT));
    try {
      sessionStorage.removeItem(ASK_THREAD_STORAGE_KEY);
    } catch {
      /* private mode / quota */
    }
    window.location.href = "/api/auth/logout";
  };

  const panel =
    open &&
    mounted &&
    createPortal(
      <div
        data-horizon-user-menu
        className="fixed z-[95] min-w-[220px] max-w-[min(320px,calc(100vw-1.5rem))] rounded-xl border border-border-soft bg-surface py-2 shadow-2xl shadow-black/50"
        style={{ top: menuPos.top, right: menuPos.right }}
      >
          <div className="px-3 pb-2 pt-1">
            <div className="text-[13px] font-medium leading-snug text-text">
              {bankerName}
            </div>
            <div className="mt-0.5 break-all text-[12px] leading-snug text-text-muted">
              {bankerEmail}
            </div>
          </div>
          <div className="mx-2 border-t border-border-soft/80" />
          <button
            type="button"
            className="mt-1 w-full px-3 py-2.5 text-left text-[13px] text-text transition hover:bg-danger/10 hover:text-danger"
            onClick={onSignOut}
          >
            Sign out
          </button>
      </div>,
      document.body
    );

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full border border-border-soft bg-surface2/80 font-display text-[13px] font-semibold text-accent shadow-sm transition hover:border-accent/50 hover:bg-surface2",
          open && "border-accent/50 ring-2 ring-accent/25"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
      >
        {initial}
      </button>
      {panel}
    </div>
  );
}
