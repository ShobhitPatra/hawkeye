"use client";

import { useState } from "react";
import {
  CONCURRENCY_RANGE,
  HARNESSES,
  isModelChoice,
  MAX_TURNS_RANGE,
  MODELS,
  type RunnerSettings,
  WALL_CLOCK_MINUTES_RANGE,
} from "@/review-settings";
import type { SettingsField } from "@/user-settings";
import { useFormAction } from "../use-form-action";
import { saveRunnerSettingsAction } from "./actions";
import { FieldRefusal } from "./field-refusal";
import { SaveRow } from "./save-row";

export function RunnerForm({ settings }: { settings: RunnerSettings }) {
  const form = useFormAction(saveRunnerSettingsAction, {});
  const refused = (field: SettingsField) =>
    form.state.field === field && !form.dirty ? form.state.error : undefined;
  const retired = settings.model !== null && !isModelChoice(settings.model);
  const [harness, setHarness] = useState(settings.harness);
  return (
    <form onSubmit={form.onSubmit} onInput={form.onInput} className="hk-section" noValidate>
      <fieldset
        className="hk-choice"
        data-stack
        aria-describedby={refused("harness") && "harness-refusal"}
      >
        <legend className="hk-compact">Harness</legend>
        {HARNESSES.map((choice) => (
          <label key={choice.value}>
            <input
              type="radio"
              name="harness"
              value={choice.value}
              defaultChecked={settings.harness === choice.value}
              aria-invalid={refused("harness") !== undefined}
              onChange={() => setHarness(choice.value)}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <FieldRefusal id="harness-refusal" message={refused("harness")} />
      <p className="hk-help">
        The CLI the runner reviews with, signed in on your machine. A runner without that CLI fails
        the review and says so.
      </p>
      {harness !== "claude-code" && (
        <>
          <input type="hidden" name="model" value={settings.model ?? ""} />
          <p className="hk-help">
            Codex picks its own model; the saved Claude Code model is kept for when you switch back.
          </p>
        </>
      )}
      <fieldset
        className="hk-choice"
        data-stack
        hidden={harness !== "claude-code"}
        disabled={harness !== "claude-code"}
        aria-describedby={refused("model") && "model-refusal"}
      >
        <legend className="hk-compact">Model</legend>
        {MODELS.map((model) => (
          <label key={model.value}>
            <input
              type="radio"
              name="model"
              value={model.value}
              defaultChecked={settings.model === model.value}
              aria-invalid={refused("model") !== undefined}
            />
            {model.label}
          </label>
        ))}
        <label>
          <input
            type="radio"
            name="model"
            value=""
            defaultChecked={settings.model === null}
            aria-invalid={refused("model") !== undefined}
          />
          The CLI's default
        </label>
      </fieldset>
      <FieldRefusal id="model-refusal" message={refused("model")} />
      {retired && harness === "claude-code" && (
        <p className="hk-help">
          Your saved model, {settings.model}, is no longer in the list. Reviews still ask for it;
          saving switches to the choice above, or to the CLI's default if none is picked.
        </p>
      )}
      {harness === "claude-code" && (
        <p className="hk-help">
          Passed to the claude CLI as --model on every review from the next claim. A runner started
          with --model keeps that model instead.
        </p>
      )}
      <div className="hk-field">
        <label htmlFor="max-turns">Turns per review</label>
        <div className="hk-form-row">
          <input
            className="hk-input"
            id="max-turns"
            name="maxTurns"
            type="number"
            inputMode="numeric"
            required
            min={MAX_TURNS_RANGE.min}
            max={MAX_TURNS_RANGE.max}
            step={1}
            defaultValue={settings.maxTurns}
            aria-invalid={refused("maxTurns") !== undefined}
            aria-describedby={refused("maxTurns") && "max-turns-refusal"}
          />
          <span className="hk-compact hk-muted">turns</span>
        </div>
        <FieldRefusal id="max-turns-refusal" message={refused("maxTurns")} />
        <p className="hk-help">
          A review that reaches this many turns stops and reports max turns.
        </p>
      </div>
      <div className="hk-field">
        <label htmlFor="wall-clock">Minutes per review</label>
        <div className="hk-form-row">
          <input
            className="hk-input"
            id="wall-clock"
            name="wallClockMinutes"
            type="number"
            inputMode="numeric"
            required
            min={WALL_CLOCK_MINUTES_RANGE.min}
            max={WALL_CLOCK_MINUTES_RANGE.max}
            step={1}
            defaultValue={settings.wallClockMinutes}
            aria-invalid={refused("wallClockMinutes") !== undefined}
            aria-describedby={refused("wallClockMinutes") && "wall-clock-refusal"}
          />
          <span className="hk-compact hk-muted">minutes</span>
        </div>
        <FieldRefusal id="wall-clock-refusal" message={refused("wallClockMinutes")} />
        <p className="hk-help">A review that runs longer stops and reports a timeout.</p>
      </div>
      <div className="hk-field">
        <label htmlFor="concurrency">Reviews at once</label>
        <div className="hk-form-row">
          <input
            className="hk-input"
            id="concurrency"
            name="concurrency"
            type="number"
            inputMode="numeric"
            required
            min={CONCURRENCY_RANGE.min}
            max={CONCURRENCY_RANGE.max}
            step={1}
            defaultValue={settings.concurrency}
            aria-invalid={refused("concurrency") !== undefined}
            aria-describedby={refused("concurrency") && "concurrency-refusal"}
          />
          <span className="hk-compact hk-muted">reviews</span>
        </div>
        <FieldRefusal id="concurrency-refusal" message={refused("concurrency")} />
        <p className="hk-help">
          How many reviews the runner runs at the same time, up to three. Each one spends your plan,
          so more at once reaches its limits sooner.
        </p>
      </div>
      <SaveRow form={form} saved="Saved. Applies from the next claim." />
    </form>
  );
}
