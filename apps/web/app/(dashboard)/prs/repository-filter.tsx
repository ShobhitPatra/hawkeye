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
    const box = nav.getBoundingClientRect();
    const item = link.getBoundingClientRect();
    const style = getComputedStyle(nav);
    const before = item.left - box.left - Number.parseFloat(style.paddingLeft);
    const after = item.right - box.right + Number.parseFloat(style.paddingRight);
    if (before < 0) nav.scrollLeft += before;
    else if (after > 0) nav.scrollLeft += after;
  }, [current, all]);
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
