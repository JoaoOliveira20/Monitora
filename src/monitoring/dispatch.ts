import type { Target } from "../config/schema.js";
import type { CheckResult } from "../types/index.js";
import { checkHttpTarget } from "./http-monitor.js";
import { LogMonitor } from "./log-monitor.js";

export type TargetChecker = (target: Target) => Promise<CheckResult>;

export function createDispatcher(): TargetChecker {
  const logMonitor = new LogMonitor();

  return async function checkTarget(target: Target): Promise<CheckResult> {
    switch (target.type) {
      case "http":
        return checkHttpTarget(target);
      case "log":
        return logMonitor.checkTarget(target);
      case "host":
        throw new Error(`host monitor is not implemented yet (target "${target.id}")`);
    }
  };
}
