"use client";

import { Analytics } from "@vercel/analytics/next";
import { publicPageUrl } from "@/public-page-url";

// The landing's returnTo query can carry the path of a private repository's pull request.
export function PublicAnalytics() {
  return <Analytics beforeSend={(event) => ({ ...event, url: publicPageUrl(event.url) })} />;
}
