import assert from "node:assert/strict";
import { test } from "node:test";

import type { HttpTarget } from "../src/config/schema.js";
import { evaluateAlert, formatDuration } from "../src/monitoring/alert-policy.js";
import type { MonitorState, StateTransition } from "../src/types/index.js";

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

function buildState(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    targetId: "target-1",
    status: "DOWN",
    consecutiveFailures: 2,
    consecutiveSuccesses: 0,
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

  const event = evaluateAlert(target, state, transition, at(1));

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

  const event = evaluateAlert(target, state, transition, at(0));

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

  const event = evaluateAlert(target, state, transition, at(0));

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

  const event = evaluateAlert(target, state, transition, at(900));

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

  const event = evaluateAlert(target, state, transition, at(900));

  assert.equal(event?.type, "RECOVERED");
});

test("evaluateAlert does not alert when there is no transition and the target is UP", () => {
  const target = buildTarget();
  const state = buildState({ status: "UP", consecutiveFailures: 0 });

  const event = evaluateAlert(target, state, undefined, at(0));

  assert.equal(event, undefined);
});

test("evaluateAlert does not send a reminder before cooldownSeconds has elapsed", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });

  const event = evaluateAlert(target, state, undefined, at(500));

  assert.equal(event, undefined);
});

test("evaluateAlert sends a reminder once cooldownSeconds has elapsed for a persistent outage", () => {
  const target = buildTarget({ cooldownSeconds: 900 });
  const state = buildState({ status: "DOWN", lastAlertAt: at(0) });

  const event = evaluateAlert(target, state, undefined, at(900));

  assert.equal(event?.type, "DOWN");
});

test("evaluateAlert sends a reminder when the target is DOWN and no alert was ever sent", () => {
  const target = buildTarget();
  const state = buildState({ status: "DOWN", lastAlertAt: undefined });

  const event = evaluateAlert(target, state, undefined, at(0));

  assert.equal(event?.type, "DOWN");
});
