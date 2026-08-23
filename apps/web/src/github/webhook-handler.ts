import type { GitHubClient } from "@hawkeye/core";
import type { Db } from "../db/client";
import { recordInstallation } from "../installations";
import { handlePullRequestEvent } from "../pull-request-events";
import { parseWebhookEvent } from "./webhook-events";
import { verifyWebhookSignature } from "./webhook-signature";

function json(body: unknown, status: number) {
  return Response.json(body, { status });
}

export async function handleWebhook(
  request: Request,
  deps: { secret: string; db: Db; github: GitHubClient },
): Promise<Response> {
  const body = await request.text();
  if (
    !verifyWebhookSignature({
      secret: deps.secret,
      body,
      signatureHeader: request.headers.get("x-hub-signature-256"),
    })
  ) {
    return json({ error: "invalid signature" }, 401);
  }

  const eventName = request.headers.get("x-github-event");
  if (!eventName) {
    return json({ error: "missing event header" }, 400);
  }

  let event;
  try {
    event = parseWebhookEvent(eventName, JSON.parse(body));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid payload" }, 400);
  }

  if (event.type === "ignored") return json({ ignored: event.eventName }, 200);

  if (event.type === "pull_request") {
    const { enqueued, disarmed } = await handlePullRequestEvent(
      { db: deps.db, github: deps.github },
      event,
    );
    return json({ ok: true, enqueued, disarmed }, 200);
  }

  await recordInstallation(deps.db, event);
  return json({ ok: true }, 200);
}
