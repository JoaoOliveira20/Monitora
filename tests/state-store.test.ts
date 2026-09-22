import assert from "node:assert/strict";
import { test } from "node:test";

import type { HttpTarget } from "../src/config/schema.js";
import { StateStore } from "../src/monitoring/state-store.js";
import type { CheckResult } from "../src/types/index.js";

function buildTarget(overrides: Partial<HttpTarget> = {}): HttpTarget {
  return {
    id: "target-1",
    name: "Target 1",
    type: "http",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 2,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    url: "https://example.com",
    method: "GET",
    ...overrides,
  };
}

function buildResult(overrides: Partial<CheckResult> & { checkedAt: Date }): CheckResult {
  return {
    targetId: "target-1",
    success: true,
    durationMs: 100,
    metadata: {},
    ...overrides,
  };
}

function at(secondsFromEpoch: number): Date {
  return new Date(secondsFromEpoch * 1000);
}

test("StateStore starts a target as UNKNOWN with no history", () => {
  const store = new StateStore();

  assert.equal(store.getState("target-1"), undefined);
});

test("StateStore transitions UNKNOWN to UP on the first successful check", () => {
  const store = new StateStore();
  const target = buildTarget();

  const transition = store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(0) }));

  assert.deepEqual(transition, { targetId: "target-1", previousStatus: "UNKNOWN", newStatus: "UP", occurredAt: at(0) });
  assert.equal(store.getState("target-1")?.status, "UP");
});

test("StateStore stays UNKNOWN until failureThreshold consecutive failures are seen", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 2 });

  const first = store.recordCheckResult(target, buildResult({ success: false, error: "boom", checkedAt: at(0) }));
  assert.equal(first, undefined);
  assert.equal(store.getState("target-1")?.status, "UNKNOWN");

  const second = store.recordCheckResult(target, buildResult({ success: false, error: "boom", checkedAt: at(60) }));
  assert.equal(second?.previousStatus, "UNKNOWN");
  assert.equal(second?.newStatus, "DOWN");
  assert.equal(store.getState("target-1")?.status, "DOWN");
});

test("StateStore transitions UP to DOWN only after failureThreshold consecutive failures", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 2 });

  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(0) }));

  const oneFailure = store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(60) }));
  assert.equal(oneFailure, undefined);
  assert.equal(store.getState("target-1")?.status, "UP");

  const twoFailures = store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(120) }));
  assert.equal(twoFailures?.newStatus, "DOWN");
});

test("StateStore resets the failure count after a successful check while UP", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 2 });

  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(0) }));
  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(60) }));
  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(120) }));

  assert.equal(store.getState("target-1")?.consecutiveFailures, 0);
  assert.equal(store.getState("target-1")?.status, "UP");

  const stillUp = store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(180) }));
  assert.equal(stillUp, undefined);
  assert.equal(store.getState("target-1")?.status, "UP");
});

test("StateStore transitions DOWN to UP only after recoveryThreshold consecutive successes", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 1, recoveryThreshold: 2 });

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  assert.equal(store.getState("target-1")?.status, "DOWN");

  const oneSuccess = store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(60) }));
  assert.equal(oneSuccess, undefined);
  assert.equal(store.getState("target-1")?.status, "DOWN");

  const twoSuccesses = store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(120) }));
  assert.equal(twoSuccesses?.previousStatus, "DOWN");
  assert.equal(twoSuccesses?.newStatus, "UP");
});

test("StateStore resets the recovery success count when a failure interrupts it (flapping)", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 1, recoveryThreshold: 2 });

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(60) }));
  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(120) }));

  assert.equal(store.getState("target-1")?.status, "DOWN");
  assert.equal(store.getState("target-1")?.consecutiveSuccesses, 0);

  const stillDown = store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(180) }));
  assert.equal(stillDown, undefined);
  assert.equal(store.getState("target-1")?.status, "DOWN");
});

