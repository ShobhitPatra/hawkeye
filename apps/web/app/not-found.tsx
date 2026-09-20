import { SiteFrame } from "./site-frame";

export const metadata = { title: "Not found, Hawkeye" };

export default function NotFound() {
  return (
    <SiteFrame>
      <div className="hk-state">
        <p>There is no page at this address.</p>
        <p>
          The link may be wrong, or the page may have moved. <a href="/">Go to the start</a>.
        </p>
      </div>
    </SiteFrame>
  );
}
