import type { Target } from "../config/schema.js";
import type { CheckResult } from "../types/index.js";
import { checkHttpTarget } from "./http-monitor.js";

export async function checkTarget(target: Target): Promise<CheckResult> {
  switch (target.type) {
    case "http":
      return checkHttpTarget(target);
    case "log":
      throw new Error(`log monitor is not implemented yet (target "${target.id}")`);
    case "host":
      throw new Error(`host monitor is not implemented yet (target "${target.id}")`);
  }
}
