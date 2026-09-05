"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/prs", label: "Pull requests" },
  { href: "/runners", label: "Runners" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="hk-nav" aria-label="Primary">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={
            pathname === link.href || pathname.startsWith(`${link.href}/`) ? "page" : undefined
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
