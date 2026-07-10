// src/schema.js
//
// Defines how each "field name" should be treated when stored.
// This is what keeps passwords one-way hashed and sensitive fields
// encrypted at rest, without you having to remember to do it per-command.
//
// - "hash"    -> bcrypt one-way hash. Never decrypted. Only ever compared (VERIFY).
// - "encrypt" -> AES-256-CBC, decrypted automatically on GET.
// - "plain"   -> stored as-is (use only for genuinely non-sensitive data).
//
// Anything not listed here defaults to "plain" (a warning is logged so you
// notice if you forgot to classify a new field).

module.exports = {
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
