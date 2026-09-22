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

export type AlertEventType = "DOWN" | "RECOVERED";

export interface DownAlertMetadata {
  consecutiveFailures: number;
  lastError?: string;
}

export interface RecoveredAlertMetadata {
  downtimeMs?: number;
}

interface AlertEventCommon {
  targetId: string;
  targetName: string;
  occurredAt: Date;
  message: string;
}

export interface DownAlertEvent extends AlertEventCommon {
  type: "DOWN";
  metadata: DownAlertMetadata;
}

export interface RecoveredAlertEvent extends AlertEventCommon {
  type: "RECOVERED";
  metadata: RecoveredAlertMetadata;
}

export type AlertEvent = DownAlertEvent | RecoveredAlertEvent;
