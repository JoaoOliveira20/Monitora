import type { Target } from "../config/schema.js";
import type { CheckResult, MonitorState, StateTransition, TargetStatus } from "../types/index.js";

function createInitialState(targetId: string): MonitorState {
  return {
    targetId,
    status: "UNKNOWN",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };
}

function resolveNextStatus(
  previousStatus: TargetStatus,
  consecutiveFailures: number,
  consecutiveSuccesses: number,
  target: Target
): TargetStatus {
  if (previousStatus === "DOWN") {
    return consecutiveSuccesses >= target.recoveryThreshold ? "UP" : "DOWN";
  }

  if (consecutiveFailures >= target.failureThreshold) {
    return "DOWN";
  }

  if (consecutiveSuccesses >= 1) {
    return "UP";
  }

  return previousStatus;
}

export class StateStore {
  private readonly states = new Map<string, MonitorState>();

  getState(targetId: string): MonitorState | undefined {
    return this.states.get(targetId);
  }

  getAllStates(): MonitorState[] {
    return [...this.states.values()];
  }

  recordCheckResult(target: Target, result: CheckResult): StateTransition | undefined {
    const previous = this.states.get(target.id) ?? createInitialState(target.id);
    const previousStatus = previous.status;

    const consecutiveSuccesses = result.success ? previous.consecutiveSuccesses + 1 : 0;
    const consecutiveFailures = result.success ? 0 : previous.consecutiveFailures + 1;

    const nextStatus = resolveNextStatus(previousStatus, consecutiveFailures, consecutiveSuccesses, target);

    const ongoingFirstFailureAt = previous.firstFailureAt ?? (result.success ? undefined : result.checkedAt);

    const next: MonitorState = {
      targetId: target.id,
      status: nextStatus,
      consecutiveFailures,
      consecutiveSuccesses,
      firstFailureAt: nextStatus === "UP" ? undefined : ongoingFirstFailureAt,
      lastCheckedAt: result.checkedAt,
      lastSuccessAt: result.success ? result.checkedAt : previous.lastSuccessAt,
      lastFailureAt: result.success ? previous.lastFailureAt : result.checkedAt,
      lastLatencyMs: result.durationMs,
      lastError: result.success ? undefined : result.error,
      lastAlertAt: previous.lastAlertAt,
    };

    this.states.set(target.id, next);

    if (nextStatus === previousStatus) {
      return undefined;
    }

    const transition: StateTransition = {
      targetId: target.id,
      previousStatus,
      newStatus: nextStatus,
      occurredAt: result.checkedAt,
    };

    if (previousStatus === "DOWN" && nextStatus === "UP" && previous.firstFailureAt) {
      transition.downtimeMs = result.checkedAt.getTime() - previous.firstFailureAt.getTime();
    }

    return transition;
  }
}
