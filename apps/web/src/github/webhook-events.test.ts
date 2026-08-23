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
    const event = parseWebhookEvent("pull_request", { action: "opened" });
    expect(event).toEqual({ type: "ignored", eventName: "pull_request" });
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
