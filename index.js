// index.js
require("dotenv").config();
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { parse, ParseError } = require("./src/parser");
const { dispatch } = require("./src/dispatcher");

const PREFIX = process.env.PREFIX || "!db";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Command prefix: ${PREFIX}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  if (!message.guild) return;

  // Restrict usage to server admins by default — this bot can create,
  // rename, and delete channels/categories, and store sensitive data.
  if (!message.member.permissions.has("Administrator")) {
    await message.reply("⛔ You need Administrator permission to use this bot.");
    return;
  }

  const commandText = message.content.slice(PREFIX.length).trim();
  if (!commandText) {
    await message.reply(`Usage: \`${PREFIX} <command>\`. See COMMANDS.html for the full list.`);
    return;
  }

  try {
    const ast = parse(commandText);
    const result = await dispatch(ast, message.guild);
    await message.reply(result);
  } catch (err) {
    if (err instanceof ParseError) {
      await message.reply(`⚠️ ${err.message}`);
    } else {
      console.error(err);
      await message.reply(`❌ ${err.message}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
