export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export type TargetType = "http" | "log" | "host";

export interface TargetDefaults {
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  cooldownSeconds: number;
}

interface TargetCommon {
  id: string;
  name: string;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  cooldownSeconds: number;
  discordChannelId?: string;
  discordWebhookEnv: string;
}

export interface HttpTarget extends TargetCommon {
  type: "http";
  url?: string;
  urlEnv?: string;
  method: string;
}

export interface LogTarget extends TargetCommon {
  type: "log";
  path: string;
  patterns: string[];
}

export interface HostTarget extends TargetCommon {
  type: "host";
  metricsUrl: string;
  diskMountpoint: string;
  cpuThresholdPercent?: number;
  memoryThresholdPercent?: number;
  diskThresholdPercent?: number;
}

export type Target = HttpTarget | LogTarget | HostTarget;

export interface MonitoraConfig {
  version: number;
  defaults: TargetDefaults;
  targets: Target[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): JsonRecord {
  if (!isRecord(value)) {
    throw new ConfigValidationError(`${context} must be an object`);
  }
  return value;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigValidationError(`${context} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, context);
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConfigValidationError(`${context} must be a boolean`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigValidationError(`${context} must be a positive integer`);
  }
  return value;
}

function resolvePositiveIntegerWithDefault(value: unknown, fallback: number, context: string): number {
  if (value === undefined) {
    return fallback;
  }
  return requirePositiveInteger(value, context);
}

function optionalPercentage(value: unknown, context: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || value <= 0 || value > 100) {
    throw new ConfigValidationError(`${context} must be a number greater than 0 and less than or equal to 100`);
  }
  return value;
}

function requireUrlString(value: string, context: string): string {
  try {
    new URL(value);
  } catch {
    throw new ConfigValidationError(`${context} must be a valid URL`);
  }
  return value;
}

function parseTargetDefaults(raw: unknown): TargetDefaults {
  const record = asRecord(raw, "defaults");
  return {
    intervalSeconds: requirePositiveInteger(record.intervalSeconds, "defaults.intervalSeconds"),
    timeoutMs: requirePositiveInteger(record.timeoutMs, "defaults.timeoutMs"),
    failureThreshold: requirePositiveInteger(record.failureThreshold, "defaults.failureThreshold"),
    recoveryThreshold: requirePositiveInteger(record.recoveryThreshold, "defaults.recoveryThreshold"),
    cooldownSeconds: requirePositiveInteger(record.cooldownSeconds, "defaults.cooldownSeconds"),
  };
}

function parseTargetCommon(record: JsonRecord, defaults: TargetDefaults, context: string): TargetCommon {
  return {
    id: requireString(record.id, `${context}.id`),
    name: requireString(record.name, `${context}.name`),
    enabled: requireBoolean(record.enabled, `${context}.enabled`),
    intervalSeconds: resolvePositiveIntegerWithDefault(
      record.intervalSeconds,
      defaults.intervalSeconds,
      `${context}.intervalSeconds`
    ),
    timeoutMs: resolvePositiveIntegerWithDefault(record.timeoutMs, defaults.timeoutMs, `${context}.timeoutMs`),
    failureThreshold: resolvePositiveIntegerWithDefault(
      record.failureThreshold,
      defaults.failureThreshold,
      `${context}.failureThreshold`
    ),
    recoveryThreshold: resolvePositiveIntegerWithDefault(
      record.recoveryThreshold,
      defaults.recoveryThreshold,
      `${context}.recoveryThreshold`
    ),
    cooldownSeconds: resolvePositiveIntegerWithDefault(
      record.cooldownSeconds,
      defaults.cooldownSeconds,
      `${context}.cooldownSeconds`
    ),
    discordChannelId: optionalString(record.discordChannelId, `${context}.discordChannelId`),
    discordWebhookEnv: requireString(record.discordWebhookEnv, `${context}.discordWebhookEnv`),
  };
}

function parseHttpTarget(record: JsonRecord, common: TargetCommon, context: string): HttpTarget {
  const url = optionalString(record.url, `${context}.url`);
  const urlEnv = optionalString(record.urlEnv, `${context}.urlEnv`);

  if (!url && !urlEnv) {
    throw new ConfigValidationError(`${context} must define either "url" or "urlEnv"`);
  }
  if (url && urlEnv) {
    throw new ConfigValidationError(`${context} must not define both "url" and "urlEnv"`);
  }
  if (url) {
    requireUrlString(url, `${context}.url`);
  }

  const method = optionalString(record.method, `${context}.method`) ?? "GET";

  return { ...common, type: "http", url, urlEnv, method };
}

function parseLogTarget(record: JsonRecord, common: TargetCommon, context: string): LogTarget {
  const path = requireString(record.path, `${context}.path`);
  const rawPatterns = record.patterns;

  if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) {
    throw new ConfigValidationError(`${context}.patterns must be a non-empty array of strings`);
  }
  const patterns = rawPatterns.map((pattern, index) => requireString(pattern, `${context}.patterns[${index}]`));

  return { ...common, type: "log", path, patterns };
}

function parseHostTarget(record: JsonRecord, common: TargetCommon, context: string): HostTarget {
  const metricsUrl = requireString(record.metricsUrl, `${context}.metricsUrl`);
  requireUrlString(metricsUrl, `${context}.metricsUrl`);

  const diskMountpoint = optionalString(record.diskMountpoint, `${context}.diskMountpoint`) ?? "/";

  const cpuThresholdPercent = optionalPercentage(record.cpuThresholdPercent, `${context}.cpuThresholdPercent`);
  const memoryThresholdPercent = optionalPercentage(record.memoryThresholdPercent, `${context}.memoryThresholdPercent`);
  const diskThresholdPercent = optionalPercentage(record.diskThresholdPercent, `${context}.diskThresholdPercent`);

  if (
    common.enabled &&
    cpuThresholdPercent === undefined &&
    memoryThresholdPercent === undefined &&
    diskThresholdPercent === undefined
  ) {
    throw new ConfigValidationError(
      `${context} must define at least one of "cpuThresholdPercent", "memoryThresholdPercent", or "diskThresholdPercent" when enabled`
    );
  }

  return {
    ...common,
    type: "host",
    metricsUrl,
    diskMountpoint,
    cpuThresholdPercent,
    memoryThresholdPercent,
    diskThresholdPercent,
  };
}

function parseTarget(raw: unknown, defaults: TargetDefaults, index: number): Target {
  const context = `targets[${index}]`;
  const record = asRecord(raw, context);
  const type = requireString(record.type, `${context}.type`);
  const common = parseTargetCommon(record, defaults, context);

  switch (type) {
    case "http":
      return parseHttpTarget(record, common, context);
    case "log":
      return parseLogTarget(record, common, context);
    case "host":
      return parseHostTarget(record, common, context);
    default:
      throw new ConfigValidationError(`${context}.type must be one of "http", "log", "host", got "${type}"`);
  }
}

function assertUniqueTargetIds(targets: Target[]): void {
  const seenIds = new Set<string>();
  for (const target of targets) {
    if (seenIds.has(target.id)) {
      throw new ConfigValidationError(`duplicate target id "${target.id}"`);
    }
    seenIds.add(target.id);
  }
}

export function parseMonitoraConfig(raw: unknown): MonitoraConfig {
  const record = asRecord(raw, "config");
  const version = requirePositiveInteger(record.version, "config.version");
  const defaults = parseTargetDefaults(record.defaults);

  if (!Array.isArray(record.targets)) {
    throw new ConfigValidationError("config.targets must be an array");
  }

  const targets = record.targets.map((target, index) => parseTarget(target, defaults, index));
  assertUniqueTargetIds(targets);

  return { version, defaults, targets };
}
