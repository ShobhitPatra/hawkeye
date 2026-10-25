"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function RepositoryFilter({
  repositories,
  current,
  all,
}: {
  repositories: string[];
  current: string | undefined;
  all: boolean;
}) {
  const pathname = usePathname();
  const line = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = line.current;
    const link = nav?.querySelector('[aria-current="page"]');
    if (!nav || !link) return;
    const overflow =
      link.getBoundingClientRect().right -
      nav.getBoundingClientRect().right +
      Number.parseFloat(getComputedStyle(nav).paddingRight);
    if (overflow > 0) nav.scrollLeft += overflow;
  }, [current]);
  return (
    <nav ref={line} className="hk-filter" aria-label="Repositories">
      <Link href={pathname} aria-current={all ? "page" : undefined}>
        All
      </Link>
      {repositories.map((name) => (
        <Link
          key={name}
          href={`${pathname}?repo=${name.split("/").map(encodeURIComponent).join("/")}`}
          aria-current={name === current ? "page" : undefined}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}
