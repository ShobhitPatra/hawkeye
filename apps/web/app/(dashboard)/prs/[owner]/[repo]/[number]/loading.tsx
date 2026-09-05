export default function Loading() {
  return (
    <main className="hk-page">
      <nav className="hk-crumb" aria-hidden="true">
        <span>Pull requests</span>
      </nav>
      <div className="hk-state">
        <p>Fetching the review.</p>
      </div>
      <div className="hk-skeleton" data-rows aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
    </main>
  );
}
