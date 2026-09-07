"use client";

import { useState } from "react";
import { type Theme, THEME_COOKIE, THEMES, themeAttribute } from "@/theme";

const LABELS: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function ThemeChoice({ theme }: { theme: Theme }) {
  const [current, setCurrent] = useState(theme);
  const choose = (next: Theme) => {
    setCurrent(next);
    const attribute = themeAttribute(next);
    if (attribute) document.documentElement.dataset.theme = attribute;
    else delete document.documentElement.dataset.theme;
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  };
  return (
    <fieldset className="hk-choice hk-menu-theme">
      <legend>Theme</legend>
      {THEMES.map((option) => (
        <label key={option}>
          <input
            type="radio"
            name="theme"
            value={option}
            checked={current === option}
            onChange={() => choose(option)}
          />
          {LABELS[option]}
        </label>
      ))}
    </fieldset>
  );
}
