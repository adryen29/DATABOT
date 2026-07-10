# Discord DB Bot

A Discord bot with a custom SQL-like command language for managing
categories/channels (structure) and storing data per-channel (accounts,
tickets, notes, leaderboard entries, etc.) with automatic password
hashing and field encryption.

## How it works

- **Structural commands** (`CREATE CATEGORY`, `CREATE CHANNEL`, `RENAME`,
  `DELETE`, `LIST`) call the real Discord API to create/rename/delete
  categories and channels.
- **Data commands** (`SET`, `GET`, `UNSET`, `VERIFY`) read and write a
  local JSON file (`data/db.json`) — never Discord message history.
  Fields classified as sensitive in `src/schema.js` are automatically
  encrypted (AES-256) or hashed (bcrypt) before being stored.
- Every channel gets a pinned embed showing its current fields, so it's
  still readable at a glance directly in Discord — but that embed is a
  *view*, not the source of truth. All actual reads/writes go through
  `data/db.json`.

See `COMMANDS.html` for the full command reference.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create a bot application at https://discord.com/developers/applications,
   enable the **Message Content Intent** under Bot settings, and copy the
   bot token.

3. Copy `.env.example` to `.env` and fill in:
   ```
   DISCORD_TOKEN=<your bot token>
   ENCRYPTION_KEY=<output of: openssl rand -hex 32>
   ```
   **Back up `ENCRYPTION_KEY` somewhere safe and offline.** If you lose it,
   every encrypted field (email, bio, etc.) becomes permanently unreadable.
   Never commit `.env` to git — it's already in `.gitignore`.

4. Invite the bot to your server with the `bot` scope and at least these
   permissions: Manage Channels, Send Messages, Embed Links, Manage
   Messages (for pinning), Read Message History.

5. Run it:
   ```
   node index.js
   ```

## Security notes

- Only server members with **Administrator** permission can run bot
  commands (checked in `index.js`) — change this in `index.js` if you
  want a different permission model.
- Passwords are hashed with bcrypt and are never retrievable — only
  `VERIFY` can confirm whether a given value matches.
- Other sensitive fields (email, bio, etc.) are encrypted at rest and
  decrypted automatically on `GET`. Add/remove field names in
  `src/schema.js` to control what gets encrypted vs. stored plainly.
- `data/db.json` is still a local file — if you deploy this (e.g. on
  Render, like your other bots), make sure the disk isn't publicly
  exposed, and take regular backups since it's your only source of truth.

## Extending

- Add new field types by editing `src/schema.js`.
- Add new commands by extending the grammar in `src/parser.js` and
  adding a matching case in `src/dispatcher.js`.
- For a leaderboard use case: create one category (e.g. `Leaderboard`)
  and one channel per player, or just store `score` as a plain field per
  channel and write a small `LIST CHANNELS IN Leaderboard` + loop that
  reads each `score` field to render a sorted embed — happy to build that
  command directly (e.g. `TOP Leaderboard score 10`) if useful.
