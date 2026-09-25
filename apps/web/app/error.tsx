"use client";

import { Mark } from "./mark";
import { PageError, type PageErrorProps } from "./page-error";

export default function RootError({ reset }: PageErrorProps) {
  return (
    <>
      <header className="hk-topbar">
        <a className="hk-wordmark hk-lockup" href="/">
          <Mark />
          <span className="hk-wordmark-text">hawkeye</span>
        </a>
      </header>
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
    </>
  );
}
