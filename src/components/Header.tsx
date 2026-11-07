import Image from "next/image";
import Link from "next/link";

export function Header() {
  return (
    <header className="fixed top-0 inset-x-0 z-30 h-14 flex items-center px-4 sm:px-6 bg-bg/95 backdrop-blur border-b border-border">
      <Link href="/" data-nav="logo" className="flex items-center gap-2 min-w-0">
        <Image
          src="/kara/header-logo.png"
          alt=""
          width={28}
          height={28}
          className="rounded-full shrink-0"
          priority
        />
        <span className="font-bold text-lg sm:text-xl text-text-primary truncate">
          Where in the world is Kara?
        </span>
      </Link>
    </header>
  );
}
