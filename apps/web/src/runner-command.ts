import { HAWKEYE_HOSTED_URL } from "@hawkeye/core";

export function connectCommand(controlPlaneUrl: string): string {
  return controlPlaneUrl === HAWKEYE_HOSTED_URL
    ? "npx hawkeye-review runner"
    : `npx hawkeye-review runner --url ${controlPlaneUrl}`;
}
