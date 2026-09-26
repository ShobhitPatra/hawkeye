"use client";

import type { ReactNode } from "react";
import {
  CONCURRENCY_RANGE,
  HARNESSES,
  MAX_TURNS_RANGE,
  modelFor,
  MODELS,
  retiredModel,
  type RunnerSettings,
  WALL_CLOCK_MINUTES_RANGE,
} from "@/review-settings";
import type { SettingsField } from "@/user-settings";
import { useFormAction } from "../use-form-action";
import { saveRunnerSettingsAction } from "./actions";
import { FieldRefusal } from "./field-refusal";
import { SaveRow } from "./save-row";

function Choice({
  value,
  checked,
  invalid,
  children,
}: {
  value: string;
  checked: boolean;
  invalid: boolean;
  children: ReactNode;
}) {
  return (
    <label>
      <input
        type="radio"
        name="choice"
        value={value}
        defaultChecked={checked}
        aria-invalid={invalid}
      />
      <span>{children}</span>
    </label>
  );
}

export function RunnerForm({ settings }: { settings: RunnerSettings }) {
  const form = useFormAction(saveRunnerSettingsAction, {});
  const refused = (field: SettingsField) =>
    form.state.field === field && !form.dirty ? form.state.error : undefined;
  const kept = modelFor(settings.harness, settings.model);
  const retired = kept === undefined ? undefined : retiredModel(settings.harness, kept);
  const chosen = (harness: string, model: string | undefined) =>
    settings.harness === harness && kept === model;
  const invalid = refused("model") !== undefined;
  return (
    <form onSubmit={form.onSubmit} onInput={form.onInput} className="hk-section" noValidate>
      <fieldset
        className="hk-choice"
        data-stack
        aria-describedby={refused("model") && "model-refusal"}
      >
        <legend>Model</legend>
        <div className="hk-choice">
          {HARNESSES.map((harness) => (
            <fieldset key={harness.value} className="hk-choice" data-stack>
              <legend>{harness.label}</legend>
              {MODELS.filter((model) => model.harness === harness.value).map((model) => (
                <Choice
                  key={model.value}
                  value={`${harness.value}:${model.value}`}
                  checked={chosen(harness.value, model.value)}
                  invalid={invalid}
                >
                  {model.label} <span className="hk-muted">· {model.hint}</span>
                </Choice>
              ))}
              <Choice
                value={`${harness.value}:`}
                checked={chosen(harness.value, undefined)}
                invalid={invalid}
              >
                {harness.label}&apos;s default
              </Choice>
              {retired?.harness === harness.value && (
                <Choice value={`${harness.value}:${retired.value}`} checked invalid={invalid}>
                  {retired.label} <span className="hk-muted">· no longer offered</span>
                </Choice>
              )}
            </fieldset>
          ))}
        </div>
      </fieldset>
      <FieldRefusal id="model-refusal" message={refused("model")} />
      <p className="hk-help hk-prose">
        The runner reviews with that CLI, signed in on your machine; a runner without it fails the
        review and says so. A runner started with --model keeps its own model for Claude Code.
      </p>
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
