import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { test } from "node:test";

import type { HostTarget } from "../src/config/schema.js";
import { HostMonitor } from "../src/monitoring/host-monitor.js";

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
      resolvePromise({ server, url: `http://127.0.0.1:${address.port}/metrics` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function buildTarget(overrides: Partial<HostTarget> & { metricsUrl: string }): HostTarget {
  return {
    id: "host-target-1",
    name: "Host Target",
    type: "host",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    diskMountpoint: "/",
    cpuThresholdPercent: 90,
    memoryThresholdPercent: 90,
    diskThresholdPercent: 90,
    ...overrides,
  };
}

function metricsResponse(options: {
  cpuIdle: number;
  cpuUser: number;
  memTotal: number;
  memAvailable: number;
  fsSize: number;
  fsAvail: number;
  mountpoint?: string;
}): string {
  const mountpoint = options.mountpoint ?? "/";
  return `
node_cpu_seconds_total{cpu="0",mode="idle"} ${options.cpuIdle}
node_cpu_seconds_total{cpu="0",mode="user"} ${options.cpuUser}
node_memory_MemTotal_bytes ${options.memTotal}
node_memory_MemAvailable_bytes ${options.memAvailable}
node_filesystem_size_bytes{mountpoint="${mountpoint}"} ${options.fsSize}
node_filesystem_avail_bytes{mountpoint="${mountpoint}"} ${options.fsAvail}
`;
}

test("HostMonitor reports memory and disk percentages from a single scrape", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(
      metricsResponse({
        cpuIdle: 1000,
        cpuUser: 100,
        memTotal: 1000,
        memAvailable: 250,
        fsSize: 1000,
        fsAvail: 400,
      })
    );
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    assert.equal(result.metadata.memoryPercent, 75);
    assert.equal(result.metadata.diskPercent, 60);
    assert.equal(result.metadata.cpuPercent, undefined);
    assert.equal(result.success, true);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor does not report cpuPercent on the first scrape (needs a baseline)", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 500, fsSize: 1000, fsAvail: 500 }));
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    assert.equal(result.metadata.cpuPercent, undefined);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor calculates cpuPercent from the delta between two scrapes", async () => {
  let responseBody = metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 500, fsSize: 1000, fsAvail: 500 });

  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(responseBody);
  });

  try {
    const monitor = new HostMonitor();
    await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    responseBody = metricsResponse({ cpuIdle: 1050, cpuUser: 150, memTotal: 1000, memAvailable: 500, fsSize: 1000, fsAvail: 500 });
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    assert.equal(result.metadata.cpuPercent, 50);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor fails when a threshold is exceeded", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 50, fsSize: 1000, fsAvail: 500 }));
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url, memoryThresholdPercent: 90 }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /memory/);
    assert.equal(result.metadata.memoryPercent, 95);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor succeeds when all metrics are below their thresholds", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 900, fsSize: 1000, fsAvail: 900 }));
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    assert.equal(result.success, true);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor respects a custom diskMountpoint", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(
      `${metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 900, fsSize: 1000, fsAvail: 900, mountpoint: "/" })}\nnode_filesystem_size_bytes{mountpoint="/data"} 2000\nnode_filesystem_avail_bytes{mountpoint="/data"} 200\n`
    );
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url, diskMountpoint: "/data" }));

    assert.equal(result.metadata.diskPercent, 90);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor reports a connection refused failure without throwing", async () => {
  const monitor = new HostMonitor();
  const result = await monitor.checkTarget(buildTarget({ metricsUrl: "http://127.0.0.1:59998/metrics" }));

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /connection refused/);
});

test("HostMonitor reports a clear failure on a non-OK HTTP status from the metrics endpoint", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(500);
    res.end("internal error");
  });

  try {
    const monitor = new HostMonitor();
    const result = await monitor.checkTarget(buildTarget({ metricsUrl: url }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /500/);
  } finally {
    await closeServer(server);
  }
});

test("HostMonitor keeps CPU baseline state isolated between different targets", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200);
    res.end(metricsResponse({ cpuIdle: 1000, cpuUser: 100, memTotal: 1000, memAvailable: 900, fsSize: 1000, fsAvail: 900 }));
  });

  try {
    const monitor = new HostMonitor();
    const targetA = buildTarget({ id: "host-a", metricsUrl: url });
    const targetB = buildTarget({ id: "host-b", metricsUrl: url });

    const resultA = await monitor.checkTarget(targetA);
    const resultB = await monitor.checkTarget(targetB);

    assert.equal(resultA.metadata.cpuPercent, undefined);
    assert.equal(resultB.metadata.cpuPercent, undefined);
  } finally {
    await closeServer(server);
  }
});
