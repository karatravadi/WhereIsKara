"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  applyNotrackParam,
  deviceType,
  msSinceLoad,
  pinsSelected,
  track,
  viewport,
} from "@/lib/track";

// Renders nothing. Sends page_view on every route change, nav_click for links
// tagged data-nav, and a best-effort session_end when the tab is hidden or
// closed (it can fire more than once per session; analysis takes the max).
export function PageTracker() {
  const pathname = usePathname();
  const firstView = useRef(true);

  useEffect(() => {
    applyNotrackParam();

    let lastEnd = 0;
    const sendEnd = () => {
      const now = Date.now();
      if (now - lastEnd < 1000) return;
      lastEnd = now;
      track("session_end", { ms_on_page: msSinceLoad(), pins_selected: pinsSelected() });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendEnd();
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[data-nav]");
      const target = link?.getAttribute("data-nav");
      if (target) track("nav_click", { target });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", sendEnd);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", sendEnd);
      document.removeEventListener("click", onClick);
    };
  }, []);

  useEffect(() => {
    // Referrer hostname only (never the path or query), and only for the
    // first view of the visit, from outside the site.
    let referrer: string | null = null;
    if (firstView.current && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname;
        referrer = host === window.location.hostname ? null : host;
      } catch {
        referrer = null;
      }
    }
    firstView.current = false;
    track("page_view", { referrer, device_type: deviceType(), viewport: viewport() });
  }, [pathname]);

  return null;
}
