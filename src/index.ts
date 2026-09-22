import { pathToFileURL } from "node:url";

import { loadTargetsConfig } from "./config/loader.js";
import type { MonitoraConfig, Target } from "./config/schema.js";
import { sendAlertToDiscord } from "./discord/notifier.js";
import { evaluateAlert } from "./monitoring/alert-policy.js";
import { checkTarget } from "./monitoring/dispatch.js";
import { Scheduler } from "./monitoring/scheduler.js";
import { StateStore } from "./monitoring/state-store.js";
import type { AlertEvent, CheckResult } from "./types/index.js";

export function resolveMonitorName(env: NodeJS.ProcessEnv): string {
  return env.MONITOR_NAME || "Monitora";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadConfigOrExit(): MonitoraConfig {
  try {
    return loadTargetsConfig();
  } catch (error) {
    console.error(`failed to load configuration: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

function handleCheckError(target: Target, error: unknown): void {
  console.error(`check failed for target "${target.id}": ${getErrorMessage(error)}`);
}

async function deliverAlert(stateStore: StateStore, target: Target, event: AlertEvent): Promise<void> {
  stateStore.recordAlertSent(target.id, event.occurredAt);

  try {
    const result = await sendAlertToDiscord(target, event);
    if (!result.success) {
      console.error(`failed to deliver alert for target "${target.id}": ${result.error}`);
    }
  } catch (error) {
    console.error(`unexpected error delivering alert for target "${target.id}": ${getErrorMessage(error)}`);
  }
}

function handleCheckResult(stateStore: StateStore, target: Target, result: CheckResult): void {
  const transition = stateStore.recordCheckResult(target, result);
  const state = stateStore.getState(target.id);
  if (!state) {
    return;
  }

  const alertEvent = evaluateAlert(target, state, transition, new Date());
  if (!alertEvent) {
    return;
  }

  void deliverAlert(stateStore, target, alertEvent);
}

function keepProcessAlive(): NodeJS.Timeout {
  return setInterval(() => {}, 2_147_483_647);
}

async function shutdown(scheduler: Scheduler, keepAliveHandle: NodeJS.Timeout, signal: NodeJS.Signals): Promise<void> {
  console.log(`received ${signal}, shutting down`);
  clearInterval(keepAliveHandle);
  await scheduler.stop();
  process.exit(0);
}

function startMonitoring(config: MonitoraConfig): void {
  const enabledCount = config.targets.filter((target) => target.enabled).length;
  console.log(`loaded ${config.targets.length} target(s), ${enabledCount} enabled`);

  const stateStore = new StateStore();

  const scheduler = new Scheduler(config.targets, checkTarget, {
    onResult: (target, result) => handleCheckResult(stateStore, target, result),
    onCheckError: handleCheckError,
  });

  scheduler.start();

  const keepAliveHandle = keepProcessAlive();

  process.on("SIGTERM", () => void shutdown(scheduler, keepAliveHandle, "SIGTERM"));
  process.on("SIGINT", () => void shutdown(scheduler, keepAliveHandle, "SIGINT"));
}

function main(): void {
  const environment = process.env.NODE_ENV ?? "development";
  const monitorName = resolveMonitorName(process.env);

  console.log(`${monitorName} starting in ${environment} mode`);

  const config = loadConfigOrExit();
  startMonitoring(config);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main();
}
