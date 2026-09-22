import { performance } from "node:perf_hooks";

import type { HostTarget } from "../config/schema.js";
import type { CheckResult, HostCheckMetadata } from "../types/index.js";
import { describeFetchFailure } from "./network-errors.js";
import { findSample, findSamples, parsePrometheusText, type PrometheusSample } from "./prometheus-parser.js";

export type HostCheckResult = CheckResult<HostCheckMetadata>;

interface CpuSnapshot {
  totalSeconds: number;
  idleSeconds: number;
}

function summarizeCpuSeconds(samples: PrometheusSample[]): CpuSnapshot | undefined {
  const cpuSamples = findSamples(samples, "node_cpu_seconds_total");
  if (cpuSamples.length === 0) {
    return undefined;
  }

  let totalSeconds = 0;
  let idleSeconds = 0;

  for (const sample of cpuSamples) {
    totalSeconds += sample.value;
    if (sample.labels.mode === "idle") {
      idleSeconds += sample.value;
    }
  }

  return { totalSeconds, idleSeconds };
}

function calculateCpuPercent(current: CpuSnapshot, previous: CpuSnapshot): number | undefined {
  const totalDelta = current.totalSeconds - previous.totalSeconds;
  if (totalDelta <= 0) {
    return undefined;
  }

  const idleDelta = current.idleSeconds - previous.idleSeconds;
  const usage = (1 - idleDelta / totalDelta) * 100;

  return Math.max(0, Math.min(100, usage));
}

function calculateMemoryPercent(samples: PrometheusSample[]): number | undefined {
  const total = findSample(samples, "node_memory_MemTotal_bytes")?.value;
  const available = findSample(samples, "node_memory_MemAvailable_bytes")?.value;

  if (total === undefined || available === undefined || total <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(100, ((total - available) / total) * 100));
}

function calculateDiskPercent(samples: PrometheusSample[], mountpoint: string): number | undefined {
  const size = findSample(samples, "node_filesystem_size_bytes", { mountpoint })?.value;
  const avail = findSample(samples, "node_filesystem_avail_bytes", { mountpoint })?.value;

  if (size === undefined || avail === undefined || size <= 0) {
    return undefined;
  }

  return Math.max(0, Math.min(100, ((size - avail) / size) * 100));
}

function exceedsThreshold(value: number | undefined, threshold: number | undefined): boolean {
  return value !== undefined && threshold !== undefined && value > threshold;
}

function describeExceededThresholds(metadata: HostCheckMetadata, target: HostTarget): string {
  const reasons: string[] = [];

  if (exceedsThreshold(metadata.cpuPercent, target.cpuThresholdPercent)) {
    reasons.push(`CPU ${metadata.cpuPercent?.toFixed(1)}% > ${target.cpuThresholdPercent}%`);
  }
  if (exceedsThreshold(metadata.memoryPercent, target.memoryThresholdPercent)) {
    reasons.push(`memory ${metadata.memoryPercent?.toFixed(1)}% > ${target.memoryThresholdPercent}%`);
  }
  if (exceedsThreshold(metadata.diskPercent, target.diskThresholdPercent)) {
    reasons.push(`disk ${metadata.diskPercent?.toFixed(1)}% > ${target.diskThresholdPercent}%`);
  }

  return `host threshold exceeded: ${reasons.join(", ")}`;
}

export class HostMonitor {
  private readonly previousCpuSnapshots = new Map<string, CpuSnapshot>();

  async checkTarget(target: HostTarget): Promise<HostCheckResult> {
    const checkedAt = new Date();
    const startedAt = performance.now();

    const buildResult = (success: boolean, error: string | undefined, metadata: HostCheckMetadata): HostCheckResult => ({
      targetId: target.id,
      success,
      checkedAt,
      durationMs: Math.round(performance.now() - startedAt),
      error,
      metadata,
    });

    const fetchResult = await this.fetchMetrics(target);
    if (fetchResult.failureReason !== undefined) {
      return buildResult(false, fetchResult.failureReason, {});
    }

    const samples = parsePrometheusText(fetchResult.text);
    const metadata = this.buildMetadata(target, samples);

    const exceeded =
      exceedsThreshold(metadata.cpuPercent, target.cpuThresholdPercent) ||
      exceedsThreshold(metadata.memoryPercent, target.memoryThresholdPercent) ||
      exceedsThreshold(metadata.diskPercent, target.diskThresholdPercent);

    if (exceeded) {
      return buildResult(false, describeExceededThresholds(metadata, target), metadata);
    }

    return buildResult(true, undefined, metadata);
  }

  private buildMetadata(target: HostTarget, samples: PrometheusSample[]): HostCheckMetadata {
    const cpuSnapshot = summarizeCpuSeconds(samples);
    const previousSnapshot = this.previousCpuSnapshots.get(target.id);

    let cpuPercent: number | undefined;
    if (cpuSnapshot) {
      if (previousSnapshot) {
        cpuPercent = calculateCpuPercent(cpuSnapshot, previousSnapshot);
      }
      this.previousCpuSnapshots.set(target.id, cpuSnapshot);
    }

    return {
      cpuPercent,
      memoryPercent: calculateMemoryPercent(samples),
      diskPercent: calculateDiskPercent(samples, target.diskMountpoint),
    };
  }

  private async fetchMetrics(target: HostTarget): Promise<{ text: string; failureReason?: undefined } | { text?: undefined; failureReason: string }> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), target.timeoutMs);

    try {
      const response = await fetch(target.metricsUrl, { signal: controller.signal });
      if (!response.ok) {
        return { failureReason: `unexpected HTTP status ${response.status}` };
      }
      return { text: await response.text() };
    } catch (error) {
      return { failureReason: describeFetchFailure(error, target.timeoutMs) };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
