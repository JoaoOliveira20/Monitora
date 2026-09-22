import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { HttpTarget, HostTarget, LogTarget } from "../src/config/schema.js";
import { createDispatcher } from "../src/monitoring/dispatch.js";

function startServer(): Promise<{ server: Server; url: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("failed to determine test server address");
      }
      resolvePromise({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function buildCommon() {
  return {
    id: "target-1",
    name: "Target 1",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
  };
}

test("checkTarget dispatches an http target to the HTTP monitor", async () => {
  const { server, url } = await startServer();

  try {
    const target: HttpTarget = { ...buildCommon(), type: "http", url, method: "GET" };
    const checkTarget = createDispatcher();

    const result = await checkTarget(target);

    assert.equal(result.success, true);
    assert.equal(result.targetId, "target-1");
  } finally {
    await closeServer(server);
  }
});

test("checkTarget dispatches a log target to the Log Monitor and keeps its read state across calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "monitora-dispatch-log-"));
  const path = join(dir, "app.log");

  try {
    await writeFile(path, "");

    const target: LogTarget = { ...buildCommon(), type: "log", path, patterns: ["ERROR"] };
    const checkTarget = createDispatcher();

    const first = await checkTarget(target);
    assert.equal(first.success, true);

    await writeFile(path, "ERROR disk full\n");
    const second = await checkTarget(target);

    assert.equal(second.success, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkTarget throws a clear error for a host target, since the Host Monitor does not exist yet", async () => {
  const target: HostTarget = { ...buildCommon(), type: "host" };
  const checkTarget = createDispatcher();

  await assert.rejects(() => checkTarget(target), /host monitor is not implemented yet/);
});
