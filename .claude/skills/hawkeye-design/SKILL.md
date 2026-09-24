---
name: hawkeye-design
description: "Design, build, or restyle any Hawkeye surface: the control plane dashboard, the review comment posted on GitHub, the CLI output, docs and any landing page. Use whenever a change touches what a user sees or reads. Carries the product's voice, visual system, tokens, primitives and the list of things Hawkeye never does."
---

# Design Hawkeye

Hawkeye is a personal code reviewer. It reads a pull request on the author's own machine, on the author's own plan, and posts a judgment as `hawkeye[bot]`. The dashboard is an instrument panel the user owns, not a service they rent. The review comment is where most people first meet Hawkeye, and it delivers an opinion about someone's work. Every surface should carry that: sharp, quiet, trustworthy, unhurried, yours.

Never chatty, never gamified, never corporate SaaS. Confidence comes from precision and restraint, not from decoration, praise or exclamation.

## Priority order

When rules conflict, protect them in this order:

1. The facts of the review: verdict, severities, claims, paths, lines, counts. Never soften, reorder for effect, or hide a finding.
2. The repo's conventions and the shipped contracts (`core` exports, runner to control plane HTTP, the review comment shape already on people's pull requests).
3. The reader's job on this surface: decide whether to act, and on what, in one read.
4. The visual system below, applied exactly.
5. Polish.

## Surfaces

Four faces, one voice. The visual tokens apply to the dashboard and any landing page. Voice and structure apply everywhere.

- **Dashboard** (`apps/web`): pull request list, pull request detail, runners, connect, settings. Dense lists, editorial detail pages.
- **Review comment** on GitHub: markdown only. Structure and words carry the design.
- **CLI** (`hawkeye-review`): plain text, minimal color on a terminal, identical text without it.
- **Docs, README, landing**: same voice, same type, same restraint.

## Voice

- Sentence case everywhere, including buttons, headings and table headers.
- Human labels on every surface: "Must fix", "Should fix", "Optional", "Inherited"; "Ship", "Mergeable", "Changes needed", "Blocked". The wire keeps `must_fix` and friends; people never see snake_case.
- A review opens with the verdict and its one-line reason. No greeting, no praise, no summary of what the pull request does. Silence is the compliment.
- No hedges. A finding states what breaks and what to do. "Might", "consider", "it seems", "perhaps" mark a claim that is not a finding.
- Underlines exist only on links inside running text (prose, finding details, state sentences, help lines). Navigation, crumbs, table titles, the wordmark, menu items and buttons never underline, not even on hover; they shift color. The stylesheet enforces this through those classes, so a bare link on a page that is not restyled yet keeps its underline.
- Controls say what happens: "Review", "Pause", "Resume", "Re-review", "Start the runner". After the action, the state word changes; no toast that restates it.
- State sentences say what is true and what to do next: "Runner offline. 3 pull requests are waiting and will be reviewed when it reconnects."
- Errors say what went wrong, that nothing was lost when that is true, and the next step. No apologies.
- Name things as the user knows them: pull request, runner, review, finding, round. Not job, payload, webhook.
- No em dashes. No emoji. No exclamation marks.

## Visual system

### Color

Design in monochrome on a warm neutral. Color is a secondary cue, always paired with a word or position, and the whole palette is neutrals plus red plus amber.

- Neutrals: warm paper and graphite. Light ground `#f7f6f3`, dark ground `#131211`, never true black or pure white.
- Red (`--hk-must`) only for: the "Must fix" label, the "Blocked" verdict word, and a failed run.
- Amber (`--hk-warn`) only for states that need the user to act: runner offline, pull requests waiting.
- No green. A posted review, a passing verdict, an online runner are the normal state and stay neutral.
- No blue. Focus rings use the foreground color.
- Whether a pull request is reviewed is the review control (`.hk-review-control`): a filled or hollow circle with its word beside it, Reviewing or Review, never a color. Hovering shows what a click does, Pause or Review; the moment after a click the word shimmers Starting or Pausing, and a refusal rolls the control back with one sentence under it. On a pull request page that has a posted review and reviews on, a plain button beside it reads Review from scratch; while the click is in flight it reads Queuing, and a refusal puts one sentence under it.
- Both themes always. The system preference is the default; the theme choice (Light, Dark, System) in the account menu and the landing bar is kept in a cookie and stamped on `<html>` as `data-theme` by the server, so no page flashes; System stamps nothing and follows the media query. Never ship a color that only exists in one theme.

