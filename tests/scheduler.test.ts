import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import type { HttpTarget } from "../src/config/schema.js";
import { Scheduler } from "../src/monitoring/scheduler.js";
import type { CheckResult } from "../src/types/index.js";

function buildTarget(overrides: Partial<HttpTarget> = {}): HttpTarget {
  return {
    id: "target-1",
    name: "Target 1",
    type: "http",
    enabled: true,
    intervalSeconds: 1,
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

function fakeResult(targetId: string): CheckResult {
  return { targetId, success: true, checkedAt: new Date(), durationMs: 1, metadata: {} };
}

test("Scheduler checks a target immediately on start and again after intervalSeconds", async () => {
  const target = buildTarget({ intervalSeconds: 0.05 });
  const calls: number[] = [];

  const scheduler = new Scheduler([target], async (t) => {
    calls.push(Date.now());
    return fakeResult(t.id);
  });

  scheduler.start();
  await delay(130);
  await scheduler.stop();

  assert.ok(calls.length >= 2, `expected at least 2 calls, got ${calls.length}`);
});

test("Scheduler never runs two checks of the same target concurrently", async () => {
  const target = buildTarget({ intervalSeconds: 0.02 });
  let activeChecks = 0;
  let maxConcurrent = 0;
  let callCount = 0;

  const scheduler = new Scheduler([target], async (t) => {
    activeChecks++;
    maxConcurrent = Math.max(maxConcurrent, activeChecks);
    callCount++;
    await delay(60);
    activeChecks--;
    return fakeResult(t.id);
  });

  scheduler.start();
  await delay(200);
  await scheduler.stop();

  assert.equal(maxConcurrent, 1);
  assert.ok(callCount >= 2, `expected at least 2 calls, got ${callCount}`);
});

test("Scheduler runs different targets independently, a slow one does not block a fast one", async () => {
  const slowTarget = buildTarget({ id: "slow", intervalSeconds: 0.02 });
  const fastTarget = buildTarget({ id: "fast", intervalSeconds: 0.02 });
  const callCounts: Record<string, number> = { slow: 0, fast: 0 };

  const scheduler = new Scheduler([slowTarget, fastTarget], async (t) => {
    if (t.id === "slow") {
      await delay(150);
    }
    callCounts[t.id] = (callCounts[t.id] ?? 0) + 1;
    return fakeResult(t.id);
  });

  scheduler.start();
  await delay(220);
  await scheduler.stop();

  assert.ok(
    callCounts.fast > callCounts.slow,
    `expected fast target to run more often than slow: ${JSON.stringify(callCounts)}`
  );
});

test("Scheduler keeps scheduling a target after a failed check", async () => {
  const target = buildTarget({ intervalSeconds: 0.02 });
  let callCount = 0;
  const errors: unknown[] = [];

  const scheduler = new Scheduler(
    [target],
    async () => {
      callCount++;
      throw new Error("boom");
    },
    { onCheckError: (_target, error) => errors.push(error) }
  );

  scheduler.start();
  await delay(100);
  await scheduler.stop();

  assert.ok(callCount >= 2, `expected at least 2 calls, got ${callCount}`);
  assert.equal(errors.length, callCount);
});

test("Scheduler calls onResult with the check result of a successful check", async () => {
  const target = buildTarget({ intervalSeconds: 1 });
  const results: CheckResult[] = [];

  const scheduler = new Scheduler([target], async (t) => fakeResult(t.id), {
    onResult: (_target, result) => results.push(result),
  });

  scheduler.start();
  await delay(20);
  await scheduler.stop();

  assert.equal(results.length, 1);
  assert.equal(results[0].targetId, "target-1");
});

test("Scheduler ignores disabled targets", async () => {
  const target = buildTarget({ enabled: false, intervalSeconds: 0.02 });
  let callCount = 0;

  const scheduler = new Scheduler([target], async (t) => {
    callCount++;
    return fakeResult(t.id);
  });

  scheduler.start();
  await delay(60);
  await scheduler.stop();

  assert.equal(callCount, 0);
});

test("Scheduler.stop resolves quickly instead of waiting for the full interval", async () => {
  const target = buildTarget({ intervalSeconds: 5 });

  const scheduler = new Scheduler([target], async (t) => fakeResult(t.id));

  scheduler.start();
  await delay(20);

  const stopStartedAt = Date.now();
  await scheduler.stop();
  const stopDurationMs = Date.now() - stopStartedAt;

  assert.ok(stopDurationMs < 500, `expected stop() to resolve quickly, took ${stopDurationMs}ms`);
});

test("Scheduler.stop waits for an in-flight check to finish", async () => {
  const target = buildTarget({ intervalSeconds: 1 });
  let checkFinished = false;

  const scheduler = new Scheduler([target], async (t) => {
    await delay(80);
    checkFinished = true;
    return fakeResult(t.id);
  });

  scheduler.start();
  await delay(10);
  await scheduler.stop();

  assert.equal(checkFinished, true);
});

test("Scheduler.start throws if called while already running", async () => {
  const target = buildTarget({ intervalSeconds: 1 });
  const scheduler = new Scheduler([target], async (t) => fakeResult(t.id));

  scheduler.start();
  assert.throws(() => scheduler.start());
  await scheduler.stop();
});
