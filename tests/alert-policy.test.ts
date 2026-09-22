import assert from "node:assert/strict";
import { test } from "node:test";

import type { HttpTarget, LogTarget } from "../src/config/schema.js";
import { evaluateAlert, formatDuration } from "../src/monitoring/alert-policy.js";
import type { CheckResult, LogCheckMetadata, MonitorState, StateTransition } from "../src/types/index.js";

function buildTarget(overrides: Partial<HttpTarget> = {}): HttpTarget {
  return {
    id: "target-1",
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
    id: "target-1",
    name: "Application Log",
    type: "log",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    path: "/var/log/monitored/app.log",
    patterns: ["ERROR"],
    ...overrides,
  };
}

function buildState(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    targetId: "target-1",
    status: "DOWN",
    consecutiveFailures: 2,
    consecutiveSuccesses: 0,
    ...overrides,
  };
}

function buildResult(overrides: Partial<CheckResult> & { checkedAt: Date }): CheckResult {
  return {
    targetId: "target-1",
    success: true,
    durationMs: 10,
    metadata: {},
    ...overrides,
  };
}

function buildLogResult(overrides: Partial<CheckResult<LogCheckMetadata>> & { checkedAt: Date }): CheckResult<LogCheckMetadata> {
  return {
    targetId: "target-1",
    success: true,
    durationMs: 10,
    metadata: { matchCount: 0 },
    ...overrides,
  };
}

function at(secondsFromEpoch: number): Date {
  return new Date(secondsFromEpoch * 1000);
}

test("formatDuration formats seconds only", () => {
  assert.equal(formatDuration(45_000), "45s");
});

test("formatDuration formats minutes and seconds", () => {
  assert.equal(formatDuration((14 * 60 + 28) * 1000), "14m 28s");
});

test("formatDuration formats hours, minutes, and seconds", () => {
  assert.equal(formatDuration((2 * 3600 + 5 * 60 + 3) * 1000), "2h 5m 3s");
});

test("evaluateAlert generates a DOWN event immediately on UP -> DOWN transition, ignoring cooldown", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", consecutiveFailures: 2, lastAlertAt: at(0) });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "UP",
    newStatus: "DOWN",
    occurredAt: at(1),
  };
  const result = buildResult({ success: false, checkedAt: at(1) });

  const event = evaluateAlert(target, state, transition, result, at(1));

  assert.equal(event?.type, "DOWN");
  assert.equal(event?.targetName, "Example Site");
  assert.match(event?.message ?? "", /2 consecutive failures/);
});

test("evaluateAlert generates a DOWN event on UNKNOWN -> DOWN transition", () => {
  const target = buildTarget();
  const state = buildState({ status: "DOWN", consecutiveFailures: 2 });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "UNKNOWN",
    newStatus: "DOWN",
    occurredAt: at(0),
  };
  const result = buildResult({ success: false, checkedAt: at(0) });

  const event = evaluateAlert(target, state, transition, result, at(0));

  assert.equal(event?.type, "DOWN");
});

test("evaluateAlert includes lastError in the DOWN message and metadata when present", () => {
  const target = buildTarget();
  const state = buildState({ lastError: "connection refused" });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "UP",
    newStatus: "DOWN",
    occurredAt: at(0),
  };
  const result = buildResult({ success: false, error: "connection refused", checkedAt: at(0) });

  const event = evaluateAlert(target, state, transition, result, at(0));

  assert.match(event?.message ?? "", /connection refused/);
  assert.deepEqual(event?.metadata, { consecutiveFailures: 2, lastError: "connection refused" });
});

test("evaluateAlert generates a RECOVERED event on DOWN -> UP transition with formatted downtime", () => {
  const target = buildTarget();
  const state = buildState({ status: "UP", consecutiveFailures: 0, consecutiveSuccesses: 1 });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "DOWN",
    newStatus: "UP",
    occurredAt: at(900),
    downtimeMs: (14 * 60 + 28) * 1000,
  };
  const result = buildResult({ success: true, checkedAt: at(900) });

  const event = evaluateAlert(target, state, transition, result, at(900));

  assert.equal(event?.type, "RECOVERED");
  assert.match(event?.message ?? "", /14m 28s/);
  assert.deepEqual(event?.metadata, { downtimeMs: (14 * 60 + 28) * 1000 });
});

