import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { loadTargetsConfig } from "../src/config/loader.js";
import { ConfigValidationError } from "../src/config/schema.js";

const fixturePath = (fileName: string): string => resolve(process.cwd(), "tests/fixtures", fileName);

test("loadTargetsConfig loads and parses a valid configuration file", () => {
  const config = loadTargetsConfig(fixturePath("valid-config.json"));

  assert.equal(config.targets.length, 2);
});

test("loadTargetsConfig rejects a missing configuration file", () => {
  assert.throws(() => loadTargetsConfig(fixturePath("does-not-exist.json")), ConfigValidationError);
});

test("loadTargetsConfig rejects malformed JSON", () => {
  assert.throws(() => loadTargetsConfig(fixturePath("invalid-json.json")), ConfigValidationError);
});

test("loadTargetsConfig rejects an enabled target whose referenced environment variable is missing", () => {
  delete process.env.TARGET_INTERNAL_API_URL_TEST;
  delete process.env.DISCORD_WEBHOOK_MAIN_TEST;

  assert.throws(
    () => loadTargetsConfig(fixturePath("enabled-target-config.json")),
    ConfigValidationError
  );
});

test("loadTargetsConfig accepts an enabled target once its referenced environment variables are set", () => {
  process.env.TARGET_INTERNAL_API_URL_TEST = "https://internal.example.com";
  process.env.DISCORD_WEBHOOK_MAIN_TEST = "https://discord.com/api/webhooks/test";

  const config = loadTargetsConfig(fixturePath("enabled-target-config.json"));

  assert.equal(config.targets[0].enabled, true);

  delete process.env.TARGET_INTERNAL_API_URL_TEST;
  delete process.env.DISCORD_WEBHOOK_MAIN_TEST;
});
