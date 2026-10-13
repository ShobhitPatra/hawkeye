export const LANDING_REVIEW = {
  owner: "ShobhitPatra",
  repo: "hawkeye",
  number: 87,
  title: "feat(web): show a reviewing line in the living review from claim time",
  branch: "feat/web-reviewing-line",
  headSha: "989dcb7",
  runner: "shobhit-fedora",
  url: "https://github.com/ShobhitPatra/hawkeye/pull/87",
  terminal: [
    { at: "05:57:40", state: "claimed", detail: "ShobhitPatra/hawkeye#87 at 989dcb7", delayMs: 0 },
    {
      at: "05:57:46",
      state: "reviewing",
      detail: "~/.cache/hawkeye/runs/20260906-055740-ShobhitPatra-hawkeye-87",
      delayMs: 500,
    },
    { at: "06:00:28", state: "posted", detail: "", delayMs: 2000 },
  ],
  posted: { verdict: "Blocked", findings: 4, mustFix: 1, turns: 6, duration: "2m 48s" },
  bodyHtml:
    '<h3>Blocked</h3>\n<ul>\n<li>Round one through the placeholder with any line-anchored finding records the supplemental review as the living review, so round two patches the wrong comment.</li>\n<li>The early superseded/already-posted returns in postReviewForRun never clear the placeholder, leaving a permanently shimmering &quot;Reviewing on&quot; comment.</li>\n<li>Otherwise well-scoped: escaped badge, additive migration, docs in lockstep, good unit coverage of the block and the mark/clear paths.</li>\n</ul>\n<h4>Must fix</h4>\n<ul>\n<li><p><strong>Round one via the placeholder records the supplemental review id as the living review.</strong> <code>apps/web/src/review-posting.ts:292</code>\nWith inline comments, <code>record(supplemental.id)</code> runs and the body is written to the placeholder, but this is the only reviewPosted row, so <code>livingReviewFor</code> returns the supplemental review. Round two then prepends the reviewing line to that marker-only comment and overwrites it, stranding round one&#39;s body in the placeholder. <code>59b565718f8d</code></p>\n<details><summary>why</summary>\n\n<p>livingReviewFor orders by postedAt asc; before this PR round one went through the postRenderedReview branch and recorded the id of the review that actually holds the body. The placeholder branch breaks that invariant only when comments.length &gt; 0, which is the common case for a first review with an anchored finding.</p>\n</details></li>\n</ul>\n<h4>Should fix</h4>\n<ul>\n<li><strong>The in-transaction superseded and already-posted returns never close the placeholder.</strong> <code>apps/web/src/review-posting.ts:185</code>\nA newer job that finishes first makes this return <code>superseded</code> before <code>living</code>/<code>placeholder</code> is resolved, so the round-one placeholder keeps the animated &quot;Reviewing on&quot; badge forever. Only the later supersede check (after the token fetch) clears it, and that is the only path tested. <code>ca837f2d66b5</code></li>\n</ul>\n<h4>Optional</h4>\n<ul>\n<li><strong>Failed or superseded rounds accumulate dead placeholder comments on the pull request.</strong> <code>apps/web/src/runner-api.ts:197</code>\nA closed placeholder never becomes a living review, so the next claim posts a fresh one; three failed rounds leave three &quot;The review did not complete.&quot; comments. Reusing the closed placeholder, or minimizing it, keeps the thread to one. <code>88ec8597af01</code></li>\n<li><strong>The route test is not colocated with the route it tests.</strong> <code>apps/web/src/reviewing-route.test.ts:2</code>\nAGENTS.md asks for tests beside the module; this one sits in <code>src/</code> because the vitest include glob is <code>apps/*/src/**</code>. Widening the glob would let it live next to <code>app/status/reviewing/route.ts</code>. <code>b9e6dff28126</code></li>\n</ul>\n<hr>\n<p>Reviewed by <a href="https://github.com/ShobhitPatra/hawkeye">Hawkeye</a> on the author&#39;s own plan \u00b7 round 1 \u00b7 6 turns</p>',
} as const;
