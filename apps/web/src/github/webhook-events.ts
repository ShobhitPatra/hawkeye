type InstallationAction =
  | "created"
  | "deleted"
  | "suspend"
  | "unsuspend"
  | "new_permissions_accepted";

export type PullRequestEvent = {
  type: "pull_request";
  action: string;
  repository: { owner: string; name: string };
  number: number;
  headSha: string;
  baseSha: string;
  draft: boolean;
  merged: boolean;
  installationId: string;
  authorId: string;
};

export type WebhookEvent =
  | {
      type: "installation";
      action: InstallationAction;
      installation: { id: number; account: { login: string; type: string } };
      sender: { id: number; login: string };
    }
  | PullRequestEvent
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

function parsePullRequestEvent(payload: unknown): WebhookEvent {
  const body = payload as {
    action?: unknown;
    installation?: { id?: unknown };
    repository?: { name?: unknown; owner?: { login?: unknown } };
    pull_request?: {
      number?: unknown;
      draft?: unknown;
      merged?: unknown;
      head?: { sha?: unknown };
      base?: { sha?: unknown };
      user?: { id?: unknown };
    };
  };

  if (typeof body.action !== "string") {
    throw new Error("pull_request webhook payload is missing its action");
  }
  if (!body.installation || typeof body.installation.id !== "number") {
    throw new Error("pull_request webhook payload is missing required installation fields");
  }
  const repository = body.repository;
  if (
    !repository ||
    typeof repository.name !== "string" ||
    !repository.owner ||
    typeof repository.owner.login !== "string"
  ) {
    throw new Error("pull_request webhook payload is missing required repository fields");
  }
  const pullRequest = body.pull_request;
  if (
    !pullRequest ||
    typeof pullRequest.number !== "number" ||
    typeof pullRequest.draft !== "boolean" ||
    !pullRequest.head ||
    typeof pullRequest.head.sha !== "string" ||
    !pullRequest.base ||
    typeof pullRequest.base.sha !== "string" ||
    !pullRequest.user ||
    typeof pullRequest.user.id !== "number"
  ) {
    throw new Error("pull_request webhook payload is missing required pull request fields");
  }

  return {
    type: "pull_request",
    action: body.action,
    repository: { owner: repository.owner.login, name: repository.name },
    number: pullRequest.number,
    headSha: pullRequest.head.sha,
    baseSha: pullRequest.base.sha,
    draft: pullRequest.draft,
    merged: pullRequest.merged === true,
    installationId: String(body.installation.id),
    authorId: String(pullRequest.user.id),
  };
}

export function parseWebhookEvent(eventName: string, payload: unknown): WebhookEvent {
  if (eventName === "installation") return parseInstallationEvent(eventName, payload);
  if (eventName === "pull_request") return parsePullRequestEvent(payload);
  return { type: "ignored", eventName };
}
