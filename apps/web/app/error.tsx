"use client";

import { PageError, type PageErrorProps } from "./page-error";

export default function RootError({ reset }: PageErrorProps) {
  return (
    <main className="hk-page">
      <PageError
        reset={reset}
        onward={
          <a className="hk-compact" href="/">
            Go to the start
          </a>
        }
      />
    </main>
  );
}
