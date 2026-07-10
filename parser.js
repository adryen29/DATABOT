// src/parser.js
//
// Tokenizes and parses the custom command language. Grammar summary
// (full docs in COMMANDS.html):
//
//   CREATE CATEGORY <name>
//   CREATE CHANNEL <name> IN <category>
//   RENAME CATEGORY <name> TO <newName>
//   RENAME CHANNEL <name> TO <newName>
//   DELETE CATEGORY <name>
//   DELETE CHANNEL <name>
//   LIST CATEGORIES
//   LIST CHANNELS IN <category>
//   SET <channel> <field> = <value...>
//   GET <channel> [field]
//   UNSET <channel> <field>
//   VERIFY <channel> <field> <value...>
//
// Values may be quoted ("like this") to include spaces; unquoted values
// take everything remaining on the line.

class ParseError extends Error {}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = "";
      while (j < s.length && s[j] !== '"') {
        buf += s[j];
        j++;
      }
      tokens.push({ type: "STRING", value: buf });
      i = j + 1;
      continue;
    }
    let j = i;
    let buf = "";
    while (j < s.length && !/\s/.test(s[j])) {
      buf += s[j];
      j++;
    }
    tokens.push({ type: "WORD", value: buf });
    i = j;
  }
  return tokens;
}

function parse(input) {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new ParseError("Empty command.");

  const kw = (t) => t.value.toUpperCase();
  const verb = kw(tokens[0]);

  switch (verb) {
    case "CREATE": {
      const noun = kw(tokens[1] || {});
      if (noun === "CATEGORY") {
        requireArgs(tokens, 3, "CREATE CATEGORY <name>");
        return { action: "CREATE_CATEGORY", name: tokens[2].value };
      }
      if (noun === "CHANNEL") {
        // CREATE CHANNEL <name> IN <category>
        requireArgs(tokens, 5, "CREATE CHANNEL <name> IN <category>");
        if (kw(tokens[3]) !== "IN")
          throw new ParseError('Expected "IN" — usage: CREATE CHANNEL <name> IN <category>');
        return {
          action: "CREATE_CHANNEL",
          name: tokens[2].value,
          category: tokens[4].value,
        };
      }
      throw new ParseError('Expected "CATEGORY" or "CHANNEL" after CREATE.');
    }

    case "RENAME": {
      const noun = kw(tokens[1] || {});
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
      const noun = kw(tokens[1] || {});
      if (noun === "CATEGORY") {
        requireArgs(tokens, 3, "DELETE CATEGORY <name>");
        return { action: "DELETE_CATEGORY", name: tokens[2].value };
      }
      if (noun === "CHANNEL") {
        requireArgs(tokens, 3, "DELETE CHANNEL <name>");
        return { action: "DELETE_CHANNEL", name: tokens[2].value };
      }
      if (noun === "FIELD") {
        // DELETE FIELD <channel> <field>  (alias for UNSET)
        requireArgs(tokens, 4, "DELETE FIELD <channel> <field>");
        return { action: "UNSET_FIELD", channel: tokens[2].value, field: tokens[3].value };
      }
      throw new ParseError('Expected "CATEGORY", "CHANNEL", or "FIELD" after DELETE.');
    }

    case "LIST": {
      const noun = kw(tokens[1] || {});
      if (noun === "CATEGORIES") {
        return { action: "LIST_CATEGORIES" };
      }
      if (noun === "CHANNELS") {
        requireArgs(tokens, 4, "LIST CHANNELS IN <category>");
        if (kw(tokens[2]) !== "IN")
          throw new ParseError('Expected "IN" — usage: LIST CHANNELS IN <category>');
        return { action: "LIST_CHANNELS", category: tokens[3].value };
      }
      throw new ParseError('Expected "CATEGORIES" or "CHANNELS" after LIST.');
    }

    case "SET": {
      // SET <channel> <field> = <value...>
      requireArgs(tokens, 5, 'SET <channel> <field> = <value>');
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
      return {
        action: "GET_FIELD",
        channel: tokens[1].value,
        field: tokens[2] ? tokens[2].value : null,
      };
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

function requireArgs(tokens, minLength, usage) {
  if (tokens.length < minLength) {
    throw new ParseError(`Missing arguments. Usage: ${usage}`);
  }
}

module.exports = { parse, tokenize, ParseError };
