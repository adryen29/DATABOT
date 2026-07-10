// index.js
//
// Single-file version of the Discord DB Bot — everything (schema,
// encryption, storage, Discord actions, parser, dispatcher, and the
// bot itself) lives in this one file so there's no risk of a deploy
// missing a src/ file. Functionally identical to the multi-file version.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");

// ---------------------------------------------------------------------------
// SCHEMA — which field names get hashed, encrypted, or stored plain
// ---------------------------------------------------------------------------

const SCHEMA = {
  password: "hash",
  pass: "hash",
  pwd: "hash",

  email: "encrypt",
  bio: "encrypt",
  address: "encrypt",
  phone: "encrypt",
  note: "encrypt",
  notes: "encrypt",

  subject: "plain",
  status: "plain",
  username: "plain",
  role: "plain",
};

function fieldKind(fieldName) {
  return SCHEMA[fieldName.toLowerCase()] || "plain";
}

// ---------------------------------------------------------------------------
// CRYPTO — AES-256-CBC for "encrypt" fields
// ---------------------------------------------------------------------------

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY is missing or invalid in your .env file. " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(keyHex, "hex");
}

function encryptField(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decryptField(payload) {
  const key = getKey();
  const [ivHex, dataHex] = String(payload).split(":");
  if (!ivHex || !dataHex) return "[corrupted field]";
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    key,
    Buffer.from(ivHex, "hex")
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// STORAGE — JSON-backed database (data/db.json)
// ---------------------------------------------------------------------------

const DB_PATH = path.join(__dirname, "data", "db.json");

function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify({ categories: {} }, null, 2));
    return { categories: {} };
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return raw.trim() ? JSON.parse(raw) : { categories: {} };
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

const storage = {
  createCategory(name, discordCategoryId) {
    const db = loadDb();
    if (db.categories[name]) throw new Error(`Category "${name}" already exists.`);
    db.categories[name] = { discordCategoryId, channels: {} };
    saveDb(db);
  },

  renameCategory(oldName, newName) {
    const db = loadDb();
    if (!db.categories[oldName]) throw new Error(`Category "${oldName}" not found.`);
    if (db.categories[newName]) throw new Error(`Category "${newName}" already exists.`);
    db.categories[newName] = db.categories[oldName];
    delete db.categories[oldName];
    saveDb(db);
  },

  deleteCategory(name) {
    const db = loadDb();
    if (!db.categories[name]) throw new Error(`Category "${name}" not found.`);
    delete db.categories[name];
    saveDb(db);
  },

  listCategories() {
    return Object.keys(loadDb().categories);
  },

  getCategory(name) {
    const cat = loadDb().categories[name];
    if (!cat) throw new Error(`Category "${name}" not found.`);
    return cat;
  },

  createChannel(categoryName, channelName, discordChannelId) {
    const db = loadDb();
    const cat = db.categories[categoryName];
    if (!cat) throw new Error(`Category "${categoryName}" not found.`);
    if (cat.channels[channelName])
      throw new Error(`Channel "${channelName}" already exists in "${categoryName}".`);
    cat.channels[channelName] = { discordChannelId, fields: {} };
    saveDb(db);
  },

  renameChannel(categoryName, oldName, newName) {
    const db = loadDb();
    const cat = db.categories[categoryName];
    if (!cat) throw new Error(`Category "${categoryName}" not found.`);
    if (!cat.channels[oldName]) throw new Error(`Channel "${oldName}" not found.`);
    if (cat.channels[newName]) throw new Error(`Channel "${newName}" already exists.`);
    cat.channels[newName] = cat.channels[oldName];
    delete cat.channels[oldName];
    saveDb(db);
  },

  deleteChannel(categoryName, channelName) {
    const db = loadDb();
    const cat = db.categories[categoryName];
    if (!cat) throw new Error(`Category "${categoryName}" not found.`);
    if (!cat.channels[channelName]) throw new Error(`Channel "${channelName}" not found.`);
    delete cat.channels[channelName];
    saveDb(db);
  },

  listChannels(categoryName) {
    const cat = loadDb().categories[categoryName];
    if (!cat) throw new Error(`Category "${categoryName}" not found.`);
    return Object.keys(cat.channels);
  },

  findChannelCategory(channelName) {
    const db = loadDb();
    for (const [catName, cat] of Object.entries(db.categories)) {
      if (cat.channels[channelName]) return catName;
    }
    return null;
  },

  getChannelRecord(categoryName, channelName) {
    const cat = this.getCategory(categoryName);
    const ch = cat.channels[channelName];
    if (!ch) throw new Error(`Channel "${channelName}" not found in "${categoryName}".`);
    return ch;
  },

  async setField(categoryName, channelName, fieldName, value) {
    const db = loadDb();
    const cat = db.categories[categoryName];
    if (!cat) throw new Error(`Category "${categoryName}" not found.`);
    const ch = cat.channels[channelName];
    if (!ch) throw new Error(`Channel "${channelName}" not found.`);

    const kind = fieldKind(fieldName);
    let stored;
    if (kind === "hash") {
      stored = await bcrypt.hash(String(value), 10);
    } else if (kind === "encrypt") {
      stored = encryptField(String(value));
    } else {
      stored = String(value);
    }

    ch.fields[fieldName.toLowerCase()] = stored;
    saveDb(db);
    return kind;
  },

  getField(categoryName, channelName, fieldName) {
    const ch = this.getChannelRecord(categoryName, channelName);
    const key = fieldName.toLowerCase();
    const raw = ch.fields[key];
    if (raw === undefined) throw new Error(`Field "${fieldName}" not set.`);

    const kind = fieldKind(fieldName);
    if (kind === "hash") return "•••••••• (hashed — use VERIFY to check a value)";
    if (kind === "encrypt") return decryptField(raw);
    return raw;
  },

  getAllFields(categoryName, channelName) {
    const ch = this.getChannelRecord(categoryName, channelName);
    const result = {};
    for (const key of Object.keys(ch.fields)) {
      result[key] = this.getField(categoryName, channelName, key);
    }
    return result;
  },

  unsetField(categoryName, channelName, fieldName) {
    const db = loadDb();
    const ch = db.categories[categoryName]?.channels[channelName];
    if (!ch) throw new Error(`Channel "${channelName}" not found.`);
    delete ch.fields[fieldName.toLowerCase()];
    saveDb(db);
  },

  async verifyField(categoryName, channelName, fieldName, value) {
    const ch = this.getChannelRecord(categoryName, channelName);
    const key = fieldName.toLowerCase();
    const kind = fieldKind(fieldName);
    const raw = ch.fields[key];
    if (raw === undefined) throw new Error(`Field "${fieldName}" not set.`);
    if (kind !== "hash") throw new Error(`VERIFY only applies to hashed fields (e.g. password).`);
    return bcrypt.compare(String(value), raw);
  },
};

// ---------------------------------------------------------------------------
// DISCORD ACTIONS — real Discord API calls
// ---------------------------------------------------------------------------

const discordActions = {
  async createCategory(guild, name) {
    const category = await guild.channels.create({ name, type: ChannelType.GuildCategory });
    return category.id;
  },

  async createChannel(guild, name, parentCategoryId) {
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentCategoryId,
    });
    return channel.id;
  },

  async renameChannel(guild, channelId, newName) {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) throw new Error("Discord channel no longer exists.");
    await channel.setName(newName);
  },

  async renameCategory(guild, categoryId, newName) {
    const category = await guild.channels.fetch(categoryId);
    if (!category) throw new Error("Discord category no longer exists.");
    await category.setName(newName);
  },

  async deleteChannel(guild, channelId) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete();
  },

  async deleteCategory(guild, categoryId) {
    const category = await guild.channels.fetch(categoryId).catch(() => null);
    if (category) await category.delete();
  },

  async syncRecordEmbed(guild, channelId, channelName, fields) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const lines = Object.entries(fields).map(([k, v]) => `**${k}**: ${v}`);
    const description = lines.length ? lines.join("\n") : "*No fields set yet.*";

    const pins = await channel.messages.fetchPinned().catch(() => null);
    const existing = pins?.find((m) => m.author.id === guild.client.user.id && m.embeds.length);

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
  },
};

