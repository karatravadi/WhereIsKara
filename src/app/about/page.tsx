import { getAllDailyUpdates, getCitiesWithVisits, getTrip } from "@/lib/data";
import {
  getArbitratedPinStatus,
  getCanonicalCurrentTrip,
  isWithinTrip,
  pickRepresentativeVisit,
  tripDay,
} from "@/lib/status";
import { haversineMiles } from "@/lib/geo";
import { countryToContinent } from "@/lib/continents";
import { TripStats } from "@/components/About/TripStats";

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const [cities, updates, trip] = await Promise.all([
    getCitiesWithVisits(),
    getAllDailyUpdates(),
    getTrip(),
  ]);

  const now = new Date();
  // Arbitrated against the canonical current city (see getCanonicalCurrentTrip)
  // rather than each city's own timezone independently, so a city can't get
  // counted as "traveled" an hour early during a changeover between two
  // cities in different timezones.
  const canonicalCurrent = getCanonicalCurrentTrip(cities, trip, now);
  // Scoped to visits inside the 26/27 trip, same as the map's travels mode.
  // Without this, every historic city (already "visited") gets counted too.
  const traveledStops = cities
    .filter((c) => c.pin_type === "trip")
    .map((c) => ({
      city: c,
      visit: pickRepresentativeVisit(
        c.visits.filter((v) => isWithinTrip(v, trip)),
        c.timezone,
        now
      ),
    }))
    .filter(
      (x) => x.visit && getArbitratedPinStatus(x.city, x.visit, canonicalCurrent, now) !== "upcoming"
    )
    .sort((a, b) => a.visit!.start_date.localeCompare(b.visit!.start_date));

  const traveledCities = traveledStops.map((x) => x.city);
  const citiesCount = traveledCities.length;
  const countriesCount = new Set(traveledCities.map((c) => c.country)).size;

  // Day trips are spurs off a stay, not part of the route, so they count as
  // cities but stay out of the mileage chain (matches the map's route line).
  const routeCities = traveledStops.filter((x) => !x.visit!.is_day_trip).map((x) => x.city);
  let miles = 0;
  for (let i = 1; i < routeCities.length; i++) {
    miles += haversineMiles(
      routeCities[i - 1].lat,
      routeCities[i - 1].lng,
      routeCities[i].lat,
      routeCities[i].lng
    );
  }
  const dayLabel = trip ? tripDay(trip.start_date, trip.end_date, now) : null;

  // All-time: every city with at least one visit, 26/27 or historic.
  const everVisitedCities = cities.filter((c) => c.pin_type === "trip" && c.visits.length > 0);
  const allTimeCitiesCount = everVisitedCities.length;
  const allTimeCountries = new Set(everVisitedCities.map((c) => c.country));
  const allTimeCountriesCount = allTimeCountries.size;
  const allTimeContinentsCount = new Set(
    Array.from(allTimeCountries).map(countryToContinent)
  ).size;

  return (
    <div className="min-h-screen pt-20 pb-24 px-4 sm:px-6">
      <article className="max-w-xl mx-auto prose-none">
        <h1 className="font-display text-[39px] mb-6">About</h1>

        {dayLabel && (
          <TripStats
            citiesCount={citiesCount}
            countriesCount={countriesCount}
            miles={miles}
            updatesCount={updates.length}
            day={dayLabel.day}
            totalDays={dayLabel.totalDays}
            allTimeCitiesCount={allTimeCitiesCount}
            allTimeCountriesCount={allTimeCountriesCount}
            allTimeContinentsCount={allTimeContinentsCount}
          />
        )}

        <h2 className="font-display text-[25px] mt-10 mb-3">Why</h2>
        <p className="text-text-secondary leading-relaxed">
          I&rsquo;m away for six+ months, this is the easiest way to keep people in the loop.
          The Check-in badge in the header shows the last time I marked myself safe. Will try
          to update this every few days but who knows. If I haven&rsquo;t marked myself as safe
          in a while feel free to panic.
        </p>

        <h2 className="font-display text-[25px] mt-10 mb-3">Changelog</h2>
        <ul className="space-y-4 text-text-secondary leading-relaxed">
          <li>
            <p className="text-text-primary font-medium">v1.5 &ndash; 7 November 2026</p>
            <p>
              Added anonymous usage tracking, see{" "}
              <a
                href="#tracking"
                className="text-accent hover:text-accent-hover underline"
              >
                Tracking
              </a>
              .
            </p>
          </li>
          <li>
            <p className="text-text-primary font-medium">v1.4 &ndash; 24 October 2026</p>
            <p>
              Removed route history from the map, with flights doubling back across the region it
              was looking messy. The map now shows just one historic journey (where I came from)
              and where I&rsquo;m going next.
            </p>
          </li>
          <li>
            <p className="text-text-primary font-medium">v1.3 &ndash; 7 October 2026</p>
            <p>
              Nov/Dec itinerary reworked, with Sun Moon Lake, Da Nang and Hue added to the map.
              Added proper error and 404 pages, the site now retries if the database hiccups
              instead of falling over, and fixed the map height on iPhone Safari.
            </p>
          </li>
          <li>
            <p className="text-text-primary font-medium">v1.2 &ndash; 22 September 2026</p>
            <p>
              Day trips added, Hanoi swapped in for the dropped China leg (sorry China), added an
              Arina sprite, fixed a changeover day bug where two cities could show as current at
              once, smoother popup scrolling and toggle animation, streamlined lines, assorted
              fixes (timeline ordering, species pluralisation, improved colour contrast).
            </p>
          </li>
          <li>
            <p className="text-text-primary font-medium">v1.1 &ndash; 10 August 2026</p>
            <p>
              Visits data model (repeat stays), historic trips mapped in, a 26/27 Travels/All-time
              map filter, &ldquo;I&rsquo;m safe&rdquo; check-in, redesigned popup and timeline,
              trip stats, new design system.
            </p>
            <p className="text-text-muted text-[13px] mt-1">
              Note: All time stats and places visited is not complete, will populate when I have
              time.
            </p>
          </li>
          <li>
            <p className="text-text-primary font-medium">v1.0 &ndash; 26 July 2026</p>
            <p>Map, current location, check-ins, popup content, route lines.</p>
          </li>
        </ul>

        <h2 className="font-display text-[25px] mt-10 mb-3">Decisions for V1</h2>
        <ul className="space-y-3 text-text-secondary leading-relaxed list-disc pl-5">
          <li>Mapbox &gt; OpenStreetMap due to the ease of styling.</li>
          <li>
            The early plan included blog entries and photo uploads but once sketched out felt
            v 2009. One-line status updates are used instead, kind of like IG stories without
            using a Meta product. Aiming for this site to be a live pin board, not a blog.
          </li>
          <li>
            The timeline is there to collate daily updates and will be expanded on in later
            updates.
          </li>
        </ul>

        <h2 className="font-display text-[25px] mt-10 mb-3">Still to come</h2>
        <ul className="space-y-2 text-text-secondary leading-relaxed list-disc pl-5">
          <li>More historic trips added.</li>
          <li>A little wave animation before the map settles.</li>
        </ul>

        <h2 className="font-display text-[25px] mt-10 mb-3">Built with</h2>
        <p className="text-text-secondary leading-relaxed">
          Next.js, Supabase, Mapbox, Vercel. Designed in Figma, built with Claude Code.
        </p>

        <h2 id="tracking" className="font-display text-[25px] mt-10 mb-3 scroll-mt-20">
          Tracking
        </h2>
        <div className="space-y-3 text-text-secondary leading-relaxed">
          <p>
            I record a few anonymous actions: which pages get opened, which pins get tapped and
            closed, whether the toggle gets used, how long a visit lasts, and what kind of device
            it&rsquo;s on.
          </p>
          <p>
            Each visit gets a random ID that&rsquo;s cleared when you close the tab. No cookies, and
            I don&rsquo;t save your IP address.
          </p>
          <p>
            The site also uses Vercel&rsquo;s standard page counts, and the map is served by
            Mapbox, which sees your IP address like any map provider does.
          </p>
        </div>

        <p className="mt-10 text-sm text-text-muted">
          Bugs, ideas, anything -{" "}
          <a
            href="mailto:feedback@whereiskara.com"
            className="text-accent hover:text-accent-hover underline"
          >
            feedback@whereiskara.com
          </a>
        </p>

        <p className="mt-2 text-sm text-text-muted">
          <a
            href="https://github.com/karatravadi/WhereIsKara"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            GitHub
          </a>
          {" · "}
          <a
            href="https://www.linkedin.com/in/karatravadi/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover underline"
          >
            LinkedIn
          </a>
        </p>
      </article>
    </div>
  );
}
