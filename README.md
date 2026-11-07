# Where in the world is Kara?

A live pin board tracking Kara's 26/27 travels. **[whereiskara.com](https://whereiskara.com)**

![Screenshot of the map](docs/screenshot.png)

## What this is

Medium term: A single place for friends, family and well-wishers to see where I am during my 26/27 travels.
Long term: A travel pin board map that shows where I am right now, where I've been, and where I'm
headed next.

## Key features

- **Live status.** Whether a city is current, upcoming, or already
  visited is computed from its dates every time the page loads, in
  that city's own timezone. Nothing is manually flipped when Kara
  moves on to a new place.
- **Repeat visits.** A city can have more than one stay (e.g. Hanoi in
  July and again in September); the map picks whichever one is most
  relevant to show.
- **Day trips.** A one-day excursion off a longer stay gets its own pin
  and popup without changing where the "current" pin sits or bumping
  the day counter. See [`docs/feature-spec-day-trips.md`](docs/feature-spec-day-trips.md)
  for how this one was scoped before it was built.
- **"I'm safe" check-in**, visible on the map.
- **A timeline** of every posted update, ordered by when it was first
  posted. Editing an old caption can't move it or change its date.

## How this was built

Most features here started as a written spec (problem statement,
schema, behaviour rules, acceptance criteria) before any code was
written. Figma designs were created the old fashioned way, then spec + designs were handed to an AI pair-programmer (Claude Code) a section
at a time, checking each one against its own criteria before moving on.
[`docs/feature-spec-day-trips.md`](docs/feature-spec-day-trips.md) is a
real example, lightly cleaned up for this repo.

[`docs/architecture.md`](docs/architecture.md) covers the data model
and a few of the less obvious implementation decisions (why status is
derived positionally rather than per-row, why day trips are a `visits`
row rather than a separate table, and so on).

## Tech stack

- [Next.js](https://nextjs.org) (App Router) on [Vercel](https://vercel.com)
- [Supabase](https://supabase.com) (Postgres), public reads under RLS,
  writes through a service-role key from server-only routes
- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) for the globe
  map, on a custom Studio style
- IBM Plex Sans / Mono, via `next/font`

## Project structure

```
src/
  app/            routes (home map, timeline, about, admin, API routes)
  components/     grouped by feature (Map/, Admin/, About/)
  lib/            data access, status derivation, formatting
  hooks/          small client-side hooks (local clock, weather)
scripts/          analytics smoke test and synthetic-data seeder
supabase/         SQL migrations, numbered in the order they were run
docs/             architecture notes, an example feature spec, analytics queries
```

## Getting started

```bash
git clone https://github.com/karatravadi/WhereIsKara.git
cd WhereIsKara
npm install
```

Copy `.env.example` to `.env.local` and fill in Supabase and Mapbox
credentials (the last four vars are optional, only needed for the
map-usage alert emails and an external check-in trigger):

```bash
cp .env.example .env.local
```

Then:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Analytics

The site records a few anonymous usage events so I can see what people
actually do on it. Supabase is the source of truth; there is no third-party
analytics service.

**Events** (`src/lib/track.ts`, sent to `/api/track`):

| Event | When |
|---|---|
| `page_view` | Any page load or route change |
| `pin_select` | A pin is tapped (city, trip mode, current/latest, days since its last check-in, nth pin this session, ms since load) |
| `pin_close` | The panel is closed or another pin replaces it (ms open, reason) |
| `trip_toggle` | "26/27 travels" / "All time" switched |
| `nav_click` | Header or footer link clicked |
| `session_end` | Tab hidden or closed (best effort; may fire more than once) |

**Schema.** One generic table, `events` (`event_name` plus a `jsonb` properties
column), so new events need no migration. See
[`supabase/008_events.sql`](supabase/008_events.sql). RLS is on with no policies:
only the server-side service-role key can read or write it.

**Privacy.**

- The only identifier is a random id in `sessionStorage`, gone when the tab
  closes. No cookies, no persistent id, so returning visitors can't be
  counted.
- No IP address or user agent is stored. The referrer is reduced to its
  hostname.
- Nothing is sent when the browser sends Do Not Track or Global Privacy
  Control, from `/admin`, or from the owner's own browsers (`?notrack=1` sets
  an opt-out flag, `?notrack=0` clears it; signed-in admin requests are dropped
  server-side).
- `/api/track` accepts only an allow-list of event names, small flat
  payloads, and same-origin requests. The server, not the client, tags each
  row with `env` so local and preview traffic is filtered out of analysis.

**Analysis.** [`docs/analytics/analysis.sql`](docs/analytics/analysis.sql) has
the queries (pin-select rate, funnel, device split and more) and notes the
limits of each. Traffic is small, so rates are shown with their n.
[`docs/analytics/experiment-design.md`](docs/analytics/experiment-design.md)
covers a possible A/B test and why it is not feasible at this traffic.

**Scripts** (`scripts/analytics/`, run from the repo root):

```bash
node scripts/analytics/smoke-test.mjs          # checks /api/track end to end (dev server running)
node scripts/analytics/seed-synthetic.mjs      # fills events_synthetic with FAKE sessions
```

The synthetic table exists so the queries can be developed before real data
arrives. Its numbers come from invented behaviour and mean nothing about real
visitors.

## What's not done yet

- No automated tests.
- No accessibility audit yet.

## License

MIT for the code, see [LICENSE](LICENSE), it doesn't cover the photos
or sprite art.
