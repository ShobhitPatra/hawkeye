"use client";

import { useEffect, useState } from "react";

const ROTATION_MS = 4000;
const ROTATION_CYCLES = 2;
const LEAVE_MS = 240;
const WORDS = ["Claude", "Codex"];

export function RotatingWord() {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let shown = 0;
    let current = 0;
    let settle: number | undefined;
    const timer = window.setInterval(() => {
      shown += 1;
      if (shown >= WORDS.length * ROTATION_CYCLES) {
        window.clearInterval(timer);
        return;
      }
      setLeaving(current);
      current = (current + 1) % WORDS.length;
      setIndex(current);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setLeaving(undefined), LEAVE_MS);
    }, ROTATION_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(settle);
    };
  }, []);
  return (
    <span className="ld-rot">
      {WORDS.map((word, wordIndex) => (
        <span
          key={word}
          aria-hidden={wordIndex === index ? undefined : true}
          data-leaving={wordIndex === leaving ? "" : undefined}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
