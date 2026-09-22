import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import type { HttpTarget } from "../src/config/schema.js";
import { checkHttpTarget } from "../src/monitoring/http-monitor.js";

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

function startServer(handler: RequestHandler): Promise<{ server: Server; url: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(handler);
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectPromise(new Error("failed to determine test server address"));
        return;
      }
      resolvePromise({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function buildTarget(overrides: Partial<HttpTarget> & { url?: string }): HttpTarget {
  return {
    id: "test-target",
    name: "Test Target",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    type: "http",
    method: "GET",
    ...overrides,
  };
}

test("checkHttpTarget succeeds on 200", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });

  try {
    const result = await checkHttpTarget(buildTarget({ url }));

    assert.equal(result.success, true);
    assert.equal(result.metadata.statusCode, 200);
    assert.equal(result.error, undefined);
    assert.equal(result.targetId, "test-target");
    assert.equal(typeof result.durationMs, "number");
  } finally {
    await closeServer(server);
  }
});

test("checkHttpTarget treats a manual 3xx redirect as healthy", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(302, { Location: "http://127.0.0.1:9/unreachable" });
    res.end();
  });

  try {
    const result = await checkHttpTarget(buildTarget({ url }));

    assert.equal(result.success, true);
    assert.equal(result.metadata.statusCode, 302);
  } finally {
    await closeServer(server);
  }
});

test("checkHttpTarget fails on a 5xx response", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(500);
    res.end("error");
  });

  try {
    const result = await checkHttpTarget(buildTarget({ url }));

    assert.equal(result.success, false);
    assert.equal(result.metadata.statusCode, 500);
    assert.match(result.error ?? "", /500/);
  } finally {
    await closeServer(server);
  }
});

test("checkHttpTarget fails on a 4xx response", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(404);
    res.end("not found");
  });

  try {
    const result = await checkHttpTarget(buildTarget({ url }));

    assert.equal(result.success, false);
    assert.equal(result.metadata.statusCode, 404);
  } finally {
    await closeServer(server);
  }
});

test("checkHttpTarget fails with a timeout error when the server is too slow", async () => {
  const { server, url } = await startServer(async (_req, res) => {
    await delay(500);
    res.writeHead(200);
    res.end("too late");
  });

  try {
    const result = await checkHttpTarget(buildTarget({ url, timeoutMs: 50 }));

    assert.equal(result.success, false);
    assert.equal(result.metadata.statusCode, undefined);
    assert.match(result.error ?? "", /timed out/);
  } finally {
    await closeServer(server);
  }
});

test("checkHttpTarget fails with a connection refused error when nothing is listening on the port", async () => {
  const result = await checkHttpTarget(buildTarget({ url: "http://127.0.0.1:59999" }));

  assert.equal(result.success, false);
  assert.equal(result.metadata.statusCode, undefined);
  assert.match(result.error ?? "", /connection refused/);
});

test("checkHttpTarget fails clearly when urlEnv points to a missing environment variable", async () => {
  delete process.env.HTTP_MONITOR_TEST_MISSING_URL;

  const result = await checkHttpTarget(buildTarget({ url: undefined, urlEnv: "HTTP_MONITOR_TEST_MISSING_URL" }));

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /no resolvable url/);
});

test("checkHttpTarget resolves the url from urlEnv when set", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });

  process.env.HTTP_MONITOR_TEST_URL = url;

  try {
    const result = await checkHttpTarget(buildTarget({ url: undefined, urlEnv: "HTTP_MONITOR_TEST_URL" }));

    assert.equal(result.success, true);
    assert.equal(result.metadata.statusCode, 200);
  } finally {
    delete process.env.HTTP_MONITOR_TEST_URL;
    await closeServer(server);
  }
});
