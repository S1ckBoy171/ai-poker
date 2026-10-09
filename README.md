# Agent Hold'em

No-limit Texas Hold'em against AI agents (Anthropic, OpenAI, OpenRouter). Next.js 16, Postgres, Prisma ORM 7.

```bash
docker compose up -d       # Postgres on localhost:5432
echo 'DATABASE_URL="postgresql://poker:poker@localhost:5432/poker"' > .env
npm install                # also runs prisma generate
npx prisma migrate deploy  # create tables
npm run dev                # http://localhost:3000
npm test                   # poker engine checks
```

Any Postgres works: point `DATABASE_URL` at it. After editing `prisma/schema.prisma`, run `npx prisma migrate dev --name <change>` then `npx prisma generate`.

## Setup

Open **Table settings** (sliders icon, top right):

- **Table**: 5 or 9 seats, Fast/Normal pace, starting chips, big blind, Auto Re-Buy, Auto Top-Off, play or just watch, reveal AI cards.
- **Agents & Keys**: one API key per provider, plus an optional key per seat. For each seat: name, provider, model id (free text), and reasoning effort.

Keys and settings are saved in Postgres (`settings` and `api_keys` tables, keys in plaintext). Keys never go back to the browser: the UI only sees masked hints, and `/api/agent` looks up the key for the seat on the server. Seats without a working key are played by a simple house bot, and the error shows in **Table talk**.

Every AI turn is a paid API call, so the game pauses itself when the tab goes to the background, and before a new hand after 5 minutes with no clicks or key presses (`IDLE_MS` in `app/page.tsx`).

## Layout

- `lib/poker.ts`: game engine (betting, side pots, hand evaluator), prompt and reply parsing
- `lib/config.ts`: settings shape and defaults
- `prisma/schema.prisma`, `prisma/migrations/`: database schema
- `lib/db.ts`: Prisma queries for settings and API keys
- `app/api/agent/route.ts`: calls the provider for a seat
- `app/api/settings/route.ts`: read/save settings and keys
- `app/page.tsx`, `app/settings.tsx`: table UI and settings modal
