export default function Loading() {
  return (
    <main className="hk-page">
      <div className="hk-header">
        <h1 className="hk-title">Pull requests</h1>
      </div>
      <div className="hk-state">
        <p>Fetching your open pull requests from GitHub.</p>
      </div>
      <div className="hk-skeleton" data-rows aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
