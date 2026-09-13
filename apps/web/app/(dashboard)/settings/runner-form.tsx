"use client";

import { useActionState } from "react";
import {
  isModelChoice,
  MAX_TURNS_RANGE,
  MODELS,
  type RunnerSettings,
  WALL_CLOCK_MINUTES_RANGE,
} from "@/review-settings";
import { type SaveState, saveRunnerSettingsAction } from "./actions";

export function RunnerForm({ settings }: { settings: RunnerSettings }) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(
    saveRunnerSettingsAction,
    {},
  );
  const retired = settings.model !== null && !isModelChoice(settings.model);
  return (
    <form action={formAction} className="hk-section">
      <fieldset className="hk-choice" data-stack>
        <legend className="hk-compact">Model</legend>
        {MODELS.map((model) => (
          <label key={model.value}>
            <input
              type="radio"
              name="model"
              value={model.value}
              defaultChecked={settings.model === model.value}
            />
            {model.label}
          </label>
        ))}
        <label>
          <input type="radio" name="model" value="" defaultChecked={settings.model === null} />
          The CLI's default
        </label>
      </fieldset>
      {retired && (
        <p className="hk-help">
          Your saved model, {settings.model}, is no longer in the list. Reviews still ask for it;
          saving switches to the choice above, or to the CLI's default if none is picked.
        </p>
      )}
      <p className="hk-help">
        Passed to the claude CLI as --model on every review from the next claim. A runner started
        with --model keeps that model instead.
      </p>
      <div className="hk-field">
        <label htmlFor="max-turns">Turns per review</label>
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
        />
        <p className="hk-help">
          A review that reaches this many turns stops and reports max turns.
        </p>
      </div>
      <div className="hk-field">
        <label htmlFor="wall-clock">Minutes per review</label>
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
        />
        <p className="hk-help">A review that runs longer stops and reports a timeout.</p>
      </div>
      <div className="hk-action-row">
        <button type="submit" className="hk-button" data-variant="primary" disabled={pending}>
          Save
        </button>
        <span>
          {state.error ?? (state.saved ? "Saved. Applies from the next claim." : undefined)}
        </span>
      </div>
    </form>
  );
}
