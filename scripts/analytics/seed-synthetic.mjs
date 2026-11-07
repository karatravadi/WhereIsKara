// SYNTHETIC DATA. Every row this script writes is fake.
//
// Fills the events_synthetic table with made-up sessions so the queries in
// docs/analytics/analysis.sql can be written and debugged before real traffic
// exists. The behaviour below is invented (the weights are my assumptions, not
// findings), so nothing computed from this table says anything about real
// visitors and none of it should ever be quoted as a result.
//
// Usage (PowerShell or bash, from the repo root):
//   node scripts/analytics/seed-synthetic.mjs          add ~200 fake sessions
//   node scripts/analytics/seed-synthetic.mjs --reset  wipe the table first
//
// Needs supabase/008_events.sql applied and the service-role key in .env.local.
// Uses a fixed random seed, so a given run is reproducible.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^"|"$/g, "");
}
const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// mulberry32: tiny seeded PRNG
let seed = 42;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (items, weights) => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
};
const lognormal = (median, spread = 0.6) =>
  Math.round(median * Math.exp(spread * (rand() + rand() + rand() - 1.5) * 1.6));
const uuid = () =>
  "synth-" + Array.from({ length: 12 }, () => Math.floor(rand() * 16).toString(16)).join("");

if (process.argv.includes("--reset")) {
  const { error } = await supabase.from("events_synthetic").delete().not("id", "is", null);
  if (error) throw error;
  console.log("events_synthetic cleared");
}

const { data: cities, error: cityError } = await supabase
  .from("cities")
  .select("id,name,pin_type")
  .eq("pin_type", "trip");
if (cityError) throw cityError;

// Invented per-pin state: how stale each pin's last check-in is, which pin is
// "latest" and which is "current".
const pins = cities.map((c, i) => ({
  id: String(c.id),
  name: c.name,
  days: i === 0 ? 0 : Math.floor(rand() * 60),
  isLatest: i === 0,
  isCurrent: i === 1,
}));

const SESSIONS = 200;
const DAYS = 60;
const rows = [];
const base = Date.now() - DAYS * 86_400_000;

for (let s = 0; s < SESSIONS; s++) {
  const id = uuid();
  const start = base + Math.floor(rand() * DAYS * 86_400_000);
  const device = pick(["mobile", "desktop", "tablet"], [60, 35, 5]);
  const viewport = { mobile: "390x844", desktop: "1440x900", tablet: "820x1180" }[device];
  let t = start;
  let clock = 0;

  const add = (event_name, path, properties = {}) => {
    rows.push({
      created_at: new Date(t).toISOString(),
      anon_id: id,
      session_id: id,
      event_name,
      path,
      properties: { ...properties, env: "production", synthetic: true },
    });
  };
  const advance = (ms) => {
    t += ms;
    clock += ms;
  };

  const referrer = pick([null, "instagram.com", "linkedin.com", "google.com", "t.co"], [55, 20, 10, 10, 5]);
  add("page_view", "/", { referrer, device_type: device, viewport });

  // Invented behaviour: desktop selects pins more than mobile.
  const pSelect = device === "desktop" ? 0.62 : device === "tablet" ? 0.5 : 0.42;
  let pinsSelected = 0;
  if (rand() < pSelect) {
    const count = 1 + Math.floor(-Math.log(1 - rand()) * 1.2);
    for (let k = 1; k <= Math.min(count, 8); k++) {
      const pin = pick(pins, pins.map((p) => (p.isLatest ? 4 : p.isCurrent ? 2.5 : p.days < 14 ? 1.4 : 1)));
      advance(k === 1 ? lognormal(7000) : lognormal(4000));
      pinsSelected++;
      add("pin_select", "/", {
        city: pin.name,
        pin_id: pin.id,
        trip: "26/27",
        pin_status: pin.isCurrent ? "current" : "visited",
        is_current: pin.isCurrent,
        is_latest: pin.isLatest,
        days_since_checkin: pin.days,
        select_index: k,
        ms_since_load: clock,
      });
      advance(lognormal(18000));
      add("pin_close", "/", {
        city: pin.name,
        pin_id: pin.id,
        ms_open: lognormal(18000),
        reason: k < count && rand() < 0.4 ? "switch" : "close",
      });
    }
  } else {
    advance(lognormal(9000));
  }

  if (rand() < 0.1) {
    advance(lognormal(3000));
    add("trip_toggle", "/", { to_value: "all_time" });
  }

  const next = pick(["none", "/timeline", "/about"], pinsSelected > 0 ? [60, 25, 15] : [75, 12, 13]);
  if (next !== "none") {
    advance(lognormal(2500));
    add("nav_click", "/", { target: next === "/timeline" ? "timeline" : "about" });
    advance(300);
    add("page_view", next, { referrer: null, device_type: device, viewport });
    advance(lognormal(15000));
  }

  add("session_end", next === "none" ? "/" : next, { ms_on_page: clock, pins_selected: pinsSelected });
}

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await supabase.from("events_synthetic").insert(rows.slice(i, i + 500));
  if (error) throw error;
}
console.log(`inserted ${rows.length} SYNTHETIC events across ${SESSIONS} fake sessions`);
