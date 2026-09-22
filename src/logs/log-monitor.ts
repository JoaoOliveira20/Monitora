import { open, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import type { LogTarget } from "../config/schema.js";
import type { CheckResult, LogCheckMetadata } from "../types/index.js";

export type LogCheckResult = CheckResult<LogCheckMetadata>;

interface LogReadState {
  offset: number;
  inode: number;
}

const MAX_MATCHED_LINE_LENGTH = 500;
const NEWLINE_BYTE = 0x0a;

function truncateLine(line: string): string {
  if (line.length <= MAX_MATCHED_LINE_LENGTH) {
    return line;
  }
  return `${line.slice(0, MAX_MATCHED_LINE_LENGTH)}…`;
}

function findMatch(line: string, patterns: string[]): string | undefined {
  return patterns.find((pattern) => line.includes(pattern));
}

function describeFileError(error: unknown): string {
  const code = error instanceof Error && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;

  if (code === "ENOENT") {
    return "log file not found";
  }
  if (code === "EACCES" || code === "EPERM") {
    return "permission denied reading log file";
  }
  return "failed to read log file";
}

async function readNewLines(path: string, start: number, end: number): Promise<{ lines: string[]; bytesRead: number }> {
  const handle = await open(path, "r");
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    const lastNewlineByteIndex = buffer.lastIndexOf(NEWLINE_BYTE);
    if (lastNewlineByteIndex === -1) {
      return { lines: [], bytesRead: 0 };
    }

    const completeBuffer = buffer.subarray(0, lastNewlineByteIndex);
    const lines = completeBuffer
      .toString("utf-8")
      .split("\n")
      .map((line) => line.replace(/\r$/, ""))
      .filter((line) => line.length > 0);

    return { lines, bytesRead: lastNewlineByteIndex + 1 };
  } finally {
    await handle.close();
  }
}

export class LogMonitor {
  private readonly state = new Map<string, LogReadState>();

  async checkTarget(target: LogTarget): Promise<LogCheckResult> {
    const checkedAt = new Date();
    const startedAt = performance.now();

    const buildResult = (success: boolean, error: string | undefined, metadata: LogCheckMetadata): LogCheckResult => ({
      targetId: target.id,
      success,
      checkedAt,
      durationMs: Math.round(performance.now() - startedAt),
      error,
      metadata,
    });

    let stats;
    try {
      stats = await stat(target.path);
    } catch (error) {
      this.state.delete(target.id);
      return buildResult(false, describeFileError(error), { matchCount: 0 });
    }

    const previous = this.state.get(target.id);

    if (previous === undefined) {
      this.state.set(target.id, { offset: stats.size, inode: stats.ino });
      return buildResult(true, undefined, { matchCount: 0 });
    }

    const rotatedOrRecreated = previous.inode !== stats.ino;
    const truncated = stats.size < previous.offset;
    const startOffset = rotatedOrRecreated || truncated ? 0 : previous.offset;

    if (stats.size <= startOffset) {
      this.state.set(target.id, { offset: startOffset, inode: stats.ino });
      return buildResult(true, undefined, { matchCount: 0 });
    }

    let readResult;
    try {
      readResult = await readNewLines(target.path, startOffset, stats.size);
    } catch (error) {
      return buildResult(false, describeFileError(error), { matchCount: 0 });
    }

    this.state.set(target.id, { offset: startOffset + readResult.bytesRead, inode: stats.ino });

    const matches = readResult.lines
      .map((line) => ({ line, pattern: findMatch(line, target.patterns) }))
      .filter((entry): entry is { line: string; pattern: string } => entry.pattern !== undefined);

    if (matches.length === 0) {
      return buildResult(true, undefined, { matchCount: 0 });
    }

    const [firstMatch] = matches;
    return buildResult(false, `pattern "${firstMatch.pattern}" matched ${matches.length} new line(s)`, {
      matchedPattern: firstMatch.pattern,
      matchedLine: truncateLine(firstMatch.line),
      matchCount: matches.length,
    });
  }
}
