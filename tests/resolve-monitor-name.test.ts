import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveMonitorName } from "../src/index.js";

test("resolveMonitorName returns MONITOR_NAME when set", () => {
  assert.equal(resolveMonitorName({ MONITOR_NAME: "Test Monitor" }), "Test Monitor");
});

test("resolveMonitorName falls back to default when unset", () => {
  assert.equal(resolveMonitorName({}), "Monitora");
});

test("resolveMonitorName falls back to default when empty", () => {
  assert.equal(resolveMonitorName({ MONITOR_NAME: "" }), "Monitora");
});
