// Anonymous usage tracking. Fire-and-forget: it must never throw, block the UI
// or change what a visitor sees. See the README ("Analytics") for the event
// list and the privacy approach.
//
// Privacy rules enforced here:
//  - the only identifier is a random per-tab id in sessionStorage (gone when
//    the tab closes); no cookies
//  - nothing is sent if the browser sends Do Not Track or Global Privacy Control
//  - nothing is sent from /admin
//  - Kara's own browsers can opt out with ?notrack=1 (stored in localStorage,
//    undo with ?notrack=0)

export type TrackEvent =
  | "page_view"
  | "pin_select"
  | "pin_close"
  | "trip_toggle"
  | "nav_click"
  | "session_end";

export type TrackProps = Record<string, string | number | boolean | null>;

const ENDPOINT = "/api/track";
const SESSION_KEY = "kara_sid";
const PINS_KEY = "kara_pins";
const NOTRACK_KEY = "kara_notrack";
const DEV_KEY = "kara_track_dev";

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === "1" || nav.globalPrivacyControl) return false;
    if (window.localStorage.getItem(NOTRACK_KEY) === "1") return false;
    if (window.location.pathname.startsWith("/admin")) return false;
    // Production only, unless explicitly switched on for local testing.
    return process.env.NODE_ENV === "production" || window.localStorage.getItem(DEV_KEY) === "1";
  } catch {
    return false;
  }
}

function getSessionId(): string | null {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(event: TrackEvent, properties: TrackProps = {}): void {
  try {
    if (!isEnabled()) return;
    const sessionId = getSessionId();
    if (!sessionId) return;

    // Option A (no persistent id): anon_id and session_id are the same value.
    const body = JSON.stringify({
      event_name: event,
      anon_id: sessionId,
      session_id: sessionId,
      path: window.location.pathname,
      properties,
    });

    // text/plain keeps this a "simple" request, so sendBeacon never needs a preflight.
    const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // tracking never breaks the page
  }
}

// Nth pin selected this session (1-based), counted in sessionStorage so it
// survives moving between pages.
export function nextPinIndex(): number {
  try {
    const next = Number(window.sessionStorage.getItem(PINS_KEY) ?? "0") + 1;
    window.sessionStorage.setItem(PINS_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

export function pinsSelected(): number {
  try {
    return Number(window.sessionStorage.getItem(PINS_KEY) ?? "0");
  } catch {
    return 0;
  }
}

// Milliseconds since this document loaded.
export function msSinceLoad(): number {
  return Math.round(performance.now());
}

export function deviceType(): "mobile" | "tablet" | "desktop" {
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

export function viewport(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

// ?notrack=1 / ?notrack=0 toggles the opt-out flag for this browser.
export function applyNotrackParam(): void {
  try {
    const value = new URLSearchParams(window.location.search).get("notrack");
    if (value === "1") window.localStorage.setItem(NOTRACK_KEY, "1");
    if (value === "0") window.localStorage.removeItem(NOTRACK_KEY);
  } catch {
    // ignore
  }
}
