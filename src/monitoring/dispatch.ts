import type { Target } from "../config/schema.js";
import { LogMonitor } from "../logs/log-monitor.js";
import { HostMonitor } from "../system/host-metrics.js";
import type { CheckResult } from "../types/index.js";
import { checkHttpTarget } from "./http-monitor.js";

export type TargetChecker = (target: Target) => Promise<CheckResult>;

export function createDispatcher(): TargetChecker {
  const logMonitor = new LogMonitor();
  const hostMonitor = new HostMonitor();

  return async function checkTarget(target: Target): Promise<CheckResult> {
    switch (target.type) {
      case "http":
        return checkHttpTarget(target);
      case "log":
        return logMonitor.checkTarget(target);
      case "host":
        return hostMonitor.checkTarget(target);
    }
  };
}
