import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <main className="hk-page">
      <div className="hk-state">
        <p>There is no page at this address.</p>
        <p>
          If a link to a pull request brought you here, Hawkeye has no record of it. Go to{" "}
          <Link href="/overview">Overview</Link> or <Link href="/prs">Pull requests</Link>.
        </p>
      </div>
    </main>
  );
}