### Typography

- IBM Plex Sans for everything read. IBM Plex Mono for paths, SHAs, pull request numbers, finding ids, durations, turn counts, the wordmark, and any identifier a person might copy. Set only the identifier in mono, never the sentence around it. The stylesheet reads the faces from `--font-plex-sans` and `--font-plex-mono` when the host defines them (the Next app does, through `next/font`) and falls back to the installed family names otherwise.
- Seven sizes and no others: metadata 12, compact 13, body 15, lede 17, heading 20, title 24, display 32. Lists and tables run at compact; detail pages and prose at body. One more, headline 44, exists for the landing page's first sentence and nowhere else.
- Three weights: regular 400, medium 500 for headings, claims and emphasis, semibold 600 for the verdict word and severity labels. Never bold a whole sentence.
- Prose measures 60 to 68 characters. Rewrite before shrinking.
- Hierarchy comes from type and spacing before any surface, border or color.
- The wordmark is `hawkeye`, lowercase, Plex Mono medium. It is how the product signs its reviews.

### The mark

A hawk in profile, in flight: one raised wing, a body line ending in a beak, a short tail, and a dot for the eye, facing right. Drawn on a 24 grid at stroke 1.5, the same weight as the interface icons (`mark.svg`). It is monochrome and takes the current color. It lives where there is no room for words: the GitHub App avatar (`avatar-light.svg`, one fixed image on the light palette, since GitHub does not follow the page theme), the favicon (`favicon.svg`, swaps stroke with the system theme; the app serves its own copies from `apps/web/public/`, regenerated from this file whenever the mark changes), and in a lockup with the bird before the wordmark (`.hk-lockup`, 20px, 8px gap) in the top bar, the landing footer, the README header and the social card. It never replaces the review control's circle. Do not fill it, add color, mirror it, or redraw it at another stroke.

### Spacing and shape

- Spacing steps: 4, 8, 12, 16, 24, 32, 48, 64. Within a group 4 to 12, between groups 16 to 24, between sections 32 to 48.
- Every gap has one owner: the parent's `gap`. Children carry no margins.
- Radii: 3px on controls and inputs, 6px on the rare surface that earns one. No box shadows anywhere; separation is a 1px line.
- Scrollbars, on the page and inside any panel that scrolls: thin, no track, the thumb in the hairline color, through the standard `scrollbar-width` and `scrollbar-color` properties only, so every browser draws the same bar and no hover state exists. The stylesheet sets the width on every element under `.hk-root` and the color once on `html`, where it inherits; a panel with its own palette sets its own color.
- The page is one continuous canvas. A bordered surface is earned only by interaction or a grouping that spacing cannot express. Never a card inside a card, never a card around a table.

### The margin column

The signature of Hawkeye is a reviewer's margin. Every entry in a list of findings is a two-column grid: a narrow gutter on the left carries the severity label, the lens and a line reference in small type; the body on the right carries the claim in medium weight, the path in mono, then the detail in body text. The same gutter carries round numbers, states and dates on other pages, so dense lists and editorial pages share one skeleton. Under 760px the gutter moves above its entry as one row.

### Icons

Lucide, stroke 1.5, one library and one weight everywhere, loaded from `lucide-react`. 16px inside controls and rows, 20px in empty states. Always beside a text label except chevrons and close. Never colored, never decorative, never an icon tile. The review control's circle is CSS, not an icon.

### Motion

Stillness by default. Two named exceptions signal that work is in flight, and nothing else moves:

- A list loading for the first time shows skeleton rows with a slow shimmer.
- A word naming in-flight work (Reviewing, Cloning, Fetching, Running) keeps its place while a highlight sweeps it left to right (`.hk-status[data-state="running"]`). A thin progress line under the top bar (`.hk-progress`) may accompany a page-level fetch.

Confirming an action is a state word changing, with at most a 160ms color transition. Reduced motion turns everything static. No pulsing dots, no spinners, no scroll reveals, no animated numbers.

### Formats

- Times: relative under 24 hours ("4 min ago"), then an absolute date ("28 Aug 2026").
- Durations: `6m 12s`, mono, tabular figures.
- Heads: 7 characters, mono. Pull requests: `#2519`, mono. Turns: plain integer, right-aligned.
- Paths: mono; when they must truncate, from the left so the filename survives (`.hk-path`).

