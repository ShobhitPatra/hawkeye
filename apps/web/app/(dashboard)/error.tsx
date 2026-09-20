"use client";

import Link from "next/link";
import { PageError, type PageErrorProps } from "../page-error";

export default function DashboardError({ reset }: PageErrorProps) {
  return (
    <main className="hk-page">
      <PageError
        reset={reset}
        onward={
          <Link className="hk-compact" href="/overview">
            Overview
          </Link>
        }
      />
    </main>
  );
}
