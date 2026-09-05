import { cache } from "react";
import { getDb } from "./db";
import { runnerStatus } from "./runner-status";

export const requestRunnerStatus = cache((userId: string) => runnerStatus(getDb(), userId));
