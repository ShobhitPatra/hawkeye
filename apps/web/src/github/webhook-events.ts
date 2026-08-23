type InstallationAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "new_permissions_accepted";

export type WebhookEvent =
  | {
      type: "installation";
      action: InstallationAction;
      installation: { id: number; account: { login: string; type: string } };
      sender: { id: number; login: string };
    }
  | { type: "ignored"; eventName: string };

const INSTALLATION_ACTIONS: ReadonlySet<InstallationAction> = new Set([
  "created",
  "deleted",
  "suspend",
  "unsuspend",
  "new_permissions_accepted",
]);

function isInstallationAction(action: string): action is InstallationAction {
  return INSTALLATION_ACTIONS.has(action as InstallationAction);
}

function parseInstallationEvent(eventName: string, payload: unknown): WebhookEvent {
  const body = payload as {
    action?: unknown;
    installation?: { id?: unknown; account?: { login?: unknown; type?: unknown } };
    sender?: { id?: unknown; login?: unknown };
  };

  if (typeof body.action !== "string" || !isInstallationAction(body.action)) {
    return { type: "ignored", eventName };
  }

  const installation = body.installation;
  const sender = body.sender;
  if (
    !installation ||
    typeof installation.id !== "number" ||
    !installation.account ||
    typeof installation.account.login !== "string" ||
    typeof installation.account.type !== "string"
  ) {
    throw new Error("installation webhook payload is missing required installation fields");
  }
  if (!sender || typeof sender.id !== "number" || typeof sender.login !== "string") {
    throw new Error("installation webhook payload is missing required sender fields");
  }

  return {
    type: "installation",
    action: body.action,
    installation: {
      id: installation.id,
      account: { login: installation.account.login, type: installation.account.type },
    },
    sender: { id: sender.id, login: sender.login },
  };
}

export function parseWebhookEvent(eventName: string, payload: unknown): WebhookEvent {
  if (eventName === "installation") return parseInstallationEvent(eventName, payload);
  return { type: "ignored", eventName };
}
