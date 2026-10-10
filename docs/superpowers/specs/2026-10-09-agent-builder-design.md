# Agent Builder (Part 1): Design

Date: 2026-10-09. Branch: `build-your-agent`. Part 1 of the roadmap in `docs/agents-roadmap.md`, which also
holds the decisions shared by every part. Code follows the repo's readable-code standards
(`.claude/skills/readable-code/SKILL.md`).

## Goal

A player builds AI poker agents on an n8n-style canvas, saves them to their account, and tests them on sample
hands. Every agent turn follows strict rules: the agent 
may only choose a legal action and an amount in range,
anything else is rejected and retried, and nothing is silently repaired.

## Scope

In Part 1:

- The Build Your Agent tab: agent list, canvas, node settings panel, Test drawer.
- Saving up to 10 agents per account.
- The strict-turn loop, used by the Test drawer and reused unchanged by later parts.

Not in Part 1 (later parts, see the roadmap):

- Agents playing at the Bots table (Part 2), friend tables (Part 3) or a competitive lobby (Part 4).
- Renaming "Start Match with Bots" to "Bots" (Part 2).
- More than one Prompt or Model node per agent, and multi-agent graphs (Part 5).
- Any change to how the Bots table's plain-model bots play: they keep `describe`, `parseReply` and `legalize`.

## The Build Your Agent tab

Replaces the "Coming soon" placeholder in `app/page.tsx`.

### Layout

- Left: the player's agents, with New, Rename and Delete. Selecting one loads it onto the canvas.
- Center: the canvas (`@xyflow/react` 12), with pan and zoom.
- Right: the settings panel for the selected node. On phones it becomes a bottom sheet.
- A status line under the canvas says what is missing ("Connect the Prompt to the Model") or "Ready".
- Save stores the agent; it works only when the chain is complete and every node is filled in.

### Nodes

| Node | Locked | Ports | Settings panel |
| --- | --- | --- | --- |
| Table state | Yes: always present, cannot be deleted | out | Read-only sample briefing, so the player sees what the agent receives |
| Prompt | No | out | Large text box: the agent's persona and strategy (1-4,000 characters) |
| Model | No | in, out | Provider (only providers with a saved key), model (live list from the saved key via `/api/models`), reasoning effort when the model supports it, the key in use (e.g. "OpenRouter ••••a1b2") with a link to add one, and a Check button using `/api/models/check` |
| Output | Yes: always present, cannot be deleted or edited | in | Read-only answer format |

- The player draws the wires. Only these connections are accepted: Table state → Model, Prompt → Model,
  Model → Output. Any other connection is refused as it is drawn.
- "Add node" offers Prompt and Model while the canvas has none of that kind. A new agent starts with all four
  nodes placed and unwired.
- The chain is complete when all three wires exist.

### Test drawer

- A turn-time picker with the match options (5 s, 10 s, 15 s, 30 s, 1 min, 1.5 min, 2 min, 3 min, 5 min) and
  a Run button.
- Runs one strict turn for the saved agent on a random sample hand (see below) and shows:
  - the briefing that was sent;
  - every attempt: the model's answer and whether it was accepted, or rejected with the reason;
  - the final move and the time taken, or why it ended ("Out of time after 4 attempts: fold").
- A note that each run makes real, paid calls with the player's key.
- Run is disabled, with the reason shown, when the agent has unsaved changes or the account has no key for the
  agent's provider.

## Strict turn

Pure rules live in `lib/turn-rules.ts` (no server imports, unit-tested). The loop that calls the model lives in
`lib/strict-turn.ts` (server only).

### 1. Legal options: `turnOptions(game)`

Built from the engine's existing `legal(game)`. Amounts are totals for this betting round, as in the engine.

| Spot | Options |
| --- | --- |
| Nobody has bet | check; bet (from the minimum to the maximum); all-in |
| Facing a bet | fold; call (the amount owed); raise (from the minimum to the maximum); all-in |
| Calling takes the whole stack | fold; call (all-in) |
| No raise possible (everyone else all-in) | check when nothing is owed; fold or call when owing |

- Fold is offered only when the agent owes chips.
- All-in is offered only when raising is possible; it means a raise to the maximum.
- When only one move is legal (for example, check when nobody else can act), the move is made without calling
  the model.

