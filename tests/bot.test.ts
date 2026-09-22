import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { REST, Routes } from "discord.js";

import { registerSlashCommands } from "../src/discord/bot.js";

test("registerSlashCommands registers the status command in a specific guild when guildId is set", async () => {
  const rest = new REST().setToken("fake-token");
  const putMock = mock.method(rest, "put", async () => []);

  try {
    await registerSlashCommands(rest, "client-123", "guild-456");

    assert.equal(putMock.mock.calls.length, 1);
    const [route, options] = putMock.mock.calls[0].arguments;
    assert.equal(route, Routes.applicationGuildCommands("client-123", "guild-456"));
    assert.equal((options as { body: { name: string }[] }).body[0].name, "status");
  } finally {
    mock.restoreAll();
  }
});

test("registerSlashCommands registers the status command globally when guildId is not set", async () => {
  const rest = new REST().setToken("fake-token");
  const putMock = mock.method(rest, "put", async () => []);

  try {
    await registerSlashCommands(rest, "client-123", undefined);

    const [route] = putMock.mock.calls[0].arguments;
    assert.equal(route, Routes.applicationCommands("client-123"));
  } finally {
    mock.restoreAll();
  }
});
