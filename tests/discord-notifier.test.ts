import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { WebhookClient } from "discord.js";

import type { HttpTarget } from "../src/config/schema.js";
import { sendAlertToDiscord } from "../src/discord/notifier.js";
import type { AlertEvent } from "../src/types/index.js";

const FAKE_WEBHOOK_URL = `https://discord.com/api/webhooks/123456789012345678/${"a".repeat(68)}`;

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
    discordWebhookEnv: "DISCORD_NOTIFIER_TEST_WEBHOOK",
    url: "https://example.com",
    method: "GET",
    ...overrides,
  };
}

function buildDownEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: "DOWN",
    targetId: "target-1",
    targetName: "Example Site",
    occurredAt: new Date(2026, 0, 1, 14, 21, 12),
    message: "Example Site is DOWN after 2 consecutive failures",
    metadata: { consecutiveFailures: 2, lastError: "connection refused" },
    ...overrides,
  } as AlertEvent;
}

function buildRecoveredEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: "RECOVERED",
    targetId: "target-1",
    targetName: "Example Site",
    occurredAt: new Date(2026, 0, 1, 14, 35, 40),
    message: "Example Site recovered after 14m 28s",
    metadata: { downtimeMs: (14 * 60 + 28) * 1000 },
    ...overrides,
  } as AlertEvent;
}

function buildLogMatchEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: "LOG_MATCH",
    targetId: "target-1",
    targetName: "Application Log",
    occurredAt: new Date(2026, 0, 1, 14, 21, 12),
    message: 'Application Log matched 1 new log line(s) (pattern "ERROR"): ERROR disk full',
    metadata: { matchedPattern: "ERROR", matchedLine: "ERROR disk full", matchCount: 1 },
    ...overrides,
  } as AlertEvent;
}

function buildHostThresholdEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: "HOST_THRESHOLD",
    targetId: "target-1",
    targetName: "Application Host",
    occurredAt: new Date(2026, 0, 1, 14, 21, 12),
    message: "Application Host host threshold exceeded (CPU: 94.2%, Memory: 68.1%, Disk: 72.4%)",
    metadata: { cpuPercent: 94.2, memoryPercent: 68.1, diskPercent: 72.4 },
    ...overrides,
  } as AlertEvent;
}

test("sendAlertToDiscord sends an embed and reports success", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    const result = await sendAlertToDiscord(buildTarget(), buildDownEvent());

    assert.deepEqual(result, { success: true });
    assert.equal(sendMock.mock.calls.length, 1);
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord fails clearly when discordWebhookEnv is not set, without attempting delivery", async () => {
  delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);

  try {
    const result = await sendAlertToDiscord(buildTarget(), buildDownEvent());

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /DISCORD_NOTIFIER_TEST_WEBHOOK/);
    assert.equal(sendMock.mock.calls.length, 0);
  } finally {
    mock.restoreAll();
  }
});

