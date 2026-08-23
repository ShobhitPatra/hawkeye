import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "./webhook-events";

const installation = { id: 123, account: { login: "octocat", type: "User" } };
const sender = { id: 456, login: "octocat" };

describe("parseWebhookEvent", () => {
  it("parses an installation.created event", () => {
    const event = parseWebhookEvent("installation", { action: "created", installation, sender });
    expect(event).toEqual({ type: "installation", action: "created", installation, sender });
  });

  it("parses an installation.deleted event", () => {
    const event = parseWebhookEvent("installation", { action: "deleted", installation, sender });
    expect(event).toEqual({ type: "installation", action: "deleted", installation, sender });
  });

  it("parses an installation.suspend event", () => {
    const event = parseWebhookEvent("installation", { action: "suspend", installation, sender });
    expect(event).toEqual({ type: "installation", action: "suspend", installation, sender });
  });

  it("parses an installation.unsuspend event", () => {
    const event = parseWebhookEvent("installation", { action: "unsuspend", installation, sender });
    expect(event).toEqual({ type: "installation", action: "unsuspend", installation, sender });
  });

  it("parses an installation.new_permissions_accepted event", () => {
    const event = parseWebhookEvent("installation", {
      action: "new_permissions_accepted",
      installation,
      sender,
    });
    expect(event).toEqual({
      type: "installation",
      action: "new_permissions_accepted",
      installation,
      sender,
    });
  });

  it("returns ignored for an unknown event name", () => {
    const event = parseWebhookEvent("ping", { zen: "hi" });
    expect(event).toEqual({ type: "ignored", eventName: "ping" });
  });

  it("returns ignored for an unknown installation action", () => {
    const event = parseWebhookEvent("installation", { action: "renamed", installation, sender });
    expect(event).toEqual({ type: "ignored", eventName: "installation" });
  });

  it("throws when the installation payload is missing the installation field", () => {
    expect(() => parseWebhookEvent("installation", { action: "created", sender })).toThrow();
  });

  it("throws when the installation payload is missing the sender field", () => {
    expect(() => parseWebhookEvent("installation", { action: "created", installation })).toThrow();
  });

  it("throws when the installation account is missing required fields", () => {
    expect(() =>
      parseWebhookEvent("installation", {
        action: "created",
        installation: { id: 123, account: { login: "octocat" } },
        sender,
      }),
    ).toThrow();
  });
});

function pullRequestPayload(
  overrides: Record<string, unknown> = {},
  pullRequestOverrides: Record<string, unknown> = {},
) {
  return {
    action: "synchronize",
    installation: { id: 10 },
    repository: { name: "repo", owner: { login: "octo" } },
    ...overrides,
    pull_request: {
      number: 7,
      draft: false,
      merged: false,
      head: { sha: "h".repeat(40) },
      base: { sha: "b".repeat(40) },
      ...pullRequestOverrides,
    },
  };
}

describe("parseWebhookEvent for pull_request", () => {
  it("parses a synchronize event", () => {
    expect(parseWebhookEvent("pull_request", pullRequestPayload())).toEqual({
      type: "pull_request",
      action: "synchronize",
      repository: { owner: "octo", name: "repo" },
      number: 7,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      draft: false,
      merged: false,
      installationId: "10",
    });
  });

  it("parses a ready_for_review event", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload({ action: "ready_for_review" }),
    );
    expect(event).toMatchObject({ action: "ready_for_review", draft: false });
  });

  it("treats a null merged flag as not merged", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload({ action: "closed" }, { merged: null }),
    );
    expect(event).toMatchObject({ type: "pull_request", action: "closed", merged: false });
  });

  it("parses a closed event that was merged", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload({ action: "closed" }, { merged: true }),
    );
    expect(event).toMatchObject({ action: "closed", merged: true });
  });

  it("parses an opened draft event", () => {
    const event = parseWebhookEvent(
      "pull_request",
      pullRequestPayload({ action: "opened" }, { draft: true }),
    );
    expect(event).toMatchObject({ action: "opened", draft: true });
  });

  it("parses a reopened event", () => {
    expect(
      parseWebhookEvent("pull_request", pullRequestPayload({ action: "reopened" })),
    ).toMatchObject({
      action: "reopened",
    });
  });

  it("keeps an action it does not act on", () => {
    expect(
      parseWebhookEvent("pull_request", pullRequestPayload({ action: "labeled" })),
    ).toMatchObject({ action: "labeled" });
  });

  it("throws when the installation is missing", () => {
    const payload = pullRequestPayload();
    delete (payload as Record<string, unknown>).installation;
    expect(() => parseWebhookEvent("pull_request", payload)).toThrow(/installation/);
  });

  it("throws when the repository owner is missing", () => {
    expect(() =>
      parseWebhookEvent("pull_request", pullRequestPayload({ repository: { name: "repo" } })),
    ).toThrow(/repository/);
  });

  it("throws when the head sha is missing", () => {
    const payload = pullRequestPayload();
    delete (payload.pull_request as Record<string, unknown>).head;
    expect(() => parseWebhookEvent("pull_request", payload)).toThrow(/pull request/);
  });

  it("throws when the action is missing", () => {
    const payload = pullRequestPayload();
    delete (payload as Record<string, unknown>).action;
    expect(() => parseWebhookEvent("pull_request", payload)).toThrow(/action/);
  });
});
