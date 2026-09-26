"use client";

import { Fragment, useEffect, useRef } from "react";
import {
  chunkEnds,
  HERO_ACTS,
  REPLAY_VISIBLE_RATIO,
  STREAM_CHUNK_CHARS,
  STREAM_LEAD_BLOCKS,
  STREAM_LEAD_CHUNK_CHARS,
  STREAM_LEAD_TICK_MS,
  STREAM_SETTLE_MS,
  STREAM_TICK_MS,
} from "@/hero-replay";
import { LANDING_REVIEW } from "@/landing-review";
import { Mark } from "./mark";

const ACTS = ["Open a pull request", "The review runs on your machine", "The review is posted"];
const CONNECTOR_FILL_MS = [HERO_ACTS.machine, HERO_ACTS.posted - HERO_ACTS.machine];
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
  const width = Math.ceil(text.length * 7.3) + 2;
  return (
    <svg
      width={width}
      height="20"
      viewBox={`0 0 ${width} 20`}
      role="img"
      aria-label={text}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="ld-sweep">
          <rect className="ld-sweep" x="0" y="0" width="48" height="20" />
        </clipPath>
      </defs>
      <text
        x="0"
        y="14"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize="12"
        fill="#8b877f"
      >
        {text}
      </text>
      <text
        x="0"
        y="14"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        fontSize="12"
        fill="#c9c4bb"
        clipPath="url(#ld-sweep)"
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

  useEffect(() => {
    const hero = root.current;
    if (!hero) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flow = Array.from(hero.querySelectorAll<HTMLElement>("[data-flow] span"));
    const connectors = Array.from(hero.querySelectorAll<HTMLElement>("[data-flow] i"));
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

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };
    const clearTimers = () => timers.splice(0).forEach(clearTimeout);
    const light = (upTo: number) => {
      flow.forEach((el, index) => {
        if (index <= upTo) el.setAttribute("data-on", "");
        else el.removeAttribute("data-on");
        if (index === upTo) el.setAttribute("data-current", "");
        else el.removeAttribute("data-current");
      });
      connectors.forEach((el, index) => {
        el.style.setProperty("--ld-fill", index === upTo ? `${CONNECTOR_FILL_MS[index]}ms` : "0ms");
        if (index <= upTo) el.setAttribute("data-fill", "");
        else el.removeAttribute("data-fill");
      });
    };
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
      let elapsed = 0;
      blocks.forEach((block, index) => {
        const lead = index < STREAM_LEAD_BLOCKS;
        const tickMs = lead ? STREAM_LEAD_TICK_MS : STREAM_TICK_MS;
        const chunk = lead ? STREAM_LEAD_CHUNK_CHARS : STREAM_CHUNK_CHARS;
        const own = textNodes.filter(({ node }) => block.contains(node));
        at(elapsed, () => block.setAttribute("data-in", ""));
        for (const { node, full } of own)
          for (const end of chunkEnds(full.length, chunk)) {
            at(elapsed, () => {
              node.nodeValue = full.slice(0, end);
              body.scrollTop = body.scrollHeight;
            });
            elapsed += tickMs;
          }
        if (own.length === 0) elapsed += tickMs;
      });
      at(elapsed, () => {
        md.removeAttribute("data-streaming");
        restoreText();
      });
      at(elapsed + STREAM_SETTLE_MS, () => body.scrollTo({ top: 0, behavior: "smooth" }));
      textNodes.forEach(({ node }) => (node.nodeValue = ""));
    };
    const play = () => {
      clearTimers();
      connectors.forEach((el) => {
        el.removeAttribute("data-fill");
        void el.offsetWidth;
      });
      light(0);
      show("pull-request");
      chip.hidden = true;
      wait.hidden = true;
      md.hidden = true;
      md.setAttribute("data-streaming", "");
      termLines.forEach((line) => line.removeAttribute("data-in"));
      blocks.forEach((block) => block.removeAttribute("data-in"));
      restoreText();
      at(HERO_ACTS.chip, () => {
        chip.hidden = false;
      });
      at(HERO_ACTS.machine, () => {
        light(1);
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
    let observer: IntersectionObserver | undefined;
    const onReplay = () => {
      observer?.disconnect();
      (reduce ? finish : play)();
    };
    replay.addEventListener("click", onReplay);
    if (reduce) finish();
    else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.intersectionRatio >= REPLAY_VISIBLE_RATIO)) return;
          observer?.disconnect();
          play();
        },
        { threshold: REPLAY_VISIBLE_RATIO },
      );
      observer.observe(hero.querySelector(".ld-stage")!);
    }
    return () => {
      observer?.disconnect();
      replay.removeEventListener("click", onReplay);
      body.removeEventListener("scroll", markEnd);
      clearTimers();
    };
  }, []);

  return (
    <section aria-label="A review happening" className="ld-hero" ref={root}>
      <div className="ld-flow" data-flow>
        {ACTS.map((act, index) => (
          <Fragment key={act}>
            {index > 0 && <i />}
            <span
              data-on={index === 0 ? "" : undefined}
              data-current={index === 0 ? "" : undefined}
            >
              {act}
            </span>
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
                <b>hawkeye-review</b>
                <span className="ld-cm-bot">bot</span>
                <span>reviewed just now</span>
              </div>
              <div className="ld-cm-body">
                <div className="ld-wait" data-wait hidden>
                  <p>
                    <ReviewingBadge />
                  </p>
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
