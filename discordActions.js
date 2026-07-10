// src/discordActions.js
//
// Every function here touches the real Discord API. Keeping this isolated
// from storage.js means: structural commands (CREATE/RENAME/DELETE on
// categories & channels) hit Discord, while data commands (SET/GET/UNSET
// on fields) hit the JSON file. The dispatcher wires both together.

const { ChannelType } = require("discord.js");

async function createCategory(guild, name) {
  const category = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
  });
  return category.id;
}

async function createChannel(guild, name, parentCategoryId) {
  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentCategoryId,
  });
  return channel.id;
}

async function renameChannel(guild, channelId, newName) {
  const channel = await guild.channels.fetch(channelId);
  if (!channel) throw new Error("Discord channel no longer exists.");
  await channel.setName(newName);
}

async function renameCategory(guild, categoryId, newName) {
  const category = await guild.channels.fetch(categoryId);
  if (!category) throw new Error("Discord category no longer exists.");
  await category.setName(newName);
}

async function deleteChannel(guild, channelId) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (channel) await channel.delete();
}

async function deleteCategory(guild, categoryId) {
  const category = await guild.channels.fetch(categoryId).catch(() => null);
  if (category) await category.delete();
}

// Posts/updates a single pinned embed in the channel showing its current
// (decrypted, non-hashed) fields. This is the "human-facing view" —
// actual reads/writes still go through storage.js, never parsed back
// out of this message.
async function syncRecordEmbed(guild, channelId, channelName, fields) {
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  const lines = Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`);
  const description = lines.length ? lines.join("\n") : "*No fields set yet.*";

  const pins = await channel.messages.fetchPinned().catch(() => null);
  const existing = pins?.find(
    (m) => m.author.id === guild.client.user.id && m.embeds.length
  );

  const embed = {
    title: `📄 ${channelName}`,
    description,
    color: 0x2b2d31,
    timestamp: new Date().toISOString(),
  };

  if (existing) {
    await existing.edit({ embeds: [embed] });
  } else {
    const msg = await channel.send({ embeds: [embed] });
    await msg.pin().catch(() => {});
  }
}

module.exports = {
  createCategory,
  createChannel,
  renameChannel,
  renameCategory,
  deleteChannel,
  deleteCategory,
  syncRecordEmbed,
};
