import type { Target } from "../config/schema.js";
import type { AlertEvent, CheckResult, HostCheckMetadata, LogCheckMetadata, MonitorState, StateTransition } from "../types/index.js";

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

function buildLogMatchEvent(target: Target, metadata: LogCheckMetadata, now: Date): AlertEvent {
  const patternSuffix = metadata.matchedPattern ? ` (pattern "${metadata.matchedPattern}")` : "";
  const lineSuffix = metadata.matchedLine ? `: ${metadata.matchedLine}` : "";

  return {
    type: "LOG_MATCH",
    targetId: target.id,
    targetName: target.name,
    occurredAt: now,
    message: `${target.name} matched ${metadata.matchCount} new log line(s)${patternSuffix}${lineSuffix}`,
    metadata,
  };
}

function evaluateLogAlert(target: Target, state: MonitorState, result: CheckResult<LogCheckMetadata>, now: Date): AlertEvent | undefined {
  if (result.success) {
    return undefined;
  }

  if (!isCooldownElapsed(state.lastAlertAt, target.cooldownSeconds, now)) {
    return undefined;
  }

  return buildLogMatchEvent(target, result.metadata, now);
}

function buildHostThresholdEvent(target: Target, metadata: HostCheckMetadata, now: Date): AlertEvent {
  const parts: string[] = [];
  if (metadata.cpuPercent !== undefined) {
    parts.push(`CPU: ${metadata.cpuPercent.toFixed(1)}%`);
  }
  if (metadata.memoryPercent !== undefined) {
    parts.push(`Memory: ${metadata.memoryPercent.toFixed(1)}%`);
  }
  if (metadata.diskPercent !== undefined) {
    parts.push(`Disk: ${metadata.diskPercent.toFixed(1)}%`);
  }

  return {
    type: "HOST_THRESHOLD",
    targetId: target.id,
    targetName: target.name,
    occurredAt: now,
    message: `${target.name} host threshold exceeded (${parts.join(", ")})`,
    metadata,
  };
}

function evaluateHostAlert(
  target: Target,
  state: MonitorState,
  transition: StateTransition | undefined,
  result: CheckResult<HostCheckMetadata>,
  now: Date
): AlertEvent | undefined {
  if (transition?.newStatus === "DOWN") {
    return buildHostThresholdEvent(target, result.metadata, now);
  }

  if (transition?.previousStatus === "DOWN" && transition.newStatus === "UP") {
    return buildRecoveredEvent(target, transition, now);
  }

  if (!transition && state.status === "DOWN" && isCooldownElapsed(state.lastAlertAt, target.cooldownSeconds, now)) {
    return buildHostThresholdEvent(target, result.metadata, now);
  }

  return undefined;
}

export function evaluateAlert(
  target: Target,
  state: MonitorState,
  transition: StateTransition | undefined,
  result: CheckResult,
  now: Date
): AlertEvent | undefined {
  if (target.type === "log") {
    return evaluateLogAlert(target, state, result as CheckResult<LogCheckMetadata>, now);
  }

  if (target.type === "host") {
    return evaluateHostAlert(target, state, transition, result as CheckResult<HostCheckMetadata>, now);
  }

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