test("sendAlertToDiscord reports a Discord API failure without leaking the webhook URL", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const apiError = Object.assign(new Error("Unknown Webhook"), {
    status: 404,
    code: 10015,
    url: FAKE_WEBHOOK_URL,
  });
  mock.method(WebhookClient.prototype, "send", async () => {
    throw apiError;
  });
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    const result = await sendAlertToDiscord(buildTarget(), buildDownEvent());

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /404/);
    assert.match(result.error ?? "", /10015/);
    assert.doesNotMatch(result.error ?? "", /a{68}/);
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord falls back to a generic message for an unrecognized delivery error", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  mock.method(WebhookClient.prototype, "send", async () => {
    throw new Error("socket hang up");
  });
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    const result = await sendAlertToDiscord(buildTarget(), buildDownEvent());

    assert.equal(result.success, false);
    assert.equal(result.error, "failed to deliver Discord notification");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord always destroys the webhook client, even after a delivery failure", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  mock.method(WebhookClient.prototype, "send", async () => {
    throw new Error("boom");
  });
  const destroyMock = mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildDownEvent());

    assert.equal(destroyMock.mock.calls.length, 1);
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord builds a DOWN embed with service, failures, and error fields", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildDownEvent());

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as {
      title?: string;
      fields?: { name: string; value: string }[];
    };

    assert.equal(embedData.title, "🔴 Service DOWN");
    const fieldNames = embedData.fields?.map((field) => field.name);
    assert.deepEqual(fieldNames, ["Service", "Failures", "Detected at", "Error"]);
    assert.equal(embedData.fields?.find((field) => field.name === "Failures")?.value, "2");
    assert.equal(embedData.fields?.find((field) => field.name === "Error")?.value, "connection refused");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord omits the Error field on a DOWN embed when there is no lastError", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildDownEvent({ metadata: { consecutiveFailures: 3 } }));

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as { fields?: { name: string }[] };

    assert.deepEqual(
      embedData.fields?.map((field) => field.name),
      ["Service", "Failures", "Detected at"]
    );
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord builds a RECOVERED embed with formatted downtime", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildRecoveredEvent());

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as {
      title?: string;
      fields?: { name: string; value: string }[];
    };

    assert.equal(embedData.title, "🟢 Service RECOVERED");
    assert.equal(embedData.fields?.find((field) => field.name === "Downtime")?.value, "14m 28s");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord shows unknown downtime on a RECOVERED embed when downtimeMs is missing", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildRecoveredEvent({ metadata: {} }));

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as { fields?: { name: string; value: string }[] };

    assert.equal(embedData.fields?.find((field) => field.name === "Downtime")?.value, "unknown");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord builds a LOG_MATCH embed with pattern and matched line", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildLogMatchEvent());

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as {
      title?: string;
      fields?: { name: string; value: string }[];
    };

    assert.equal(embedData.title, "🟠 Log Pattern Matched");
    assert.equal(embedData.fields?.find((field) => field.name === "Matches")?.value, "1");
    assert.equal(embedData.fields?.find((field) => field.name === "Pattern")?.value, "ERROR");
    assert.equal(embedData.fields?.find((field) => field.name === "Line")?.value, "ERROR disk full");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord omits Pattern and Line fields on a LOG_MATCH embed when they are absent", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildLogMatchEvent({ metadata: { matchCount: 3 } }));

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as { fields?: { name: string; value: string }[] };

    assert.deepEqual(
      embedData.fields?.map((field) => field.name),
      ["Service", "Matches", "Detected at"]
    );
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord builds a HOST_THRESHOLD embed with CPU, memory, and disk fields", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildHostThresholdEvent());

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as {
      title?: string;
      fields?: { name: string; value: string }[];
    };

    assert.equal(embedData.title, "🟠 Host threshold exceeded");
    assert.equal(embedData.fields?.find((field) => field.name === "CPU")?.value, "94.2%");
    assert.equal(embedData.fields?.find((field) => field.name === "Memory")?.value, "68.1%");
    assert.equal(embedData.fields?.find((field) => field.name === "Disk")?.value, "72.4%");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});

test("sendAlertToDiscord shows unknown for a HOST_THRESHOLD metric that could not be measured", async () => {
  process.env.DISCORD_NOTIFIER_TEST_WEBHOOK = FAKE_WEBHOOK_URL;
  const sendMock = mock.method(WebhookClient.prototype, "send", async () => ({}) as never);
  mock.method(WebhookClient.prototype, "destroy", () => {});

  try {
    await sendAlertToDiscord(buildTarget(), buildHostThresholdEvent({ metadata: { memoryPercent: 91 } }));

    const payload = sendMock.mock.calls[0].arguments[0] as { embeds: { toJSON(): Record<string, unknown> }[] };
    const embedData = payload.embeds[0].toJSON() as { fields?: { name: string; value: string }[] };

    assert.equal(embedData.fields?.find((field) => field.name === "CPU")?.value, "unknown");
    assert.equal(embedData.fields?.find((field) => field.name === "Memory")?.value, "91.0%");
  } finally {
    mock.restoreAll();
    delete process.env.DISCORD_NOTIFIER_TEST_WEBHOOK;
  }
});
