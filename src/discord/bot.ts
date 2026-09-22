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

function logConnectedGuilds(client: Client, guildIdConfigured: boolean): void {
  client.once("ready", (readyClient) => {
    const guilds = [...readyClient.guilds.cache.values()].map((guild) => `${guild.name} (${guild.id})`);
    console.log(`Discord bot ready as ${readyClient.user.tag}`);
    console.log(`Connected to ${guilds.length} guild(s): ${guilds.join(", ") || "none"}`);

    if (!guildIdConfigured) {
      console.log(
        "DISCORD_GUILD_ID is not set: /status was registered globally and can take up to 1h to appear in Discord. " +
          "Set DISCORD_GUILD_ID to one of the guild IDs above to register it instantly instead."
      );
    }
  });
}

export async function startDiscordBot(options: DiscordBotOptions): Promise<Client> {
  const rest = new REST().setToken(options.token);
  await registerSlashCommands(rest, options.clientId, options.guildId);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on("interactionCreate", (interaction) => void handleStatusInteraction(interaction, options));
  logConnectedGuilds(client, options.guildId !== undefined);

  await client.login(options.token);

  return client;
}
