import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import type { HttpTarget, LogTarget, HostTarget } from "../src/config/schema.js";
import { checkTarget } from "../src/monitoring/dispatch.js";

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

    const result = await checkTarget(target);

    assert.equal(result.success, true);
    assert.equal(result.targetId, "target-1");
  } finally {
    await closeServer(server);
  }
});

test("checkTarget throws a clear error for a log target, since the Log Monitor does not exist yet", async () => {
  const target: LogTarget = { ...buildCommon(), type: "log", path: "/var/log/app.log", patterns: ["ERROR"] };

  await assert.rejects(() => checkTarget(target), /log monitor is not implemented yet/);
});

test("checkTarget throws a clear error for a host target, since the Host Monitor does not exist yet", async () => {
  const target: HostTarget = { ...buildCommon(), type: "host" };

  await assert.rejects(() => checkTarget(target), /host monitor is not implemented yet/);
});
