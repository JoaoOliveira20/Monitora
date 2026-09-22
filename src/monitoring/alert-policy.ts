import type { Target } from "../config/schema.js";
import type { AlertEvent, MonitorState, StateTransition } from "../types/index.js";

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

function isCooldownElapsed(lastAlertAt: Date | undefined, cooldownSeconds: number, now: Date): boolean {
  if (!lastAlertAt) {
    return true;
  }
  return now.getTime() - lastAlertAt.getTime() >= cooldownSeconds * 1000;
}

function buildDownEvent(target: Target, state: MonitorState, now: Date): AlertEvent {
  const errorSuffix = state.lastError ? `: ${state.lastError}` : "";

  return {
    type: "DOWN",
    targetId: target.id,
    targetName: target.name,
    occurredAt: now,
    message: `${target.name} is DOWN after ${state.consecutiveFailures} consecutive failures${errorSuffix}`,
    metadata: {
      consecutiveFailures: state.consecutiveFailures,
      lastError: state.lastError,
    },
  };
}

function buildRecoveredEvent(target: Target, transition: StateTransition, now: Date): AlertEvent {
  const downtimeSuffix = transition.downtimeMs !== undefined ? ` after ${formatDuration(transition.downtimeMs)}` : "";

  return {
    type: "RECOVERED",
    targetId: target.id,
    targetName: target.name,
    occurredAt: now,
    message: `${target.name} recovered${downtimeSuffix}`,
    metadata: {
      downtimeMs: transition.downtimeMs,
    },
  };
}

export function evaluateAlert(
  target: Target,
  state: MonitorState,
  transition: StateTransition | undefined,
  now: Date
): AlertEvent | undefined {
  if (transition?.newStatus === "DOWN") {
    return buildDownEvent(target, state, now);
  }

  if (transition?.previousStatus === "DOWN" && transition.newStatus === "UP") {
    return buildRecoveredEvent(target, transition, now);
  }

  if (!transition && state.status === "DOWN" && isCooldownElapsed(state.lastAlertAt, target.cooldownSeconds, now)) {
    return buildDownEvent(target, state, now);
  }

  return undefined;
}
