import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, isValidSessionToken } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Public, unauthenticated insert endpoint for anonymous usage events, so it
// is strict about what it accepts: an allow-list of event names, a small body
// cap, flat primitive-only properties, and no IP address or user agent ever
// stored. Anything off is dropped quietly - tracking must never break a page.

const ALLOWED_EVENTS = new Set([
  "page_view",
  "pin_select",
  "pin_close",
  "trip_toggle",
  "nav_click",
  "session_end",
]);

const MAX_BODY_CHARS = 2048;
const MAX_PROPERTIES = 20;
const MAX_STRING = 200;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
const BOT_PATTERN = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|facebookexternalhit/i;

type Primitive = string | number | boolean | null;

function cleanProperties(input: unknown): Record<string, Primitive> | null {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_PROPERTIES) return null;

  const out: Record<string, Primitive> = {};
  for (const [key, value] of entries) {
    if (!KEY_PATTERN.test(key)) return null;
    if (typeof value === "string") {
      if (value.length > MAX_STRING) return null;
      out[key] = value;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      out[key] = value;
    } else if (typeof value === "boolean" || value === null) {
      out[key] = value;
    } else {
      return null;
    }
  }
  return out;
}

async function isAdminRequest(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return isValidSessionToken(cookieStore.get(COOKIE_NAME)?.value);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Same-origin only. sendBeacon and fetch from the site always send a
  // matching Origin; a mismatch means someone else is calling this.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return new NextResponse(null, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_CHARS) return new NextResponse(null, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const { event_name, anon_id, session_id, path } = body;
  const properties = cleanProperties(body.properties);

  if (
    typeof event_name !== "string" ||
    !ALLOWED_EVENTS.has(event_name) ||
    typeof anon_id !== "string" ||
    !ID_PATTERN.test(anon_id) ||
    typeof session_id !== "string" ||
    !ID_PATTERN.test(session_id) ||
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > MAX_STRING ||
    properties === null
  ) {
    return new NextResponse(null, { status: 400 });
  }

  // Skipped quietly (not an error): crawlers, the admin area, and Kara's own
  // visits while signed in as admin. The user agent is checked, never stored.
  if (BOT_PATTERN.test(req.headers.get("user-agent") ?? "")) {
    return new NextResponse(null, { status: 204 });
  }
  if (path.startsWith("/admin") || (await isAdminRequest())) {
    return new NextResponse(null, { status: 204 });
  }

  // env is set here, never trusted from the client, so local and preview
  // traffic can be filtered out of the real analysis.
  const env = process.env.VERCEL_ENV === "production" ? "production" : "dev";

  const { error } = await supabaseAdmin.from("events").insert({
    anon_id,
    session_id,
    event_name,
    path,
    properties: { ...properties, env },
  });

  if (error) return new NextResponse(null, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
