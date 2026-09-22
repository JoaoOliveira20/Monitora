import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigValidationError, parseMonitoraConfig } from "../src/config/schema.js";

const validDefaults = {
  intervalSeconds: 60,
  timeoutMs: 5000,
  failureThreshold: 2,
  recoveryThreshold: 1,
  cooldownSeconds: 900,
};

test("parseMonitoraConfig accepts a config with no targets", () => {
  const config = parseMonitoraConfig({ version: 1, defaults: validDefaults, targets: [] });

  assert.equal(config.version, 1);
  assert.deepEqual(config.targets, []);
});

test("parseMonitoraConfig applies defaults to a target that omits threshold fields", () => {
  const config = parseMonitoraConfig({
    version: 1,
    defaults: validDefaults,
    targets: [
      {
        id: "example-site",
        name: "Example Site",
        type: "http",
        enabled: true,
        url: "https://example.com",
        discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
      },
    ],
  });

  const [target] = config.targets;
  assert.equal(target.intervalSeconds, validDefaults.intervalSeconds);
  assert.equal(target.failureThreshold, validDefaults.failureThreshold);
  assert.equal(target.type, "http");
  if (target.type === "http") {
    assert.equal(target.method, "GET");
  }
});

test("parseMonitoraConfig lets a target override defaults", () => {
  const config = parseMonitoraConfig({
    version: 1,
    defaults: validDefaults,
    targets: [
      {
        id: "example-site",
        name: "Example Site",
        type: "http",
        enabled: true,
        url: "https://example.com",
        intervalSeconds: 30,
        discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
      },
    ],
  });

  assert.equal(config.targets[0].intervalSeconds, 30);
});

test("parseMonitoraConfig rejects an http target without url or urlEnv", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "example-site",
            name: "Example Site",
            type: "http",
            enabled: true,
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects an http target with both url and urlEnv", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "example-site",
            name: "Example Site",
            type: "http",
            enabled: true,
            url: "https://example.com",
            urlEnv: "TARGET_URL",
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig accepts a valid log target", () => {
  const config = parseMonitoraConfig({
    version: 1,
    defaults: validDefaults,
    targets: [
      {
        id: "app-log",
        name: "Application Log",
        type: "log",
        enabled: true,
        path: "/var/log/monitored/app.log",
        patterns: ["ERROR", "FATAL"],
        discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
      },
    ],
  });

  const [target] = config.targets;
  assert.equal(target.type, "log");
  if (target.type === "log") {
    assert.deepEqual(target.patterns, ["ERROR", "FATAL"]);
  }
});

test("parseMonitoraConfig rejects a log target without patterns", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "app-log",
            name: "Application Log",
            type: "log",
            enabled: true,
            path: "/var/log/monitored/app.log",
            patterns: [],
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig accepts a valid host target", () => {
  const config = parseMonitoraConfig({
    version: 1,
    defaults: validDefaults,
    targets: [
      {
        id: "app-host",
        name: "Application Host",
        type: "host",
        enabled: true,
        cpuThresholdPercent: 90,
        discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
      },
    ],
  });

  const [target] = config.targets;
  assert.equal(target.type, "host");
  if (target.type === "host") {
    assert.equal(target.cpuThresholdPercent, 90);
  }
});

test("parseMonitoraConfig rejects a host threshold above 100 percent", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "app-host",
            name: "Application Host",
            type: "host",
            enabled: true,
            cpuThresholdPercent: 500,
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects an http target with a malformed url", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "example-site",
            name: "Example Site",
            type: "http",
            enabled: true,
            url: "not-a-url-at-all",
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects an unknown target type", () => {
  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [
          {
            id: "unknown-target",
            name: "Unknown Target",
            type: "tcp",
            enabled: true,
            discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
          },
        ],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects duplicate target ids", () => {
  const target = {
    id: "duplicate",
    name: "Duplicate",
    type: "log",
    enabled: false,
    path: "/var/log/duplicate.log",
    patterns: ["ERROR"],
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
  };

  assert.throws(
    () =>
      parseMonitoraConfig({
        version: 1,
        defaults: validDefaults,
        targets: [target, target],
      }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects a config without a version", () => {
  assert.throws(
    () => parseMonitoraConfig({ defaults: validDefaults, targets: [] }),
    ConfigValidationError
  );
});

test("parseMonitoraConfig rejects a config with invalid defaults", () => {
  assert.throws(
    () => parseMonitoraConfig({ version: 1, defaults: { intervalSeconds: -1 }, targets: [] }),
    ConfigValidationError
  );
});
