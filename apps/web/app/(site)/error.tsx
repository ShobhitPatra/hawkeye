"use client";

import { PageError, type PageErrorProps } from "../page-error";

export default function SiteError({ reset }: PageErrorProps) {
  return (
    <PageError
      reset={reset}
      onward={
        <a className="hk-compact" href="/">
          Go to the start
        </a>
      }
    />
  );
}