test("evaluateAlert generates a RECOVERED event even when the cooldown has not elapsed", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "UP", lastAlertAt: at(890) });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "DOWN",
    newStatus: "UP",
    occurredAt: at(900),
    downtimeMs: 900_000,
  };
  const result = buildResult({ success: true, checkedAt: at(900) });

  const event = evaluateAlert(target, state, transition, result, at(900));

  assert.equal(event?.type, "RECOVERED");
});

test("evaluateAlert does not alert when there is no transition and the target is UP", () => {
  const target = buildTarget();
  const state = buildState({ status: "UP", consecutiveFailures: 0 });
  const result = buildResult({ success: true, checkedAt: at(0) });

  const event = evaluateAlert(target, state, undefined, result, at(0));

  assert.equal(event, undefined);
});

test("evaluateAlert does not send a reminder before cooldownSeconds has elapsed", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });
  const result = buildResult({ success: false, checkedAt: at(500) });

  const event = evaluateAlert(target, state, undefined, result, at(500));

  assert.equal(event, undefined);
});

test("evaluateAlert sends a reminder once cooldownSeconds has elapsed for a persistent outage", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });
  const result = buildResult({ success: false, checkedAt: at(900) });

  const event = evaluateAlert(target, state, undefined, result, at(900));

  assert.equal(event?.type, "DOWN");
});

test("evaluateAlert sends a reminder when the target is DOWN and no alert was ever sent", () => {
  const target = buildTarget();
  const state = buildState({ status: "DOWN", lastAlertAt: undefined });
  const result = buildResult({ success: false, checkedAt: at(0) });

  const event = evaluateAlert(target, state, undefined, result, at(0));

  assert.equal(event?.type, "DOWN");
});

test("evaluateAlert generates a LOG_MATCH event immediately when a log target matches, ignoring failureThreshold", () => {
  const target = buildLogTarget({ failureThreshold: 5 });
  const state = buildState({ status: "UNKNOWN", consecutiveFailures: 1 });
  const result = buildLogResult({
    success: false,
    error: 'pattern "ERROR" matched 1 new line(s)',
    checkedAt: at(0),
    metadata: { matchedPattern: "ERROR", matchedLine: "ERROR disk full", matchCount: 1 },
  });

  const event = evaluateAlert(target, state, undefined, result, at(0));

  assert.equal(event?.type, "LOG_MATCH");
  assert.match(event?.message ?? "", /ERROR disk full/);
  assert.deepEqual(event?.metadata, { matchedPattern: "ERROR", matchedLine: "ERROR disk full", matchCount: 1 });
});

test("evaluateAlert never generates DOWN or RECOVERED for a log target, even if the State Store reports a transition", () => {
  const target = buildLogTarget();
  const state = buildState({ status: "DOWN" });
  const transition: StateTransition = {
    targetId: "target-1",
    previousStatus: "UP",
    newStatus: "DOWN",
    occurredAt: at(0),
  };
  const result = buildLogResult({ success: false, checkedAt: at(0), metadata: { matchCount: 1 } });

  const event = evaluateAlert(target, state, transition, result, at(0));

  assert.equal(event?.type, "LOG_MATCH");
});

test("evaluateAlert does not alert for a log target when the check has no match", () => {
  const target = buildLogTarget();
  const state = buildState({ status: "UP" });
  const result = buildLogResult({ success: true, checkedAt: at(0) });

  const event = evaluateAlert(target, state, undefined, result, at(0));

  assert.equal(event, undefined);
});

test("evaluateAlert respects cooldownSeconds between repeated log matches", () => {
  const target = buildLogTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });
  const result = buildLogResult({ success: false, checkedAt: at(500), metadata: { matchCount: 1 } });

  const event = evaluateAlert(target, state, undefined, result, at(500));

  assert.equal(event, undefined);
});

test("evaluateAlert generates a new LOG_MATCH once cooldownSeconds has elapsed since the last one", () => {
  const target = buildLogTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });
  const result = buildLogResult({ success: false, checkedAt: at(900), metadata: { matchCount: 2 } });

  const event = evaluateAlert(target, state, undefined, result, at(900));

  assert.equal(event?.type, "LOG_MATCH");
});
