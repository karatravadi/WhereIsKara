import Link from "next/link";
import { getTrip } from "@/lib/data";
import { tripDay } from "@/lib/status";

export async function Footer() {
  const trip = await getTrip().catch(() => null);
  const dayLabel = trip ? tripDay(trip.start_date, trip.end_date) : null;

  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 h-11 grid grid-cols-3 items-center px-4 sm:px-6 bg-bg/95 backdrop-blur border-t border-border text-xs text-text-secondary">
      <span>{dayLabel ? `Day ${dayLabel.day} of ${dayLabel.totalDays}` : ""}</span>
      <nav className="flex items-center justify-center gap-4 col-start-2">
        <Link href="/" data-nav="map" className="hover:text-text-primary transition-colors">
          Map
        </Link>
        <Link href="/timeline" data-nav="timeline" className="hover:text-text-primary transition-colors">
          Timeline
        </Link>
        <Link href="/about" data-nav="about" className="hover:text-text-primary transition-colors">
          About
        </Link>
      </nav>
    </footer>
  );
}
