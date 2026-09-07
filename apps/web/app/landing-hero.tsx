"use client";

import { Fragment, useEffect, useRef } from "react";
import { chunkEnds, HERO_ACTS, STREAM_TICK_MS } from "@/hero-replay";
import { LANDING_REVIEW } from "@/landing-review";
import { Mark } from "./mark";

const ACTS = ["Open a pull request", "The review runs on your machine", "The review is posted"];
const review = LANDING_REVIEW;

function ReplayIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function ReviewingBadge() {
  const text = `Reviewing on ${review.runner}`;
  return (
    <svg
      width="180"
      height="20"
      viewBox="0 0 180 20"
      role="img"
      aria-label={text}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="ld-shimmer"
          x1="0"
          y1="0"
          x2="1"
          y2="0"
          gradientUnits="objectBoundingBox"
        >
          <stop offset="0" stopColor="#8b877f" />
          <stop offset="0.4" stopColor="#8b877f" />
          <stop offset="0.5" stopColor="#c9c4bb" />
          <stop offset="0.6" stopColor="#8b877f" />
          <stop offset="1" stopColor="#8b877f" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            from="-1 0"
            to="1 0"
            dur="1.8s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      <text
        x="0"
        y="14"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize="12"
        fill="url(#ld-shimmer)"
      >
        {text}
      </text>
    </svg>
  );
}

function TerminalLine({ line }: { line: (typeof review.terminal)[number] }) {
  const { posted } = review;
  return (
    <div className="ld-term-line">
      <span className="ld-term-time">{line.at}</span>
      {"  "}
      {line.state.padEnd(10)}{" "}
      {line.state === "posted" ? (
        <>
          <span className="ld-term-verdict">{posted.verdict}</span>
          {` · ${posted.findings} findings · `}
          <span className="ld-term-must">{posted.mustFix} must fix</span>
          {` · ${posted.turns} turns · ${posted.duration}`}
        </>
      ) : (
        line.detail
      )}
    </div>
  );
}

