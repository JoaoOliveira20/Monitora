import { Colors, EmbedBuilder, WebhookClient } from "discord.js";

import type { Target } from "../config/schema.js";
import { formatDuration } from "../monitoring/alert-policy.js";
import type { AlertEvent } from "../types/index.js";

export interface NotifierResult {
  success: boolean;
  error?: string;
}

function resolveWebhookUrl(target: Target): string {
  const value = process.env[target.discordWebhookEnv];
  if (!value) {
    throw new Error(
      `target "${target.id}" references environment variable "${target.discordWebhookEnv}" in "discordWebhookEnv", but it is not set`
    );
  }
  return value;
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function buildDownEmbed(event: Extract<AlertEvent, { type: "DOWN" }>): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🔴 Service DOWN")
    .setColor(Colors.Red)
    .addFields(
      { name: "Service", value: event.targetName, inline: true },
      { name: "Failures", value: String(event.metadata.consecutiveFailures), inline: true },
      { name: "Detected at", value: formatTime(event.occurredAt), inline: true }
    );

  if (event.metadata.lastError) {
    embed.addFields({ name: "Error", value: event.metadata.lastError });
  }

  return embed;
}

function buildRecoveredEmbed(event: Extract<AlertEvent, { type: "RECOVERED" }>): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🟢 Service RECOVERED")
    .setColor(Colors.Green)
    .addFields(
      { name: "Service", value: event.targetName, inline: true },
      {
        name: "Downtime",
        value: event.metadata.downtimeMs !== undefined ? formatDuration(event.metadata.downtimeMs) : "unknown",
        inline: true,
      },
      { name: "Recovered at", value: formatTime(event.occurredAt), inline: true }
    );
}

function buildLogMatchEmbed(event: Extract<AlertEvent, { type: "LOG_MATCH" }>): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("🟠 Log Pattern Matched")
    .setColor(Colors.Orange)
    .addFields(
      { name: "Service", value: event.targetName, inline: true },
      { name: "Matches", value: String(event.metadata.matchCount), inline: true },
      { name: "Detected at", value: formatTime(event.occurredAt), inline: true }
    );

  if (event.metadata.matchedPattern) {
    embed.addFields({ name: "Pattern", value: event.metadata.matchedPattern, inline: true });
  }

  if (event.metadata.matchedLine) {
    embed.addFields({ name: "Line", value: event.metadata.matchedLine });
  }

  return embed;
}

function formatPercent(value: number | undefined): string {
  return value !== undefined ? `${value.toFixed(1)}%` : "unknown";
}

function buildHostThresholdEmbed(event: Extract<AlertEvent, { type: "HOST_THRESHOLD" }>): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("🟠 Host threshold exceeded")
    .setColor(Colors.Orange)
    .addFields(
      { name: "Service", value: event.targetName, inline: true },
      { name: "CPU", value: formatPercent(event.metadata.cpuPercent), inline: true },
      { name: "Memory", value: formatPercent(event.metadata.memoryPercent), inline: true },
      { name: "Disk", value: formatPercent(event.metadata.diskPercent), inline: true },
      { name: "Detected at", value: formatTime(event.occurredAt), inline: true }
    );
}

function buildEmbed(event: AlertEvent): EmbedBuilder {
  switch (event.type) {
    case "DOWN":
      return buildDownEmbed(event);
    case "RECOVERED":
      return buildRecoveredEmbed(event);
    case "LOG_MATCH":
      return buildLogMatchEmbed(event);
    case "HOST_THRESHOLD":
      return buildHostThresholdEmbed(event);
  }
}

function describeDeliveryFailure(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    const code = "code" in error ? (error as { code?: unknown }).code : undefined;
    return `Discord API rejected the notification (status ${String(status)}${code !== undefined ? `, code ${String(code)}` : ""})`;
  }

  return "failed to deliver Discord notification";
}

export async function sendAlertToDiscord(target: Target, event: AlertEvent): Promise<NotifierResult> {
  let webhookUrl: string;
  try {
    webhookUrl = resolveWebhookUrl(target);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const client = new WebhookClient({ url: webhookUrl });

  try {
    await client.send({ embeds: [buildEmbed(event)] });
    return { success: true };
  } catch (error) {
    return { success: false, error: describeDeliveryFailure(error) };
  } finally {
    client.destroy();
  }
}