### 2. What is sent

- System prompt: the agent's own prompt (it replaces the built-in persona).
- User message, written by the app and not editable:
  - the table briefing: blinds, hand number, street, the agent's hole cards, the board, the pot, every player
    with stack, bet this round, folded, all-in, sitting out and dealer, and every action so far this hand in
    order with names and amounts;
  - "It is your turn to act now.";
  - the legal options with minimum and maximum amounts;
  - the required answer format.
- The table lines are shared with the Bots table's `describe()` through one extracted helper, so the Bots
  prompt text stays exactly as it is (the existing `AI prompts and replies` test guards this).

### 3. Answer format: `answerSchema(options)`

A JSON schema built per turn: `action` is an enum of only that turn's legal actions, `amount` is an integer
(for bet and raise) or null (for every other action), and `say` is table talk of at most 120 characters, which
may be an empty string. All three properties must be present and no extra properties are allowed, which
OpenAI's strict mode needs.

How each provider receives it, added to the existing calls in `lib/agents.ts`:

- Anthropic: `output_config.format = { type: "json_schema", schema }`, merged with `output_config.effort`.
- OpenAI (Responses API): `text.format = { type: "json_schema", name, schema, strict: true }`.
- OpenRouter: `response_format = { type: "json_schema", json_schema: { name, strict: true, schema } }`. Models
  that don't support it may ignore it; the checker still catches every bad answer.

Providers do not reliably enforce number ranges, so the checker alone enforces the minimum and maximum.

### 4. Checking: `checkAnswer(options, text)`

Returns the engine `Action` and table talk, or a rejection with a reason. Nothing is rounded, clamped or
converted. Rejected:

- text that isn't one JSON object, or an object with a missing `action`, `amount` or `say`, or extra fields;
- an action not in this turn's options (e.g. "check" while owing 40);
- a bet or raise without an amount, or with a fractional, negative or out-of-range amount (e.g. 20,000 with a
  maximum of 20);
- an amount sent with fold, check, call or all-in that isn't null;
- table talk that isn't a string or is longer than 120 characters.

### 5. The loop: `playStrictTurn`

Inputs: the agent, the API key, the game at the agent's turn, the turn time, an abort signal (the HTTP
request's), and the function that calls the provider (the real `askAgent`, or a fake in tests).

1. Start the clock. Build the options, the briefing and the schema.
2. Call the model with the conversation so far. Each call is cut off at the time remaining.
3. Accepted answer: done.
4. Rejected answer, or the model declined to answer: add the model's answer and a rejection message to the
   conversation, then call again. The rejection message names the problem and repeats the options and format,
   e.g. "Rejected: you chose check, but you owe 40. Your options: fold, call 40, raise to 80-1000, all-in (1000).
   Answer again in the required format."
