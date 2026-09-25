"use client";

import { Wordmark } from "./wordmark";
import { PageError, type PageErrorProps } from "./page-error";

export default function RootError({ reset }: PageErrorProps) {
  return (
    <>
      <header className="hk-topbar">
        <Wordmark href="/" />
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
