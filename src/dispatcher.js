// src/dispatcher.js
//
// Takes a parsed AST (from parser.js) plus the Discord guild, and
// executes it: structural actions hit discordActions.js, field
// actions hit storage.js. Returns a plain string (or embed-ready
// object) for the bot to reply with.

const storage = require("./storage");
const discord = require("./discordActions");

async function dispatch(ast, guild) {
  switch (ast.action) {
    case "CREATE_CATEGORY": {
      const id = await discord.createCategory(guild, ast.name);
      storage.createCategory(ast.name, id);
      return `✅ Category **${ast.name}** created.`;
    }

    case "CREATE_CHANNEL": {
      const cat = storage.getCategory(ast.category); // throws if missing
      const id = await discord.createChannel(guild, ast.name, cat.discordCategoryId);
      storage.createChannel(ast.category, ast.name, id);
      return `✅ Channel **${ast.name}** created in **${ast.category}**.`;
    }

    case "RENAME_CATEGORY": {
      const cat = storage.getCategory(ast.name);
      await discord.renameCategory(guild, cat.discordCategoryId, ast.newName);
      storage.renameCategory(ast.name, ast.newName);
      return `✅ Category **${ast.name}** renamed to **${ast.newName}**.`;
    }

    case "RENAME_CHANNEL": {
      const category = storage.findChannelCategory(ast.name);
      if (!category) throw new Error(`Channel "${ast.name}" not found.`);
      const record = storage.getChannelRecord(category, ast.name);
      await discord.renameChannel(guild, record.discordChannelId, ast.newName);
      storage.renameChannel(category, ast.name, ast.newName);
      return `✅ Channel **${ast.name}** renamed to **${ast.newName}**.`;
    }

    case "DELETE_CATEGORY": {
      const cat = storage.getCategory(ast.name);
      await discord.deleteCategory(guild, cat.discordCategoryId);
      storage.deleteCategory(ast.name);
      return `🗑️ Category **${ast.name}** deleted.`;
    }

    case "DELETE_CHANNEL": {
      const category = storage.findChannelCategory(ast.name);
      if (!category) throw new Error(`Channel "${ast.name}" not found.`);
      const record = storage.getChannelRecord(category, ast.name);
      await discord.deleteChannel(guild, record.discordChannelId);
      storage.deleteChannel(category, ast.name);
      return `🗑️ Channel **${ast.name}** deleted.`;
    }

    case "LIST_CATEGORIES": {
      const cats = storage.listCategories();
      if (!cats.length) return "No categories yet.";
      return `📂 Categories:\n${cats.map((c) => `• ${c}`).join("\n")}`;
    }

    case "LIST_CHANNELS": {
      const chans = storage.listChannels(ast.category);
      if (!chans.length) return `No channels in **${ast.category}** yet.`;
      return `📄 Channels in **${ast.category}**:\n${chans.map((c) => `• ${c}`).join("\n")}`;
    }

    case "SET_FIELD": {
      const category = storage.findChannelCategory(ast.channel);
      if (!category) throw new Error(`Channel "${ast.channel}" not found.`);
      const kind = await storage.setField(category, ast.channel, ast.field, ast.value);
      const record = storage.getChannelRecord(category, ast.channel);
      const fields = storage.getAllFields(category, ast.channel);
      await discord.syncRecordEmbed(guild, record.discordChannelId, ast.channel, fields);
      const note = kind === "hash" ? " (hashed)" : kind === "encrypt" ? " (encrypted)" : "";
      return `✅ **${ast.field}** set on **${ast.channel}**${note}.`;
    }

    case "GET_FIELD": {
      const category = storage.findChannelCategory(ast.channel);
      if (!category) throw new Error(`Channel "${ast.channel}" not found.`);
      if (ast.field) {
        const value = storage.getField(category, ast.channel, ast.field);
        return `📄 **${ast.field}**: ${value}`;
      }
      const fields = storage.getAllFields(category, ast.channel);
      const keys = Object.keys(fields);
      if (!keys.length) return `No fields set on **${ast.channel}**.`;
      return `📄 **${ast.channel}**:\n${keys.map((k) => `• **${k}**: ${fields[k]}`).join("\n")}`;
    }

    case "UNSET_FIELD": {
      const category = storage.findChannelCategory(ast.channel);
      if (!category) throw new Error(`Channel "${ast.channel}" not found.`);
      storage.unsetField(category, ast.channel, ast.field);
      const record = storage.getChannelRecord(category, ast.channel);
      const fields = storage.getAllFields(category, ast.channel);
      await discord.syncRecordEmbed(guild, record.discordChannelId, ast.channel, fields);
      return `🗑️ **${ast.field}** removed from **${ast.channel}**.`;
    }

    case "VERIFY_FIELD": {
      const category = storage.findChannelCategory(ast.channel);
      if (!category) throw new Error(`Channel "${ast.channel}" not found.`);
      const ok = await storage.verifyField(category, ast.channel, ast.field, ast.value);
      return ok ? `✅ Match.` : `❌ No match.`;
    }

    default:
      throw new Error(`Unhandled action "${ast.action}".`);
  }
}

module.exports = { dispatch };
