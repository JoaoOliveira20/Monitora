import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { LogTarget } from "../src/config/schema.js";
import { LogMonitor } from "../src/monitoring/log-monitor.js";

function buildTarget(overrides: Partial<LogTarget> & { path: string }): LogTarget {
  return {
    id: "log-target-1",
    name: "Log Target",
    type: "log",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    cooldownSeconds: 900,
    discordWebhookEnv: "DISCORD_WEBHOOK_MAIN",
    patterns: ["ERROR"],
    ...overrides,
  };
}

async function withTempLogFile(run: (path: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "monitora-log-monitor-"));
  const path = join(dir, "app.log");
  try {
    await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("LogMonitor does not report matches from existing content on the first check (tail -f behavior)", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "INFO boot\nERROR something already broken\n");

    const monitor = new LogMonitor();
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.success, true);
    assert.equal(result.metadata.matchCount, 0);
  });
});

test("LogMonitor detects a pattern match in a new line written after the first check", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "INFO boot\n");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "INFO boot\nERROR disk full\n");
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.success, false);
    assert.equal(result.metadata.matchCount, 1);
    assert.equal(result.metadata.matchedPattern, "ERROR");
    assert.equal(result.metadata.matchedLine, "ERROR disk full");
  });
});

test("LogMonitor reports success when new lines do not match any pattern", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "INFO boot\n");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "INFO boot\nINFO still fine\n");
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.success, true);
    assert.equal(result.metadata.matchCount, 0);
  });
});

test("LogMonitor counts every matching line added in a single cycle", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "ERROR one\nERROR two\nERROR three\n");
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.metadata.matchCount, 3);
  });
});

test("LogMonitor does not process a partial line until it is completed with a newline", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "ERROR partial line without newline yet");
    const partialResult = await monitor.checkTarget(buildTarget({ path }));
    assert.equal(partialResult.metadata.matchCount, 0);

    await writeFile(path, "ERROR partial line without newline yet\n");
    const completedResult = await monitor.checkTarget(buildTarget({ path }));
    assert.equal(completedResult.metadata.matchCount, 1);
  });
});

test("LogMonitor never re-reads lines that were already processed", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "ERROR one\n");
    const first = await monitor.checkTarget(buildTarget({ path }));
    assert.equal(first.metadata.matchCount, 1);

    const second = await monitor.checkTarget(buildTarget({ path }));
    assert.equal(second.metadata.matchCount, 0);
  });
});

test("LogMonitor detects truncation and reads from the start of the shrunk file", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "line one\nline two\nline three\n");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await writeFile(path, "ERROR after truncation\n");
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.metadata.matchCount, 1);
    assert.equal(result.metadata.matchedLine, "ERROR after truncation");
  });
});

test("LogMonitor detects the file being deleted and recreated (rotation) and reads from its start", async () => {
  await withTempLogFile(async (path) => {
    await writeFile(path, "line one\n");

    const monitor = new LogMonitor();
    await monitor.checkTarget(buildTarget({ path }));

    await unlink(path);
    await writeFile(path, "ERROR after rotation\n");
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.metadata.matchCount, 1);
    assert.equal(result.metadata.matchedLine, "ERROR after rotation");
  });
});

test("LogMonitor reports a clear failure when the log file does not exist, without throwing", async () => {
  await withTempLogFile(async (path) => {
    const monitor = new LogMonitor();
    const result = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(result.success, false);
    assert.match(result.error ?? "", /not found/);
  });
});

test("LogMonitor recovers once a previously missing file appears, without replaying its content as new", async () => {
  await withTempLogFile(async (path) => {
    const monitor = new LogMonitor();
    const missingResult = await monitor.checkTarget(buildTarget({ path }));
    assert.equal(missingResult.success, false);

    await writeFile(path, "ERROR already there when file appeared\n");
    const appearedResult = await monitor.checkTarget(buildTarget({ path }));

    assert.equal(appearedResult.success, true);
    assert.equal(appearedResult.metadata.matchCount, 0);
  });
});

test("LogMonitor keeps read state isolated between different targets", async () => {
  await withTempLogFile(async (pathA) => {
    await withTempLogFile(async (pathB) => {
      await writeFile(pathA, "");
      await writeFile(pathB, "");

      const monitor = new LogMonitor();
      await monitor.checkTarget(buildTarget({ id: "target-a", path: pathA }));
      await monitor.checkTarget(buildTarget({ id: "target-b", path: pathB }));

      await writeFile(pathA, "ERROR only in A\n");
      const resultA = await monitor.checkTarget(buildTarget({ id: "target-a", path: pathA }));
      const resultB = await monitor.checkTarget(buildTarget({ id: "target-b", path: pathB }));

      assert.equal(resultA.metadata.matchCount, 1);
      assert.equal(resultB.metadata.matchCount, 0);
    });
  });
});
