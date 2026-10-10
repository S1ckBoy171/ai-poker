# Agent Hold'em

No-limit Texas Hold'em against AI agents (Anthropic, OpenAI, OpenRouter) or with friends. Next.js 16, Postgres, Prisma ORM 7.

```bash
docker compose up -d       # Postgres on localhost:5432
cp .env.example .env       # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm install                # also runs prisma generate
npx prisma migrate deploy  # create tables
npm run dev                # http://localhost:3000
npm test                   # poker engine checks
```

Everything needs an account (see Accounts). The server listens on 127.0.0.1 only, and the API routes that spend your keys or change settings also accept requests only from the app's own page.

Any Postgres works: point `DATABASE_URL` at it. After editing `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>` then `npx prisma generate`.

## Accounts

Login uses [Better Auth](https://better-auth.com) with two kinds of account, on `/login`:

- **Hash ID**: pick any ID and password, even ones other people use. The server makes a random 32-character hash for the account and your browser downloads a `.txt` file with the ID, password and hash. Signing in takes all three (or load the file). The hash is stored as the account's email, `<hash>@hash.invalid`.
- **Email**: email and a password of 8+ characters.

Limits on account creation: a Cloudflare Turnstile CAPTCHA (`.env.example` ships Cloudflare's always-pass test keys; use your own before going online), 3 sign-ups per minute per address and 10 sign-ins, and at most `HASH_ACCOUNTS_PER_HOUR` (default 30) new hash accounts per hour for the whole server. You can't choose a hash, and a wrong ID, password or hash gives the same error.

Bot-match settings, API keys and hand history belong to one account each: nobody else's bots can spend your keys. Pages redirect to `/login` without a session (`proxy.ts`), and every API route checks the session itself.

## Home page

- **Build Your Agent**: build up to 10 agents on an n8n-style canvas (React Flow): a locked Table state node and your Prompt wired into a Model, which feeds a locked Output node. Test runs one strict turn on a random sample hand with your saved key. Design: `docs/superpowers/specs/2026-10-09-agent-builder-design.md`; roadmap: `docs/agents-roadmap.md`.
- **Start Match with Bots**: paste one API key, click **Check models** to list the models that key can use (up to the newest 100), pick a model per bot or one for all, then **Start match**. The provider is detected from the key (`sk-ant-`, `sk-or-`, `sk-`). This saves the key, clears per-seat keys, and opens the table at `/play`.
- **Play with Friends**: humans only. Create a table (you host and deal) or join one with its code. Each table has a random 8-character code and an invite link, `/t/<code>`.

## Bot matches (`/play`)

**Table settings** (sliders icon) has the table options (5 or 9 seats, pace, chips, blinds, Auto Re-Buy, Auto Top-Off, play or watch, reveal AI cards) and per-seat agents (name, provider, model, reasoning effort, optional own key).

Keys and settings are saved in Postgres (`settings` and `api_keys` tables, keys in plaintext). Keys never go back to the browser: the UI only sees masked hints, and `/api/agent` looks up the key for the seat on the server. Seats without a working key are played by a simple house bot, and the error shows in **Table talk**.

Every AI turn is a paid API call, so the game pauses itself when the tab goes to the background, when your turn timer runs out, and before a new hand after 5 minutes with no clicks or key presses (`IDLE_MS` in `app/play/page.tsx`).

## Friend tables (`/t/<code>`)

The server owns the game (`tables` table). Each player gets a secret token, kept in their browser, and only ever receives their own hole cards; everyone's shown cards appear at showdown. Players poll the table every second. A turn times out after 30 seconds (check, or fold when you owe chips), and the next hand deals itself 5 seconds after the last one. Up to 9 players; late joiners play from the next hand; busted players can rebuy.

To play with friends on other devices, the server must be reachable by them:

```bash
npm run build
npm run friends   # listens on all interfaces; friends open http://<your-ip>:3000/t/<code>
```

`npm run friends` sets `FRIENDS_ONLY=1`, which switches off bot matches, model lookups and settings. Friends need an account too (a hash account takes seconds). Before putting it on the internet, see `ROADMAP.md`.

## Layout

- `lib/poker.ts`: game engine (betting, side pots, hand evaluator, per-player views), prompt and reply parsing
- `lib/config.ts`: bot-match settings shape and defaults
- `lib/turn-rules.ts`, `lib/strict-turn.ts`: strict turns for built agents (legal options, briefing, answer schema, the check, retry with the reason until valid, out of time or 20 calls)
- `lib/agents.ts`: provider calls (Anthropic, OpenAI, OpenRouter) with a conversation and an optional answer schema
- `lib/built-agents.ts`: saved-agent rules (names, prompts, canvas layout, the chain)
- `lib/tables.ts`: friend tables (create, join, deal, act, timeouts), stored with an optimistic version lock
- `lib/db.ts`, `prisma/`: Prisma client, schema and migrations
- `lib/auth.ts`, `lib/auth-client.ts`, `lib/hash-accounts.ts`, `proxy.ts`: Better Auth setup, hash-account rules, the login redirect
- `lib/guard.ts`: session check for every API route; plus same-origin and friends-mode checks for routes that touch API keys
- `lib/sound.ts`: table sounds, synthesized with Web Audio
- `app/page.tsx`: home page with the three tabs; `app/login/page.tsx` and `app/turnstile.tsx`: sign in, create account, CAPTCHA
- `app/play/page.tsx`: bot match; `app/t/[code]/`: friend table
- `app/table.tsx`: the shared table UI (seats, chip animations, action bar with timer and F/C/R keys, stats, log, sounds)
- `app/settings.tsx`, `app/ui.tsx`: bot-match settings modal; shared cards and icons
- `app/history/page.tsx`: hand history of bot matches
- `app/agent-builder.tsx`, `app/agent-nodes.tsx`, `app/agent-panels.tsx`, `app/agent-test.tsx`: Build Your Agent (canvas, nodes, settings panel, Test)
- `app/api/`: `agent` (calls a provider), `agents` (built agents and their Test), `models` (lists a key's models), `settings`, `hands`, `tables`
