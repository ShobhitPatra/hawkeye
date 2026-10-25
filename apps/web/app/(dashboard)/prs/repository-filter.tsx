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
    line.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