// ---------------------------------------------------------------------------
// PARSER — tokenizer + grammar for the command language
// ---------------------------------------------------------------------------

class ParseError extends Error {}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let buf = "";
      while (j < s.length && s[j] !== '"') { buf += s[j]; j++; }
      tokens.push({ type: "STRING", value: buf });
      i = j + 1;
      continue;
    }
    let j = i;
    let buf = "";
    while (j < s.length && !/\s/.test(s[j])) { buf += s[j]; j++; }
    tokens.push({ type: "WORD", value: buf });
    i = j;
  }
  return tokens;
}

function requireArgs(tokens, minLength, usage) {
  if (tokens.length < minLength) throw new ParseError(`Missing arguments. Usage: ${usage}`);
}

function parseCommand(input) {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new ParseError("Empty command.");
  const kw = (t) => (t ? t.value.toUpperCase() : "");
  const verb = kw(tokens[0]);

  switch (verb) {
    case "CREATE": {
      const noun = kw(tokens[1]);
      if (noun === "CATEGORY") {
        requireArgs(tokens, 3, "CREATE CATEGORY <name>");
        return { action: "CREATE_CATEGORY", name: tokens[2].value };
      }
      if (noun === "CHANNEL") {
        requireArgs(tokens, 5, "CREATE CHANNEL <name> IN <category>");
        if (kw(tokens[3]) !== "IN")
          throw new ParseError('Expected "IN" — usage: CREATE CHANNEL <name> IN <category>');
        return { action: "CREATE_CHANNEL", name: tokens[2].value, category: tokens[4].value };
      }
      throw new ParseError('Expected "CATEGORY" or "CHANNEL" after CREATE.');
    }

    case "RENAME": {
      const noun = kw(tokens[1]);
      if (noun === "CATEGORY" || noun === "CHANNEL") {
        requireArgs(tokens, 5, `RENAME ${noun} <name> TO <newName>`);
        if (kw(tokens[3]) !== "TO")
          throw new ParseError(`Expected "TO" — usage: RENAME ${noun} <name> TO <newName>`);
        return {
          action: noun === "CATEGORY" ? "RENAME_CATEGORY" : "RENAME_CHANNEL",
          name: tokens[2].value,
          newName: tokens[4].value,
        };
      }
      throw new ParseError('Expected "CATEGORY" or "CHANNEL" after RENAME.');
    }

    case "DELETE": {
      const noun = kw(tokens[1]);
      if (noun === "CATEGORY") {
        requireArgs(tokens, 3, "DELETE CATEGORY <name>");
        return { action: "DELETE_CATEGORY", name: tokens[2].value };
      }
      if (noun === "CHANNEL") {
        // DELETE CHANNEL ALL IN <category> — wipes every channel inside a
        // category (Discord + storage) but keeps the category itself.
        if (kw(tokens[2]) === "ALL") {
          requireArgs(tokens, 5, "DELETE CHANNEL ALL IN <category>");
          if (kw(tokens[3]) !== "IN")
            throw new ParseError('Expected "IN" — usage: DELETE CHANNEL ALL IN <category>');
          return { action: "CLEAR_CATEGORY", category: tokens[4].value };
        }
        requireArgs(tokens, 3, "DELETE CHANNEL <name>");
        return { action: "DELETE_CHANNEL", name: tokens[2].value };
      }
      if (noun === "FIELD") {
        requireArgs(tokens, 4, "DELETE FIELD <channel> <field>");
        return { action: "UNSET_FIELD", channel: tokens[2].value, field: tokens[3].value };
      }
      throw new ParseError('Expected "CATEGORY", "CHANNEL", or "FIELD" after DELETE.');
    }

    case "LIST": {
      const noun = kw(tokens[1]);
      if (noun === "CATEGORIES") return { action: "LIST_CATEGORIES" };
      if (noun === "CHANNELS") {
        requireArgs(tokens, 4, "LIST CHANNELS IN <category>");
        if (kw(tokens[2]) !== "IN")
          throw new ParseError('Expected "IN" — usage: LIST CHANNELS IN <category>');
        return { action: "LIST_CHANNELS", category: tokens[3].value };
      }
      throw new ParseError('Expected "CATEGORIES" or "CHANNELS" after LIST.');
    }

    case "SET": {
      requireArgs(tokens, 5, "SET <channel> <field> = <value>");
      const eqIndex = tokens.findIndex((t, idx) => idx >= 3 && t.value === "=");
      if (eqIndex === -1)
        throw new ParseError('Expected "=" — usage: SET <channel> <field> = <value>');
      const valueTokens = tokens.slice(eqIndex + 1);
      if (valueTokens.length === 0) throw new ParseError("Missing value after =.");
      return {
        action: "SET_FIELD",
        channel: tokens[1].value,
        field: tokens[2].value,
        value: valueTokens.map((t) => t.value).join(" "),
      };
    }

    case "GET": {
      requireArgs(tokens, 2, "GET <channel> [field]");
      return { action: "GET_FIELD", channel: tokens[1].value, field: tokens[2] ? tokens[2].value : null };
    }

    case "UNSET": {
      requireArgs(tokens, 3, "UNSET <channel> <field>");
      return { action: "UNSET_FIELD", channel: tokens[1].value, field: tokens[2].value };
    }

    case "VERIFY": {
      requireArgs(tokens, 4, "VERIFY <channel> <field> <value>");
      const valueTokens = tokens.slice(3);
      return {
        action: "VERIFY_FIELD",
        channel: tokens[1].value,
        field: tokens[2].value,
        value: valueTokens.map((t) => t.value).join(" "),
      };
    }

    default:
      throw new ParseError(
        `Unknown command "${tokens[0].value}". Try CREATE, RENAME, DELETE, LIST, SET, GET, UNSET, or VERIFY.`
      );
  }
}