export function LandingHero() {
  const root = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const hero = root.current;
    if (!hero) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flow = Array.from(hero.querySelectorAll<HTMLElement>("[data-flow] span"));
    const acts = Array.from(hero.querySelectorAll<HTMLElement>("[data-act]"));
    const wait = hero.querySelector<HTMLElement>("[data-wait]")!;
    const md = hero.querySelector<HTMLElement>("[data-md]")!;
    const body = md.parentElement!;
    const blocks = Array.from(md.children) as HTMLElement[];
    const termLines = Array.from(hero.querySelectorAll<HTMLElement>(".ld-term-line"));
    const chip = hero.querySelector<HTMLElement>("[data-chip]")!;
    const textNodes: { node: Text; full: string }[] = [];
    const walk = (node: Node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim())
          textNodes.push({ node: child as Text, full: child.nodeValue });
        else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName !== "DETAILS")
          walk(child);
      });
    };
    walk(md);

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const light = (upTo: number) =>
      flow.forEach((el, index) => {
        if (index <= upTo) el.setAttribute("data-on", "");
        else el.removeAttribute("data-on");
      });
    const show = (name: string) =>
      acts.forEach((act) => {
        if (act.dataset.act === name) act.setAttribute("data-on", "");
        else act.removeAttribute("data-on");
      });
    const restoreText = () => textNodes.forEach(({ node, full }) => (node.nodeValue = full));
    const finish = () => {
      light(2);
      show("posted");
      chip.hidden = false;
      wait.hidden = true;
      md.hidden = false;
      md.removeAttribute("data-streaming");
      termLines.forEach((line) => line.setAttribute("data-in", ""));
      blocks.forEach((block) => block.setAttribute("data-in", ""));
      restoreText();
    };
    const stream = () => {
      let tick = 0;
      blocks.forEach((block) => {
        const own = textNodes.filter(({ node }) => block.contains(node));
        at(tick * STREAM_TICK_MS, () => block.setAttribute("data-in", ""));
        for (const { node, full } of own)
          for (const end of chunkEnds(full.length)) {
            at(tick * STREAM_TICK_MS, () => {
              node.nodeValue = full.slice(0, end);
              body.scrollTop = body.scrollHeight;
            });
            tick += 1;
          }
        if (own.length === 0) tick += 1;
      });
      at(tick * STREAM_TICK_MS + 200, () => {
        md.removeAttribute("data-streaming");
        restoreText();
        body.scrollTop = 0;
      });
      textNodes.forEach(({ node }) => (node.nodeValue = ""));
    };
    const play = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      light(0);
      show("pull-request");
      chip.hidden = true;
      wait.hidden = true;
      md.hidden = true;
      md.setAttribute("data-streaming", "");
      termLines.forEach((line) => line.removeAttribute("data-in"));
      blocks.forEach((block) => block.removeAttribute("data-in"));
      restoreText();
      at(HERO_ACTS.machine, () => {
        light(1);
        chip.hidden = false;
        show("machine");
        review.terminal.forEach((line, index) =>
          at(line.delayMs, () => termLines[index]?.setAttribute("data-in", "")),
        );
      });
      at(HERO_ACTS.reviewing, () => {
        show("posted");
        wait.hidden = false;
      });
      at(HERO_ACTS.posted, () => {
        light(2);
        wait.hidden = true;
        md.hidden = false;
        stream();
      });
    };
    const markEnd = () => {
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 1)
        body.setAttribute("data-end", "");
      else body.removeAttribute("data-end");
    };
    body.addEventListener("scroll", markEnd);
    const replay = hero.querySelector<HTMLButtonElement>("[data-replay]")!;
    replay.addEventListener("click", play);
    if (reduce) finish();
    else play();
    const pending = timers.current;
    return () => {
      replay.removeEventListener("click", play);
      body.removeEventListener("scroll", markEnd);
      pending.forEach(clearTimeout);
    };
  }, []);

  return (
    <section aria-label="A review happening" className="ld-hero" ref={root}>
      <div className="ld-flow" data-flow>
        {ACTS.map((act, index) => (
          <Fragment key={act}>
            {index > 0 && <i />}
            <span data-on={index === 0 ? "" : undefined}>{act}</span>
          </Fragment>
        ))}
      </div>
      <figure className="ld-stage">
        <div className="ld-stage-bar">
          <span>
            github.com · {review.owner}/{review.repo}
          </span>
          <button type="button" className="ld-replay" data-replay>
            <ReplayIcon />
            Replay
          </button>
        </div>
        <div className="ld-stage-body">
          <div className="ld-act" data-act="pull-request" data-on>
            <div className="ld-pr">
              <div className="ld-pr-title">
                {review.title} <span className="hk-mono">#{review.number}</span>
              </div>
              <div className="ld-pr-meta">
                {review.owner} wants to merge 1 commit into <span className="hk-mono">main</span>{" "}
                from <span className="hk-mono">{review.branch}</span>
              </div>
              <span className="ld-chip" data-chip hidden>
                hawkeye · Reviewing on {review.runner}
              </span>
            </div>
          </div>
          <div className="ld-act" data-act="machine">
            <div className="ld-term">
              {review.terminal.map((line) => (
                <TerminalLine key={line.at} line={line} />
              ))}
            </div>
          </div>
          <div className="ld-act" data-act="posted">
            <div className="ld-cm">
              <div className="ld-cm-head">
                <span className="ld-cm-avatar">
                  <Mark size={14} />
                </span>
                <b>hawkeye</b>
                <span className="ld-cm-bot">bot</span>
                <span>reviewed just now</span>
              </div>
              <div className="ld-cm-body">
                <div className="ld-wait" data-wait hidden>
                  <p>
                    <ReviewingBadge />
                  </p>
                  <p>Started {review.startedAt}. This comment is replaced when the review lands.</p>
                </div>
                <div
                  className="ld-md"
                  data-md
                  data-streaming
                  hidden
                  dangerouslySetInnerHTML={{ __html: review.bodyHtml }}
                />
              </div>
            </div>
          </div>
        </div>
      </figure>
      <p className="ld-cap">
        A real review of Hawkeye's own pull request <a href={review.url}>#{review.number}</a>, first
        round, written by Claude Code on the author's laptop. Every line is what the bot posted.
      </p>
    </section>
  );
}
