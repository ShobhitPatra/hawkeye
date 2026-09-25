"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

export function Menu({
  summary,
  children,
  icon,
}: {
  summary: ReactNode;
  children: ReactNode;
  icon?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const element = details.current;
    if (!element) return;
    element.open = false;
  }, [pathname]);
  useEffect(() => {
    const element = details.current;
    if (!element) return;
    const outside = (event: PointerEvent) => {
      if (!element.open || element.contains(event.target as Node)) return;
      element.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.open) return;
      element.open = false;
      element.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details className="hk-menu" data-icon={icon ? "" : undefined} ref={details}>
      {summary}
      <div className="hk-menu-panel">{children}</div>
    </details>
  );
}
