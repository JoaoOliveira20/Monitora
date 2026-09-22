import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigValidationError, parseMonitoraConfig, type MonitoraConfig, type Target } from "./schema.js";

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "config/targets.json");

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readConfigFile(configPath: string): unknown {
  let fileContents: string;
  try {
    fileContents = readFileSync(configPath, "utf-8");
  } catch (error) {
    throw new ConfigValidationError(
      `unable to read configuration file at ${configPath}: ${getErrorMessage(error)}`
    );
  }

  try {
    return JSON.parse(fileContents);
  } catch (error) {
    throw new ConfigValidationError(
      `configuration file at ${configPath} is not valid JSON: ${getErrorMessage(error)}`
    );
  }
}

function requireEnvVariable(variableName: string, targetId: string, field: string): void {
  const value = process.env[variableName];
  if (!value) {
    throw new ConfigValidationError(
      `target "${targetId}" references environment variable "${variableName}" in "${field}", but it is not set`
    );
  }
}

function validateEnabledTargetEnvironment(target: Target): void {
  requireEnvVariable(target.discordWebhookEnv, target.id, "discordWebhookEnv");

  if (target.type === "http" && target.urlEnv) {
    requireEnvVariable(target.urlEnv, target.id, "urlEnv");
  }
}

export function loadTargetsConfig(configPath: string = DEFAULT_CONFIG_PATH): MonitoraConfig {
  const raw = readConfigFile(configPath);
  const config = parseMonitoraConfig(raw);

  for (const target of config.targets) {
    if (target.enabled) {
      validateEnabledTargetEnvironment(target);
    }
  }

  return config;
}
