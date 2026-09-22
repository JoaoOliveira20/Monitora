import { setTimeout as delay } from "node:timers/promises";

import type { Target } from "../config/schema.js";
import type { CheckResult } from "../types/index.js";

export type TargetChecker = (target: Target) => Promise<CheckResult>;

export interface SchedulerCallbacks {
  onResult?: (target: Target, result: CheckResult) => void;
  onCheckError?: (target: Target, error: unknown) => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class Scheduler {
  private running = false;
  private abortController = new AbortController();
  private activeLoops: Promise<void>[] = [];

  constructor(
    private readonly targets: Target[],
    private readonly checkTarget: TargetChecker,
    private readonly callbacks: SchedulerCallbacks = {}
  ) {}

  start(): void {
    if (this.running) {
      throw new Error("scheduler is already running");
    }

    this.running = true;
    this.abortController = new AbortController();
    this.activeLoops = this.targets.filter((target) => target.enabled).map((target) => this.runTargetLoop(target));
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    await Promise.allSettled(this.activeLoops);
    this.activeLoops = [];
  }

  private async runTargetLoop(target: Target): Promise<void> {
    while (this.running) {
      await this.runSingleCheck(target);

      if (!this.running) {
        return;
      }

      await this.waitForNextRun(target.intervalSeconds);
    }
  }

  private async runSingleCheck(target: Target): Promise<void> {
    try {
      const result = await this.checkTarget(target);
      this.callbacks.onResult?.(target, result);
    } catch (error) {
      this.callbacks.onCheckError?.(target, error);
    }
  }

  private async waitForNextRun(intervalSeconds: number): Promise<void> {
    try {
      await delay(intervalSeconds * 1000, undefined, { signal: this.abortController.signal });
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
    }
  }
}
