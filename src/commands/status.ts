import type { Target } from "../config/schema.js";
import { formatDuration } from "../monitoring/alert-policy.js";
import type { StateStore } from "../monitoring/state-store.js";
import type { HostCheckMetadata, MonitorState, TargetStatus } from "../types/index.js";

function statusEmoji(status: TargetStatus | undefined): string {
  if (status === "UP") {
    return "🟢";
  }
  if (status === "DOWN") {
    return "🔴";
  }
  return "⚪";
}

function formatCheckLine(state: MonitorState | undefined, now: Date): string {
  if (!state || state.status === "UNKNOWN") {
    return "UNKNOWN · waiting for first check";
  }

  if (state.status === "UP") {
    return state.lastLatencyMs !== undefined ? `UP · ${state.lastLatencyMs}ms` : "UP";
  }

  if (state.firstFailureAt) {
    const downtimeMs = now.getTime() - state.firstFailureAt.getTime();
    return `DOWN · ${formatDuration(downtimeMs)}`;
  }

  return "DOWN";
}

function formatHostLine(state: MonitorState | undefined): string {
  if (!state || state.status === "UNKNOWN") {
    return "UNKNOWN · waiting for first check";
  }

  const metadata = state.lastMetadata as HostCheckMetadata | undefined;
  const parts: string[] = [];

  if (metadata?.cpuPercent !== undefined) {
    parts.push(`CPU ${metadata.cpuPercent.toFixed(0)}%`);
  }
  if (metadata?.memoryPercent !== undefined) {
    parts.push(`RAM ${metadata.memoryPercent.toFixed(0)}%`);
  }
  if (metadata?.diskPercent !== undefined) {
    parts.push(`Disk ${metadata.diskPercent.toFixed(0)}%`);
  }

  return parts.length > 0 ? parts.join(" · ") : "no metrics available yet";
}

export function buildStatusResponse(
  monitorName: string,
  targets: Target[],
  stateStore: StateStore,
  now: Date = new Date()
): string {
  const enabledTargets = targets.filter((target) => target.enabled);

  if (enabledTargets.length === 0) {
    return `${monitorName}\n\nNo targets configured.`;
  }

  const lines = enabledTargets.map((target) => {
    const state = stateStore.getState(target.id);
    const emoji = statusEmoji(state?.status);
    const detail = target.type === "host" ? formatHostLine(state) : formatCheckLine(state, now);
    return `${emoji} ${target.name}\n${detail}`;
  });

  return `${monitorName}\n\n${lines.join("\n\n")}`;
}
