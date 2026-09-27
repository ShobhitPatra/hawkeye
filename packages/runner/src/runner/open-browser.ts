import { spawn } from "node:child_process";

export function browserOpener(input: {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
}): string | undefined {
  if (input.env.SSH_CONNECTION || input.env.SSH_TTY) return undefined;
  if (input.platform === "darwin") return "open";
  if (input.platform === "linux" && (input.env.DISPLAY || input.env.WAYLAND_DISPLAY))
    return "xdg-open";
  return undefined;
}

export function openInBrowser(command: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
