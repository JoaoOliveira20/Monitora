import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, type Interaction } from "discord.js";

import { buildStatusResponse } from "../commands/status.js";
import type { Target } from "../config/schema.js";
import type { StateStore } from "../monitoring/state-store.js";

export interface DiscordBotOptions {
  token: string;
  clientId: string;
  guildId?: string;
  monitorName: string;
  targets: Target[];
  stateStore: StateStore;
}

const STATUS_COMMAND = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show the current known status of every monitored target")
  .toJSON();

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function registerSlashCommands(rest: REST, clientId: string, guildId: string | undefined): Promise<void> {
  const route = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  await rest.put(route, { body: [STATUS_COMMAND] });
}

async function handleStatusInteraction(interaction: Interaction, options: DiscordBotOptions): Promise<void> {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "status") {
    return;
  }

  try {
    const response = buildStatusResponse(options.monitorName, options.targets, options.stateStore);
    await interaction.reply({ content: response });
  } catch (error) {
    console.error(`failed to handle /status interaction: ${getErrorMessage(error)}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong while checking status.", ephemeral: true }).catch(() => {});
    }
  }
}

export async function startDiscordBot(options: DiscordBotOptions): Promise<Client> {
  const rest = new REST().setToken(options.token);
  await registerSlashCommands(rest, options.clientId, options.guildId);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on("interactionCreate", (interaction) => void handleStatusInteraction(interaction, options));

  await client.login(options.token);

  return client;
}
