import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { loadTargetsConfig } from "../src/config/loader.js";

const EXAMPLE_TARGETS_PATH = resolve(process.cwd(), "config/targets.example.json");
const ENV_EXAMPLE_PATH = resolve(process.cwd(), ".env.example");

test("config/targets.example.json is accepted by the real configuration schema", () => {
  const config = loadTargetsConfig(EXAMPLE_TARGETS_PATH);

  assert.ok(config.targets.length > 0);
});

test("config/targets.example.json demonstrates every supported target type", () => {
  const config = loadTargetsConfig(EXAMPLE_TARGETS_PATH);
  const types = new Set(config.targets.map((target) => target.type));

  assert.ok(types.has("http"), "expected an http example target");
  assert.ok(types.has("log"), "expected a log example target");
  assert.ok(types.has("host"), "expected a host example target");
});

test("config/targets.example.json keeps every example target disabled", () => {
  const config = loadTargetsConfig(EXAMPLE_TARGETS_PATH);

  for (const target of config.targets) {
    assert.equal(target.enabled, false, `expected example target "${target.id}" to be disabled`);
  }
});

test(".env.example lists every variable the project reads from process.env", () => {
  const contents = readFileSync(ENV_EXAMPLE_PATH, "utf-8");
  const requiredVariableNames = [
    "NODE_ENV",
    "MONITOR_NAME",
    "MONITORA_CONFIG_PATH",
    "DISCORD_WEBHOOK_MAIN",
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_ID",
  ];

  for (const variableName of requiredVariableNames) {
    assert.match(
      contents,
      new RegExp(`^${variableName}=`, "m"),
      `expected .env.example to list "${variableName}"`
    );
  }
});

test(".env.example never contains a real-looking Discord webhook URL", () => {
  const contents = readFileSync(ENV_EXAMPLE_PATH, "utf-8");

  assert.doesNotMatch(contents, /discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/i);
});