// ---------------------------------------------------------------------------
// DISPATCHER — routes parsed commands to storage / discordActions
// ---------------------------------------------------------------------------

async function dispatch(ast, guild) {
  switch (ast.action) {
    case "CREATE_CATEGORY": {
      const id = await discordActions.createCategory(guild, ast.name);
      storage.createCategory(ast.name, id);
      return `✅ Category **${ast.name}** created.`;
    }

    case "CREATE_CHANNEL": {
      const cat = storage.getCategory(ast.category);
      const id = await discordActions.createChannel(guild, ast.name, cat.discordCategoryId);
      storage.createChannel(ast.category, ast.name, id);
      return `✅ Channel **${ast.name}** created in **${ast.category}**.`;
    }

    case "RENAME_CATEGORY": {
      const cat = storage.getCategory(ast.name);
      await discordActions.renameCategory(guild, cat.discordCategoryId, ast.newName);
      storage.renameCategory(ast.name, ast.newName);
      return `✅ Category **${ast.name}** renamed to **${ast.newName}**.`;
    }

    case "RENAME_CHANNEL": {
      const category = storage.findChannelCategory(ast.name);
      if (!category) throw new Error(`Channel "${ast.name}" not found.`);
      const record = storage.getChannelRecord(category, ast.name);
      await discordActions.renameChannel(guild, record.discordChannelId, ast.newName);
      storage.renameChannel(category, ast.name, ast.newName);
      return `✅ Channel **${ast.name}** renamed to **${ast.newName}**.`;
    }

    case "DELETE_CATEGORY": {
      const cat = storage.getCategory(ast.name);
      await discordActions.deleteCategory(guild, cat.discordCategoryId);
      storage.deleteCategory(ast.name);
      return `🗑️ Category **${ast.name}** deleted.`;
    }

    case "DELETE_CHANNEL": {
      const category = storage.findChannelCategory(ast.name);
      if (!category) throw new Error(`Channel "${ast.name}" not found.`);
      const record = storage.getChannelRecord(category, ast.name);
      await discordActions.deleteChannel(guild, record.discordChannelId);
      storage.deleteChannel(category, ast.name);
      return `🗑️ Channel **${ast.name}** deleted.`;
    }

    case "CLEAR_CATEGORY": {
      const channels = storage.listChannels(ast.category); // throws if category missing
      if (!channels.length) return `**${ast.category}** already has no channels.`;
      for (const name of channels) {
        const record = storage.getChannelRecord(ast.category, name);
        await discordActions.deleteChannel(guild, record.discordChannelId);
        storage.deleteChannel(ast.category, name);
      }
      return `🗑️ Deleted ${channels.length} channel(s) from **${ast.category}**. The category itself was kept.`;
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
      await discordActions.syncRecordEmbed(guild, record.discordChannelId, ast.channel, fields);
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
      await discordActions.syncRecordEmbed(guild, record.discordChannelId, ast.channel, fields);
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

// ---------------------------------------------------------------------------
// BOT — Discord.js client wiring it all together
// ---------------------------------------------------------------------------

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
    const ast = parseCommand(commandText);
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
