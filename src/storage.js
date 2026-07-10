// src/storage.js
//
// The actual "database". Structure mirrors your mental model:
//
// {
//   categories: {
//     "Logs": {
//       discordCategoryId: "123...",
//       channels: {
//         "FirstTicket": {
//           discordChannelId: "456...",
//           fields: { subject: "plain text", email: "iv:cipher", password: "$2b$..." }
//         }
//       }
//     }
//   }
// }
//
// Reads/writes go through this file, NOT through parsing Discord message
// history — Discord channels are only ever the human-facing view.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const { encrypt, decrypt } = require("./crypto");
const schema = require("./schema");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { categories: {} };
  }
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return raw.trim() ? JSON.parse(raw) : { categories: {} };
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function fieldKind(fieldName) {
  return schema[fieldName.toLowerCase()] || "plain";
}

// ---- Categories ----

function createCategory(name, discordCategoryId) {
  const db = load();
  if (db.categories[name]) throw new Error(`Category "${name}" already exists.`);
  db.categories[name] = { discordCategoryId, channels: {} };
  save(db);
}

function renameCategory(oldName, newName) {
  const db = load();
  if (!db.categories[oldName]) throw new Error(`Category "${oldName}" not found.`);
  if (db.categories[newName]) throw new Error(`Category "${newName}" already exists.`);
  db.categories[newName] = db.categories[oldName];
  delete db.categories[oldName];
  save(db);
}

function deleteCategory(name) {
  const db = load();
  if (!db.categories[name]) throw new Error(`Category "${name}" not found.`);
  delete db.categories[name];
  save(db);
}

function listCategories() {
  const db = load();
  return Object.keys(db.categories);
}

function getCategory(name) {
  const db = load();
  const cat = db.categories[name];
  if (!cat) throw new Error(`Category "${name}" not found.`);
  return cat;
}

// ---- Channels ----

function createChannel(categoryName, channelName, discordChannelId) {
  const db = load();
  const cat = db.categories[categoryName];
  if (!cat) throw new Error(`Category "${categoryName}" not found.`);
  if (cat.channels[channelName])
    throw new Error(`Channel "${channelName}" already exists in "${categoryName}".`);
  cat.channels[channelName] = { discordChannelId, fields: {} };
  save(db);
}

function renameChannel(categoryName, oldName, newName) {
  const db = load();
  const cat = db.categories[categoryName];
  if (!cat) throw new Error(`Category "${categoryName}" not found.`);
  if (!cat.channels[oldName]) throw new Error(`Channel "${oldName}" not found.`);
  if (cat.channels[newName]) throw new Error(`Channel "${newName}" already exists.`);
  cat.channels[newName] = cat.channels[oldName];
  delete cat.channels[oldName];
  save(db);
}

function deleteChannel(categoryName, channelName) {
  const db = load();
  const cat = db.categories[categoryName];
  if (!cat) throw new Error(`Category "${categoryName}" not found.`);
  if (!cat.channels[channelName]) throw new Error(`Channel "${channelName}" not found.`);
  delete cat.channels[channelName];
  save(db);
}

function listChannels(categoryName) {
  const db = load();
  const cat = db.categories[categoryName];
  if (!cat) throw new Error(`Category "${categoryName}" not found.`);
  return Object.keys(cat.channels);
}

// Finds which category a channel lives in (so commands can refer to
// just the channel name without repeating the category every time).
function findChannelCategory(channelName) {
  const db = load();
  for (const [catName, cat] of Object.entries(db.categories)) {
    if (cat.channels[channelName]) return catName;
  }
  return null;
}

function getChannelRecord(categoryName, channelName) {
  const cat = getCategory(categoryName);
  const ch = cat.channels[channelName];
  if (!ch) throw new Error(`Channel "${channelName}" not found in "${categoryName}".`);
  return ch;
}

// ---- Fields ----

async function setField(categoryName, channelName, fieldName, value) {
  const db = load();
  const cat = db.categories[categoryName];
  if (!cat) throw new Error(`Category "${categoryName}" not found.`);
  const ch = cat.channels[channelName];
  if (!ch) throw new Error(`Channel "${channelName}" not found.`);

  const kind = fieldKind(fieldName);
  let stored;
  if (kind === "hash") {
    stored = await bcrypt.hash(String(value), 10);
  } else if (kind === "encrypt") {
    stored = encrypt(String(value));
  } else {
    stored = String(value);
  }

  ch.fields[fieldName.toLowerCase()] = stored;
  save(db);
  return kind;
}

function getField(categoryName, channelName, fieldName) {
  const ch = getChannelRecord(categoryName, channelName);
  const key = fieldName.toLowerCase();
  const raw = ch.fields[key];
  if (raw === undefined) throw new Error(`Field "${fieldName}" not set.`);

  const kind = fieldKind(fieldName);
  if (kind === "hash") {
    return "•••••••• (hashed — use VERIFY to check a value)";
  }
  if (kind === "encrypt") {
    return decrypt(raw);
  }
  return raw;
}

function getAllFields(categoryName, channelName) {
  const ch = getChannelRecord(categoryName, channelName);
  const result = {};
  for (const key of Object.keys(ch.fields)) {
    result[key] = getField(categoryName, channelName, key);
  }
  return result;
}

function unsetField(categoryName, channelName, fieldName) {
  const db = load();
  const ch = db.categories[categoryName]?.channels[channelName];
  if (!ch) throw new Error(`Channel "${channelName}" not found.`);
  delete ch.fields[fieldName.toLowerCase()];
  save(db);
}

async function verifyField(categoryName, channelName, fieldName, value) {
  const ch = getChannelRecord(categoryName, channelName);
  const key = fieldName.toLowerCase();
  const kind = fieldKind(fieldName);
  const raw = ch.fields[key];
  if (raw === undefined) throw new Error(`Field "${fieldName}" not set.`);
  if (kind !== "hash") {
    throw new Error(`VERIFY only applies to hashed fields (e.g. password).`);
  }
  return bcrypt.compare(String(value), raw);
}

module.exports = {
  createCategory,
  renameCategory,
  deleteCategory,
  listCategories,
  getCategory,
  createChannel,
  renameChannel,
  deleteChannel,
  listChannels,
  findChannelCategory,
  setField,
  getField,
  getAllFields,
  unsetField,
  verifyField,
  fieldKind,
};
