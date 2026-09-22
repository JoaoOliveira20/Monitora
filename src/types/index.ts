export interface CheckResult<Metadata = unknown> {
  targetId: string;
  success: boolean;
  checkedAt: Date;
  durationMs: number;
  error?: string;
  metadata: Metadata;
}

export type TargetStatus = "UNKNOWN" | "UP" | "DOWN";

export interface MonitorState {
  targetId: string;
  status: TargetStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  firstFailureAt?: Date;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastLatencyMs?: number;
  lastError?: string;
  lastAlertAt?: Date;
}

export interface StateTransition {
  targetId: string;
  previousStatus: TargetStatus;
  newStatus: TargetStatus;
  occurredAt: Date;
  downtimeMs?: number;
}
