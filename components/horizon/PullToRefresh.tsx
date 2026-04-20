"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { PULSE_REFRESH_EVENT } from "@/lib/client/rightNowSnooze";
import {
  HORIZON_REFRESH_ARC,
  HORIZON_REFRESH_BRIEF,
  HORIZON_REFRESH_DRAFTS,
  HORIZON_REFRESH_PRIORITY,
  HORIZON_REFRESH_PULSE,
} from "@/lib/client/horizonEvents";

export function PullToRefresh({ children }: { children: ReactNode }) {
  const startY = useRef(0);
  const armed = useRef(false);
  const fired = useRef(false);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY > 10) return;
      armed.current = true;
      fired.current = false;
      startY.current = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!armed.current || fired.current) return;
      if (window.scrollY > 10) return;
      const y = e.touches[0]?.clientY ?? 0;
      if (y - startY.current > 88) {
        fired.current = true;
        window.dispatchEvent(new Event(HORIZON_REFRESH_BRIEF));
        window.dispatchEvent(new Event(PULSE_REFRESH_EVENT));
        window.dispatchEvent(new Event(HORIZON_REFRESH_ARC));
        window.dispatchEvent(new Event(HORIZON_REFRESH_PULSE));
        window.dispatchEvent(new Event(HORIZON_REFRESH_PRIORITY));
        window.dispatchEvent(new Event(HORIZON_REFRESH_DRAFTS));
      }
    };
    const end = () => {
      armed.current = false;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  return <>{children}</>;
}