## Per-surface rules

### Top bar

One bar, 44px, with a hairline beneath it, on every page. Signed in: the wordmark, then Overview, Pull requests, Runners, Settings, then at the right the small Updated 12 s ago line, an amber runner status only when a runner has waiting jobs, and the account name. The name opens a menu (`hk-menu`) holding the theme choice, the installation link and sign out, so Settings stays about review behavior. No avatar. The bar is sticky on dashboard pages and scrolls away on the landing. The current page is the foreground color; nothing is underlined. Under 760px the four words stay inline, the name collapses to its initial and the status word hides. Signed out: the wordmark, Source, the theme menu as a lone half-filled circle (`hk-menu[data-icon]`, labelled for assistive tech, the one icon without a visible word) holding the same three choices, and a Sign in button. The same bar on a site page for someone already signed in (the prose pages and the not-found page) swaps that button for a plain Dashboard button in the same place, linking to Overview, so the bar never offers a sign-in that is not needed.

### Overview

The signed-in root. It answers, in order: is the runner up and is anything waiting (one state sentence under the title); what has Hawkeye done (five figures in a row, each with a hairline above, the all-time number at title size and this month beneath as metadata: reviews, pull requests reviewed, findings raised with how many addressed, must-fix caught, cost as hours and minutes with turns beneath); the last year (a 52 by 7 grid of days, one cell per day, four neutral steps, a native title per cell, no color and no motion); recent reviews (five rows in the list style, linking to the detail pages). Sections sit 48px apart. A new account sees zeros, an empty grid and one sentence: "Nothing reviewed yet. Connect a runner and arm a pull request." Pull requests merged after a review joins the figures once the close webhook records it.

### Dashboard lists

A list is a table at compact size. Text columns left, numbers right, header alignment matches its cells. The title is the link; hover shifts its color, never underlines. The last column is the review control, circle and word, the one button in the row. Status is one word about the review itself: Queued, Waiting with runner offline in amber, In review with the shimmer, Run failed in red, or the verdict word; a pull request with reviews on and nothing yet reviewed shows no status word, the control already says Reviewing. A cell that needs a second line (repo under a title) stacks it as metadata, never as a second column. Status is a word, colored only by the rules above. Rows for unarmed or closed pull requests dim to secondary text. No row hover surfaces, no zebra stripes.

### Dashboard detail pages

Top to bottom: crumb; title row with the review control and Re-review at the right; meta line; verdict (word on its own line at heading size, reason below); findings in the margin column grouped by severity in contract order; rounds table; review lenses behind a disclosure; link to the comment on GitHub. The review control sits on the title line because turning reviews on or off is the one action the page exists for.

### Landing

The root route for a signed-out visitor. It is for someone who just read a Hawkeye comment on a pull request, then for someone who followed a link. It must prove the reviews are worth reading before it says what they cost. The headline block comes first: the headline with one word rotating between the harnesses, the lede, the sign-in button and the mono `npx hawkeye-review prepare <pr-url>` line as the no-account path. Then the hero: a flow line naming three acts (Open a pull request, The review runs on your machine, The review is posted) above one fixed-height stage (560px) that replays a real review of Hawkeye's own pull request, never a constructed example, screenshot or video. The stage shows one act at a time: the pull request as GitHub lists it with the pending Hawkeye status, then your machine's terminal with the daemon's own claimed, reviewing and posted lines, then the comment as GitHub renders it, first the shimmering Reviewing badge alone, then the review streaming in verdict first, the panel scrolling with it and settling at the top. The stage never grows; the comment scrolls inside it. A Replay control sits in the stage's bar. The review is a fixture rendered by the shipped renderer, and the caption links to the real pull request. Reduced motion shows the finished comment, every act lit, and the first headline word. The landing owns these two motion exceptions beyond the system's: the replay and the rotating word. Then four sections, each headed by what the visitor wants to know: what happens when you open a pull request (four steps in a row, each carrying what does not leave the machine), what it costs (one sentence), how to start, and "Open source, and reviewed by itself" (three facts on the steps row without numbers: the license and the self-review linking the repository's pull requests, the hosted instance in preview, how to contribute; self-hosting is documented but never linked from the landing). Proof is the repository link, the link to the real pull request, and the public reviews on the repository's pull requests. Primary action is "Sign in with GitHub". The footer is one line at the bottom of the page: the lockup, then Open source MIT, Reviews, Security, Privacy, Terms and the npm package, nothing else. Under two screens on a laptop. Same rules as every other surface, plus the headline size. Signing in lands on Overview, which is the dashboard home; a signed-in visit to the root route redirects there, and the wordmark in the top bar links there.