5. Provider hiccup (HTTP 429 or 5xx, network error): wait one second, then call again.
6. Key rejected (401/403) or model not available to the key (404): stop at once with a clear message
   ("OpenRouter rejected this key", "This key can't use x-ai/grok-4.7"). The turn ends with no move. Any other
   4xx (the provider refused the request itself, e.g. a model that can't take the answer format) also stops at
   once, showing the provider's message, since retrying the same request can't help.
7. Out of time, or 20 calls made: the move is check if checking is free, otherwise fold.
8. The request was cancelled (the player closed the drawer): stop without a move.

Result: the move (or none, with the reason), the briefing, every attempt with its answer and verdict, how the
turn ended, and the time taken.

### Sample hands for the Test drawer: `sampleSpot()`

A new 5-player game with the agent in a random seat and four house-bot opponents. A target street (preflop,
flop, turn or river) is picked at random; house bots play every seat, the agent's included, until that street is
reached with the agent to act. A hand that ends first is re-dealt; after 20 re-deals the last preflop spot
where the agent acts is used.

## Data

New Prisma model `Agent` (table `agents`), with a migration:

| Field | Notes |
| --- | --- |
| `id` | UUID |
| `userId` | Owner; cascade delete with the user |
| `name` | 1-24 characters, unique per account |
| `prompt` | 1-4,000 characters |
| `provider`, `model`, `effort` | Same rules as table agents in `lib/config.ts` |
| `layout` | JSON: node positions and wires, for drawing the canvas only; at most 10 KB |
| `createdAt`, `updatedAt` | |

- At most 10 agents per account.
- The server saves `prompt`, `provider`, `model` and `effort` as checked fields and never reads meaning from
  `layout`, except to confirm the three wires of the chain exist before saving. Part 5 will move to a real
  graph format when agents get more than one chain.
- Data access goes in `lib/db.ts`, every query scoped by `userId`.

## API

All routes need a signed-in user and accept only the app's own page (`ownPageOnly`), like the existing routes.

| Route | Body | Result |
| --- | --- | --- |
| `GET /api/agents` | | Your agents: id, name, provider, model, effort, updatedAt |
| `POST /api/agents` | name, prompt, provider, model, effort, layout | The created agent |
| `GET /api/agents/[id]` | | The full agent, including prompt and layout |
| `PUT /api/agents/[id]` | Same as POST | The saved agent |
| `DELETE /api/agents/[id]` | | 204 |
| `POST /api/agents/[id]/test` | turnSeconds (one of the options) | The strict-turn result for a sample hand |

Errors: 400 with the reason for bad input (empty prompt, chain not wired, unknown provider, turn time not in the
options); 409 "You have 10 agents; delete one first." or for a duplicate name; 404 for an id that doesn't belong
to the account; 400 "Add an OpenRouter key" (per provider) when testing without a saved key.

## Files

New:

- `lib/turn-rules.ts`: `turnOptions`, `briefing`, `answerSchema`, `checkAnswer`, `sampleSpot`.
- `lib/strict-turn.ts`: `playStrictTurn`.
- `lib/built-agents.ts`: the saved-agent type, input checking (name, prompt, model, layout and chain), the
  10-agent limit.
- `app/agent-builder.tsx`: the tab (agent list, canvas, settings panel, status line, Test drawer); node
  components split into their own file if it grows past one screen of concerns.
- `app/api/agents/route.ts`, `app/api/agents/[id]/route.ts`, `app/api/agents/[id]/test/route.ts`.
- `prisma/schema.prisma` model and a migration.
- Tests: `lib/turn-rules.test.mts`, `lib/strict-turn.test.mts`, `lib/built-agents.test.mts`, and cases in
  `tests/api.test.mts`.

Changed:

- `lib/agents.ts`: calls accept a system prompt, a conversation (for retries) and an answer schema; the
  existing single-prompt calls keep working.
- `lib/poker.ts`: the table lines move into a helper shared by `describe` and `briefing`.
- `lib/config.ts`: the turn-time options as a shared constant.
- `lib/db.ts`: agent queries.
- `app/page.tsx`: the Build Your Agent tab renders the builder.
- `package.json`: `@xyflow/react`.

## Testing

- Unit (`npm test`):
  - `turnOptions` for each spot in the table above;
  - `answerSchema` lists only the legal actions;
  - `checkAnswer` accepts valid answers and rejects, with reasons, 20,000 with 20 chips, check while owing, a bet
    below the minimum, a fractional amount, an unknown action, extra fields and broken JSON;
  - `playStrictTurn` with a fake provider: stops at the first valid answer; the rejection reason is in the next
    call; stops at 20 calls; checks or folds when time runs out; stops at once on a rejected key; makes no call
    when only one move is legal;
  - agent input checks: name and prompt lengths, provider and model, the chain rule, the layout size.
- HTTP (`npm run test:api`): create, read, edit and delete scoped per account (another account gets 404), the
  10-agent limit, bad input, Test without a saved key.
- Browser (headless Chrome, desktop and phone): build an agent by drawing the wires, save, reload, run Test with
  a fake key and see the clear error.
- No real-key runs unless the player supplies keys; until then, real model behavior is unverified.

## Risks

- Real models have not played through this loop yet; prompts and format handling may need tuning once keys are
  used.
- Some OpenRouter models ignore the answer format; they rely on the checker and retries, which costs time.
- A Test run can last up to the turn time (5 minutes at most) in one request. Fine locally; hosted deploys with
  short request limits are a Part 3-4 concern.
