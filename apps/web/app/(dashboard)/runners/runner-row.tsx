"use client";

import { useState } from "react";
import { revokeRunnerAction } from "./actions";

export type RunnerRowData = {
  id: string;
  name: string;
  state: "online" | "offline" | "revoked" | "reviewing";
  reviewing?: string;
  lastSeen: string;
  created: string;
};

export function RunnerRow({ runner }: { runner: RunnerRowData }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <tr>
        <td className="hk-mono">{runner.name}</td>
        <td colSpan={3}>
          Revoke <span className="hk-mono">{runner.name}</span>? Its token stops working now and any
          review it holds goes back to the queue.
        </td>
        <td className="hk-numeric">
          <form action={revokeRunnerAction} className="hk-actions">
            <input type="hidden" name="runnerId" value={runner.id} />
            <button type="button" className="hk-button" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="submit" className="hk-button" data-variant="primary">
              Revoke
            </button>
          </form>
        </td>
      </tr>
    );
  return (
    <tr data-dim={runner.state === "revoked" ? "true" : undefined}>
      <td className="hk-mono">{runner.name}</td>
      <td>
        {runner.state === "reviewing" ? (
          <>
            <span className="hk-status" data-state="running">
              Reviewing
            </span>{" "}
            <span className="hk-metadata">{runner.reviewing}</span>
          </>
        ) : runner.state === "online" ? (
          <span className="hk-status">Online</span>
        ) : runner.state === "offline" ? (
          <span className="hk-status" data-state="attention">
            Offline
          </span>
        ) : (
          <span className="hk-status">Revoked</span>
        )}
      </td>
      <td>{runner.lastSeen}</td>
      <td>{runner.created}</td>
      <td className="hk-numeric">
        {runner.state !== "revoked" && (
          <button type="button" className="hk-button" onClick={() => setConfirming(true)}>
            Revoke
          </button>
        )}
      </td>
    </tr>
  );
}
