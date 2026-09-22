import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStatusResponse } from "../src/commands/status.js";
import type { HostTarget, HttpTarget, LogTarget, Target } from "../src/config/schema.js";
import { StateStore } from "../src/monitoring/state-store.js";
import type { CheckResult } from "../src/types/index.js";

function buildHttpTarget(overrides: Partial<HttpTarget> = {}): HttpTarget {
  return {
    id: "site",
    name: "Example Site",
    type: "http",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    url: "https://example.com",
    method: "GET",
    ...overrides,
  };
}

function buildLogTarget(overrides: Partial<LogTarget> = {}): LogTarget {
  return {
    id: "app-log",
    name: "App Log",
    type: "log",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    path: "/var/log/app.log",
    patterns: ["ERROR"],
    ...overrides,
  };
}

function buildHostTarget(overrides: Partial<HostTarget> = {}): HostTarget {
  return {
    id: "host",
    name: "My Server",
    type: "host",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    metricsUrl: "http://node-exporter:9100/metrics",
    diskMountpoint: "/",
    cpuThresholdPercent: 90,
    ...overrides,
  };
}

function buildResult(targetId: string, overrides: Partial<CheckResult> & { checkedAt: Date }): CheckResult {
  return {
    targetId,
    success: true,
    durationMs: 10,
    metadata: {},
    ...overrides,
  };
}

function at(secondsFromEpoch: number): Date {
  return new Date(secondsFromEpoch * 1000);
}

test("buildStatusResponse reports no targets configured when the list is empty", () => {
  const response = buildStatusResponse("Monitora", [], new StateStore(), at(0));

  assert.equal(response, "Monitora\n\nNo targets configured.");
});

test("buildStatusResponse ignores disabled targets", () => {
  const target = buildHttpTarget({ enabled: false });

  const response = buildStatusResponse("Monitora", [target], new StateStore(), at(0));

  assert.equal(response, "Monitora\n\nNo targets configured.");
});

test("buildStatusResponse shows UNKNOWN for a target that was never checked", () => {
  const target = buildHttpTarget();

  const response = buildStatusResponse("Monitora", [target], new StateStore(), at(0));

  assert.match(response, /⚪ Example Site\nUNKNOWN · waiting for first check/);
});

test("buildStatusResponse shows UP with latency for a healthy http target", () => {
  const target = buildHttpTarget();
  const store = new StateStore();
  store.recordCheckResult(target, buildResult(target.id, { success: true, durationMs: 183, checkedAt: at(0) }));

  const response = buildStatusResponse("Monitora", [target], store, at(0));

  assert.match(response, /🟢 Example Site\nUP · 183ms/);
});

test("buildStatusResponse shows DOWN with elapsed downtime for a failing http target", () => {
  const target = buildHttpTarget({ failureThreshold: 1 });
  const store = new StateStore();
  store.recordCheckResult(target, buildResult(target.id, { success: false, checkedAt: at(0) }));

  const response = buildStatusResponse("Monitora", [target], store, at(452));

  assert.match(response, /🔴 Example Site\nDOWN · 7m 32s/);
});

test("buildStatusResponse shows UP/DOWN for a log target the same way as http", () => {
  const target = buildLogTarget({ failureThreshold: 1 });
  const store = new StateStore();
  store.recordCheckResult(target, buildResult(target.id, { success: false, checkedAt: at(0) }));

  const response = buildStatusResponse("Monitora", [target], store, at(10));

  assert.match(response, /🔴 App Log\nDOWN/);
});

test("buildStatusResponse shows CPU/RAM/Disk for a host target using the last recorded metadata", () => {
  const target = buildHostTarget();
  const store = new StateStore();
  store.recordCheckResult(
    target,
    buildResult(target.id, {
      success: true,
      checkedAt: at(0),
      metadata: { cpuPercent: 34.4, memoryPercent: 61.2, diskPercent: 72.9 },
    })
  );

  const response = buildStatusResponse("Monitora", [target], store, at(0));

  assert.match(response, /🟢 My Server\nCPU 34% · RAM 61% · Disk 73%/);
});

test("buildStatusResponse shows a placeholder for a host target with no metrics yet", () => {
  const target = buildHostTarget();
  const store = new StateStore();
  store.recordCheckResult(target, buildResult(target.id, { success: true, checkedAt: at(0), metadata: {} }));

  const response = buildStatusResponse("Monitora", [target], store, at(0));

  assert.match(response, /no metrics available yet/);
});

test("buildStatusResponse lists multiple targets of different types in the given order", () => {
  const httpTarget = buildHttpTarget();
  const logTarget = buildLogTarget();
  const hostTarget = buildHostTarget();
  const targets: Target[] = [httpTarget, logTarget, hostTarget];
  const store = new StateStore();

  const response = buildStatusResponse("Monitora", targets, store, at(0));

  const siteIndex = response.indexOf("Example Site");
  const logIndex = response.indexOf("App Log");
  const hostIndex = response.indexOf("My Server");

  assert.ok(siteIndex < logIndex);
  assert.ok(logIndex < hostIndex);
});
