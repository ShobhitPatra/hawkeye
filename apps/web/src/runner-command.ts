import { HAWKEYE_HOSTED_URL } from "@hawkeye/core";

export function urlFlag(controlPlaneUrl: string): string {
  return controlPlaneUrl === HAWKEYE_HOSTED_URL ? "" : ` --url ${controlPlaneUrl}`;
}
