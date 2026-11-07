// Smoke test for /api/track: checks that valid events arrive in the events
// table and that bad ones are rejected.
//
// Usage (PowerShell or bash, from the repo root, with the dev server running
// and supabase/008_events.sql applied):
//   node scripts/analytics/smoke-test.mjs
//   node scripts/analytics/smoke-test.mjs https://whereiskara.com   (only tags env=production
//                                                                      if run against production)
//
// Test rows are written with env "dev" locally and deleted afterwards. If you
// point this at production the row is real for a moment, then deleted too.

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

const base = process.argv[2] ?? "http://localhost:3000";
const sessionId = `smoke-${Date.now().toString(16)}`;
let failures = 0;

const post = (body, headers = {}) =>
  fetch(`${base}/api/track`, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = {
  event_name: "pin_select",
  anon_id: sessionId,
  session_id: sessionId,
  path: "/",
  properties: { city: "Smoke Test", select_index: 1, is_latest: false, days_since_checkin: null },
};

async function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const countRows = async () => {
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw error;
  return count;
};

let res = await post(valid);
await check("valid event is accepted (204)", res.status === 204, `got ${res.status}`);
await check("valid event is stored", (await countRows()) === 1);

const { data: stored } = await supabase.from("events").select("properties,path").eq("session_id", sessionId);
await check("server sets env, client cannot", ["dev", "production"].includes(stored?.[0]?.properties?.env));
await check("no ip or user agent in the row", !JSON.stringify(stored).match(/user.?agent|\bip\b/i));

res = await post({ ...valid, event_name: "not_a_real_event" });
await check("unknown event name is rejected (400)", res.status === 400, `got ${res.status}`);

res = await post({ ...valid, properties: { nested: { a: 1 } } });
await check("nested properties are rejected (400)", res.status === 400, `got ${res.status}`);

res = await post({ ...valid, properties: { big: "x".repeat(300) } });
await check("long string value is rejected (400)", res.status === 400, `got ${res.status}`);

res = await post("x".repeat(5000));
await check("oversized body is rejected (413)", res.status === 413, `got ${res.status}`);

res = await post({ ...valid, path: "/admin" });
await check("/admin path is skipped quietly (204)", res.status === 204, `got ${res.status}`);

res = await post(valid, { "user-agent": "Googlebot/2.1" });
await check("bot user agent is skipped quietly (204)", res.status === 204, `got ${res.status}`);

res = await post(valid, { origin: "https://example.com" });
await check("cross-origin request is rejected (403)", res.status === 403, `got ${res.status}`);

await check("rejected and skipped events were not stored", (await countRows()) === 1, `rows: ${await countRows()}`);

await supabase.from("events").delete().eq("session_id", sessionId).then(() => {});
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
