"use client";

import { useEffect, useState } from "react";

const WORDS = ["Claude", "Codex"];

export function RotatingWord() {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setLeaving(true);
      setTimeout(() => {
        setIndex((current) => (current + 1) % WORDS.length);
        setLeaving(false);
      }, 320);
    }, 3200);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="ld-rot">
      {WORDS.map((word, wordIndex) => (
        <span
          key={word}
          aria-hidden={wordIndex === index ? undefined : true}
          data-leaving={wordIndex === index && leaving ? "" : undefined}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
