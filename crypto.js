// src/crypto.js
//
// AES-256-CBC helpers for fields classified as "encrypt" in schema.js.
// Key comes from process.env.ENCRYPTION_KEY, generated once via:
//   openssl rand -hex 32
// and stored in your .env file (never committed to git).

const crypto = require("crypto");

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

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(text), "utf8"),
    cipher.final(),
  ]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(payload) {
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

module.exports = { encrypt, decrypt };
