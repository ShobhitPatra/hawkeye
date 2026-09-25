import { Mark } from "./mark";

export function Wordmark({ href }: { href: string }) {
  return (
    <a className="hk-wordmark hk-lockup" href={href}>
      <Mark />
      <span className="hk-wordmark-text">hawkeye</span>
    </a>
  );
}
