import { TableSkeleton } from "../table-skeleton";

export default function Loading() {
  return (
    <main className="hk-page">
      <div className="hk-header">
        <h1 className="hk-title">Pull requests</h1>
      </div>
      <div className="hk-state">
        <p>Fetching your open pull requests from GitHub.</p>
      </div>
      <TableSkeleton
        columns={[
          { label: "Pull request", width: "72%", stacked: true },
          { label: "Status", width: "60%" },
          { label: "Round", numeric: true, width: "2ch" },
          { label: "Findings", numeric: true, width: "2ch" },
          { label: "Reviewed", width: "9ch" },
          { label: "", width: "8ch" },
        ]}
      />
    </main>
  );
}
