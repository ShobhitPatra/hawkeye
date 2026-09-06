import { reviewingBadgeSvg } from "@/reviewing-line";

export function GET(request: Request) {
  const runner = new URL(request.url).searchParams.get("runner") ?? "your runner";
  return new Response(reviewingBadgeSvg(runner.slice(0, 64)), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