test("StateStore computes downtime from the first failure of the outage, not from when DOWN was confirmed", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 2, recoveryThreshold: 1 });

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  const confirmedDown = store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(60) }));
  assert.equal(confirmedDown?.newStatus, "DOWN");

  const recovered = store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(300) }));

  assert.equal(recovered?.newStatus, "UP");
  assert.equal(recovered?.downtimeMs, (300 - 0) * 1000);
});

test("StateStore clears firstFailureAt once recovered", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 1, recoveryThreshold: 1 });

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(60) }));

  assert.equal(store.getState("target-1")?.firstFailureAt, undefined);
});

test("StateStore keeps lastError populated while failing and clears it on success", () => {
  const store = new StateStore();
  const target = buildTarget();

  store.recordCheckResult(target, buildResult({ success: false, error: "connection refused", checkedAt: at(0) }));
  assert.equal(store.getState("target-1")?.lastError, "connection refused");

  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(60) }));
  assert.equal(store.getState("target-1")?.lastError, undefined);
});

test("StateStore tracks lastLatencyMs and lastCheckedAt on every check", () => {
  const store = new StateStore();
  const target = buildTarget();

  store.recordCheckResult(target, buildResult({ success: true, durationMs: 42, checkedAt: at(0) }));

  const state = store.getState("target-1");
  assert.equal(state?.lastLatencyMs, 42);
  assert.deepEqual(state?.lastCheckedAt, at(0));
});

test("StateStore keeps the metadata of the most recent check for later inspection (e.g. by /status)", () => {
  const store = new StateStore();
  const target = buildTarget();

  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(0), metadata: { statusCode: 200 } }));
  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(60), metadata: { statusCode: 204 } }));

  assert.deepEqual(store.getState("target-1")?.lastMetadata, { statusCode: 204 });
});

test("StateStore keeps firstFailureAt fixed across multiple consecutive failures while lastFailureAt advances", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 5, recoveryThreshold: 1 });

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(60) }));
  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(120) }));

  const state = store.getState("target-1");
  assert.deepEqual(state?.firstFailureAt, at(0));
  assert.deepEqual(state?.lastFailureAt, at(120));
});

test("StateStore keeps lastSuccessAt and lastFailureAt as independent histories that do not overwrite each other", () => {
  const store = new StateStore();
  const target = buildTarget({ failureThreshold: 1, recoveryThreshold: 1 });

  store.recordCheckResult(target, buildResult({ success: true, checkedAt: at(0) }));
  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(60) }));

  const state = store.getState("target-1");
  assert.deepEqual(state?.lastSuccessAt, at(0));
  assert.deepEqual(state?.lastFailureAt, at(60));
});

test("StateStore.recordAlertSent updates lastAlertAt for an existing target", () => {
  const store = new StateStore();
  const target = buildTarget();

  store.recordCheckResult(target, buildResult({ success: false, checkedAt: at(0) }));
  store.recordAlertSent("target-1", at(30));

  assert.deepEqual(store.getState("target-1")?.lastAlertAt, at(30));
});

test("StateStore.recordAlertSent does nothing for a target with no recorded state", () => {
  const store = new StateStore();

  store.recordAlertSent("unknown-target", at(0));

  assert.equal(store.getState("unknown-target"), undefined);
});

test("StateStore keeps state isolated between targets", () => {
  const store = new StateStore();
  const targetA = buildTarget({ id: "target-a", failureThreshold: 1 });
  const targetB = buildTarget({ id: "target-b", failureThreshold: 1 });

  store.recordCheckResult(targetA, { ...buildResult({ success: false, checkedAt: at(0) }), targetId: "target-a" });
  store.recordCheckResult(targetB, { ...buildResult({ success: true, checkedAt: at(0) }), targetId: "target-b" });

  assert.equal(store.getState("target-a")?.status, "DOWN");
  assert.equal(store.getState("target-b")?.status, "UP");
  assert.equal(store.getAllStates().length, 2);
});