### Site pages

Security, Privacy and Terms are prose pages for a signed-out visitor, laid out as a frame the height of the viewport: the site header at the top, the footer at the bottom, and the prose scrolling between them with a fade at both edges and no visible scrollbar, so neither the bar nor the links ever move. Inside, a title, a lede, headings at heading size with sentences and short lists beneath. They say what the code does, in the product's words, with no legal register. A signed-in user reaches them from the bottom of the account menu, links at metadata size in tertiary text under Sign out (`.hk-menu-legal`); the dashboard has no footer.

### Funnel

An operator's page at `/admin/funnel`, not in the top bar: the title, one sentence saying the counts come from this instance's own database and go nowhere, the five steps as a figure row (the all-time number, and beneath it the share kept from the step before), then one table row per sign-up week with the same five counts as numeric columns. Empty is a sentence.

### Settings

Settings are a column of sections, each a heading, one sentence, and the controls, at `/settings`, the fourth word in the top bar. Sections exist only for settings the product acts on. Reviews is the first: two checkboxes stacked (`hk-choice[data-stack]`), "Review my pull requests automatically" and "Review drafts too", then the field "Wait after a push" as a whole number with the unit word beside it and a help line under it. Runner is the second, under a rule: its sentence says reviews run with Claude Code or Codex under the user's own login, then Harness as stacked radios (Claude Code, Codex) with a help line saying it is the CLI the runner reviews with and that a runner without it fails the review and says so, then Model as stacked radios, one per pinned model version the claude CLI accepts (Fable 5.1, Fable 5, Opus 5, Opus 4.8, Sonnet 5; no floating "latest" aliases) and The CLI's default (a saved model that has since left the list leaves no radio checked and adds a help line naming it and saying that saving switches to the choice above, or to the CLI's default if none is picked), with a help line saying it is passed to the claude CLI as --model, that Codex uses its own default, and that a runner started with --model keeps its own (a new model joins the list with a release; the page does not say so), then "Turns per review" (1 to 200), "Minutes per review" (1 to 60) and "Reviews at once" (1 to 3) as whole numbers, each with a help line naming the result it causes; the last says each review spends the plan, so more at once reaches its limits sooner. Theme stays in the account menu. When it exists, the contract override is a mono textarea with a sentence that it is appended to the review prompt on every run, and a link to the repo-level file. Save is a primary button per section in an action row; the sentence beside it states the result ("Saved. Applies from the next pull request event.") or the refusal in one sentence, no toast.

### Runners and connect

Runners are a table like any list: name, state word, last heartbeat, created. Revoke is a plain button in the row, never red; the confirmation is a sentence. A token shown once sits in a code block with a copy button beside it and one sentence saying it will not be shown again. The connect page is a numbered sequence, because it is one: run the command, type the code, approve. Its lede has a second paragraph at the same quiet size that says what connecting grants: a review runs a coding agent on that machine, as the user, over code they did not write; the editing and web tools are removed and the shell stays; it links the README's "What the runner can reach". A sentence, never a callout. The command is a code block with a copy button. A pending approval names the runner and when it asked, and tells the user to approve only their own machine.

### The review comment

Markdown, in this order and nothing else:

1. `### Revise` style level-three heading with the verdict word alone, then the one-line reason as a paragraph.
2. `#### Must fix`, `#### Should fix`, `#### Optional`, `#### Inherited`, only the groups that exist. Each finding is a list item: the claim in bold, the path and line in code, then the detail on the next line, then the finding id in code at the end. A finding posted inline says "Posted inline at the line." in place of its detail.
3. Prior findings, when any, as a list.
4. `<details>` for the rounds table and for the review lenses table.
5. The footer line crediting Hawkeye, with round and turn count.

While a review is running, the living review opens with a shimmering "Reviewing on shobhit-fedora" badge (an animated SVG the control plane serves, mid-tone text with no tile so it reads on both GitHub themes) and nothing else: the badge already says a review is running and names the runner, and GitHub cannot render a relative time, so no sentence or clock sits under it. The block is added when the runner claims the job and replaced by the result; a first round posts it as a placeholder review that the result fills. A run that fails or is superseded replaces the block with one plain sentence. A commit status on the head accompanies it: pending with "Reviewing on shobhit-fedora" while running, then success with the verdict and count ("Revise · 4 findings"). A run that fails ends the status as success with "Review did not complete" and keeps the detail in the dashboard; the status is never failure or error, because Hawkeye has opinions, not authority.

Middle dots separate inline facts. Ids stay visible because `hawkeye-review dismiss` takes them.

### The CLI

Plain text is the contract; color is decoration that must be removable. On a TTY without `NO_COLOR`: the verdict word bold, "Must fix" red, paths and ids in dim. Nothing else. Lines wrap at the terminal, never hard-wrapped.

The terminal is not where a review is read; the review lives on GitHub or in the round's result file. A command that ends in a verdict prints the verdict word, its reason, then one line per finding in the margin column as text: the severity label in a 12-column gutter, the claim beside it, and the path, line and finding id in dim on the next line. Prior findings follow as `Prior` lines with id, status and note. Then a facts line (finding count, then round and turns when known, middle dots between) and a dim line naming the full review. Details, lenses and the rounds table print only with `--full`.

A command that posts prints one line, verdict first: the verdict word, the finding count, the must-fix count only when it is not zero (in red), the turns and the duration (`6 turns · 4m 12s`), then the review's URL on its own line. While a review runs on a TTY, one line on stderr, `Reviewing owner/repo#N · 4 turns · 2m 05s`, is rewritten in place each turn and each second, then erased before the result; piped or without a TTY nothing is written until the result. No spinner, no bar.

The daemon writes a log, read later as often as live: one line per state change, the local time first (`10:06:43`, dim), then a state word in a ten-column gutter (polling, contract, claimed, reviewing, posted, skipped, failed, waiting, delivered, idle, stopping), then the subject. Color follows the stream the line is written to: a daemon log redirected to a file carries no escapes. `failed` is the one red word, `waiting` the one amber word, the verdict on a posted line is bold; nothing else is colored. Paths under the home directory print with `~`. Per-turn and other detail lines belong in the run's `log.txt`, not on the terminal.

Everything else the CLI says is a sentence. `prepare` prints the round on one line, then `prompt`, `checkout` and `result` as labeled paths in a gutter, then the next command to run. `runner login` prints `Code XXXX-XXXX` with the code as the one bold thing, the approval link, that it is waiting and for how long, then `Connected as <name>. Token saved to <path>.` and the command to run next. A printed command is always `npx hawkeye-review …`, the way the README runs it. Errors carry no `error:` prefix, the exit code says that: what went wrong, that nothing was lost when that is true, and the next step, each its own sentence. A failed review starts with `Review failed.` in red and ends with where the run is kept. Paths under the home directory print with `~`.

### Loading, empty and failed

Empty and failed are sentences (`.hk-state`), never illustrations or icon tiles. An address with no page is the same: "There is no page at this address." and one sentence with the way onward, inside the site's header and footer for a visitor, under the top bar for a signed-in user; no large numeral, no apology. A page that throws is the same shape: "This page could not be shown.", one sentence that it failed on our side and nothing was lost, then a Try again button with one link onward beside it (`hk-actions`). The error's message never reaches the page. Loading is the skeleton or the shimmering word. A page that fetches shows the progress line under the top bar with a sentence in the content area, never a blank page. What the database already knows paints first; a section that waits on GitHub streams in behind a skeleton of its own rows, so a slow GitHub call never holds the whole page.

Dashboard pages stay fresh on their own: every 30 seconds while the tab is visible, and the moment it regains focus, the page refetches and rows change in place. The top bar's right side carries `Updated 12 seconds ago` at metadata size in tertiary text (`.hk-fresh`, tabular figures, hidden under 760px), nothing more; while a fetch runs the progress line shows under the bar. Nothing else moves. A page never asks the user to reload.

## Public CSS API

Tokens are `--hk-*`, classes are `hk-*`, both from `stylesheet.css` beside this file. The `hidden` attribute always hides under `.hk-root`, whatever display a class sets. Use the exact names; never invent a `hk-*` class or redeclare a `--hk-*` token in page CSS. Page-owned CSS may compose layout from public tokens only.

Roots and shell: `hk-root`, `hk-topbar[data-sticky]`, `hk-footer`, `hk-wordmark`, `hk-nav`, `hk-topbar-end`, `hk-account-name`, `hk-account-initial`, `hk-fresh`, `hk-menu` (a `<details>`; `data-icon` for an icon-only summary), `hk-menu-panel`, `hk-menu-who`, `hk-menu-theme`, `hk-menu-row`, `hk-menu-legal`, `hk-progress`, `hk-page`.

Type roles: `hk-headline` (landing only), `hk-display`, `hk-title`, `hk-heading`, `hk-lede`, `hk-body`, `hk-compact`, `hk-metadata`, `hk-label`, `hk-mono`, `hk-numeric`, `hk-muted`, `hk-prose`, `hk-visually-hidden`.

Page header: `hk-crumb`, `hk-crumb-sep`, `hk-header`, `hk-title-row`, `hk-actions`, `hk-meta`.

Verdict: `hk-verdict[data-verdict]`, `hk-verdict-word`, `hk-verdict-why`.

Margin column: `hk-margin`, `hk-entry[data-severity]`, `hk-gutter`, `hk-severity[data-severity]`, `hk-lens`, `hk-entry-body`, `hk-claim`, `hk-path` (wrap the text in `<bdi>`), `hk-detail`, `hk-group-heading`.

Controls: `hk-button[data-variant="primary"]`, `hk-review` with `hk-review-control[data-on][data-pending]`, `hk-review-word`, `hk-review-next`, `hk-input`, `hk-textarea`, `hk-choice` (`data-stack` for a column), `hk-field`, `hk-field-wide`, `hk-form-row`, `hk-action-row`, `hk-help`, `hk-link` (on an `<a>` inside `hk-root` only: forces the underline back inside any context that removes it, the top bar, navigation, crumbs, tables and the menu; a bare link in running text already underlines).

Code and sections: `hk-code`, `hk-code-row`, `hk-section`, `hk-steps` (an `<ol>` whose items carry `hk-step-body`).

Status words: `hk-status[data-state="attention" | "failed" | "running"]`.

Figures and the year grid: `hk-figures`, `hk-figure`, `hk-figure-label`, `hk-figure-value`, `hk-figure-note`, `hk-heat`, `hk-heat-months`, `hk-heat-grid` (cells are `<i data-level="0..4" title>`), `hk-heat-key` (swatches are `<i data-level>` too).

Tables: `hk-table-header`, `hk-table-wrap`, `hk-table`, `hk-numeric`, `hk-cell-stack`, `tr[data-dim]`.

Surfaces and states: `hk-surface`, `hk-disclosure`, `hk-rule`, `hk-state`, `hk-skeleton[data-rows]`.

Tokens page CSS may read: `--hk-bg`, `--hk-bg-2`, `--hk-bg-3`, `--hk-fg`, `--hk-fg-2`, `--hk-fg-3`, `--hk-line`, `--hk-line-2`, `--hk-must`, `--hk-must-bg`, `--hk-warn`, `--hk-warn-bg`, `--hk-focus`, `--hk-on-fg`, `--hk-space-1` to `--hk-space-8`, `--hk-radius-control`, `--hk-radius-surface`, the `--hk-type-*`, `--hk-leading-*` and `--hk-weight-*` families, `--hk-measure`, `--hk-page-width`, `--hk-topbar-height`, `--hk-gutter-width`, `--hk-icon-size`, `--hk-icon-stroke`, `--hk-duration`, `--hk-ease`.

## Never

- Capitals for emphasis, tracked eyebrows, decorative section numbers.
- Green for success, blue for information, traffic-light status.
- Badges, pills or chips for ordinary metadata. Severity is a label in the gutter.
- Gradients, glows, blurs, glass, textures, grid backgrounds, colored side rails, shadows.
- Cards around everything; cards inside cards; a border to fix weak hierarchy.
- Spinners, pulsing dots, scroll reveals, skeletons anywhere but a first list load.
- Icons without labels, icon tiles, mixed icon sets, colored icons.
- Praise, greetings, emoji, exclamation marks, hedged findings.
- A font size, weight, radius or spacing value outside the token set.
- A sidebar. The shell is one top bar.
- Sizes or colors that exist in one theme only.

## Before handing off

Render the change in both themes and at 760px. Check, in order: does the first read give the verdict or the state without scrolling; is every gap owned by a parent; do peers share type roles and alignment; is every color one of the allowed uses; can any border, surface, label or icon be removed without losing meaning; does reduced motion leave anything moving. Fix the largest defect and look again. Deliver the change, not the checklist.
