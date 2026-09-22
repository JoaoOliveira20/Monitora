function isNodeErrorWithCause(error: unknown): error is Error & { cause?: { code?: string } } {
  return error instanceof Error;
}

export function describeFetchFailure(error: unknown, timeoutMs: number): string {
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
