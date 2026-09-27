// The address is always named: without --url a machine already connected to another control plane
// keeps that connection, and with it the runner refuses and says how to switch.
export function connectCommand(controlPlaneUrl: string): string {
  return `npx hawkeye-review runner --url ${controlPlaneUrl}`;
}
