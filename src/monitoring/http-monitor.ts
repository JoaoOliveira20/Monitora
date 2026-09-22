import { performance } from "node:perf_hooks";

import type { HttpTarget } from "../config/schema.js";
import type { CheckResult } from "../types/index.js";

export interface HttpCheckMetadata {
  statusCode?: number;
}

export type HttpCheckResult = CheckResult<HttpCheckMetadata>;

function resolveTargetUrl(target: HttpTarget): string {
  if (target.url) {
    return target.url;
  }

  const envValue = target.urlEnv ? process.env[target.urlEnv] : undefined;
  if (!envValue) {
    throw new Error(`target "${target.id}" has no resolvable url`);
  }

  return envValue;
}

function isNodeErrorWithCause(error: unknown): error is Error & { cause?: { code?: string } } {
  return error instanceof Error;
}

function describeRequestFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "AbortError") {
    return `request timed out after ${timeoutMs}ms`;
  }

  const code = isNodeErrorWithCause(error) ? error.cause?.code : undefined;

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DNS resolution failed";
  }
  if (code === "ECONNREFUSED") {
    return "connection refused";
  }
  if (typeof code === "string" && (code.startsWith("ERR_TLS") || code.startsWith("CERT_"))) {
    return "TLS handshake failed";
  }

  return "request failed";
}

function isHealthyStatusCode(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 200 && statusCode < 400;
}

async function performRequest(
  target: HttpTarget,
  url: string
): Promise<{ statusCode?: number; failureReason?: string }> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), target.timeoutMs);

  try {
    const response = await fetch(url, {
      method: target.method,
      redirect: "manual",
      signal: controller.signal,
    });
    return { statusCode: response.status };
  } catch (error) {
    return { failureReason: describeRequestFailure(error, target.timeoutMs) };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function checkHttpTarget(target: HttpTarget): Promise<HttpCheckResult> {
  const checkedAt = new Date();
  const startedAt = performance.now();

  let url: string;
  try {
    url = resolveTargetUrl(target);
  } catch (error) {
    return {
      targetId: target.id,
      success: false,
      checkedAt,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      metadata: {},
    };
  }

  const { statusCode, failureReason } = await performRequest(target, url);
  const durationMs = Math.round(performance.now() - startedAt);

  if (failureReason) {
    return {
      targetId: target.id,
      success: false,
      checkedAt,
      durationMs,
      error: failureReason,
      metadata: {},
    };
  }

  const success = isHealthyStatusCode(statusCode);

  return {
    targetId: target.id,
    success,
    checkedAt,
    durationMs,
    error: success ? undefined : `unexpected HTTP status ${statusCode}`,
    metadata: { statusCode },
  };
}
