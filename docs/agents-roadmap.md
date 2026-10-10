# Player-Built Agents: Roadmap

Started 2026-10-09 on branch `build-your-agent`. Each player builds their own AI poker agent, then lets it play
for them at friend tables and against other players' agents in a competitive lobby. The work ships in five
parts, each with its own design, plan and code, in the order below. Each part gets its own branch; branch
`build-your-agent` holds Part 1 only (agent development).

All code for these parts follows the repo's readable-code standards (`.claude/skills/readable-code/SKILL.md`).

## Decisions that hold for every part

These come from the design conversation and apply to every part.

### Strict turns

- Every turn, the agent is told exactly what it may do: its legal actions (fold, check, call, raise/bet,
  all-in) and the minimum and maximum amount for a raise.
- The agent must answer in a fixed, structured format. Where the provider supports it, the format is enforced
  while the model writes; the server checks every answer again either way.
- Nothing is silently repaired. A move outside the legal options or an amount out of range is rejected. For
  example, with 20 chips left a raise to 20,000 is rejected, not turned into an all-in, and a check while owing
  chips is rejected, not turned into a fold. (Today `legalize()` in `lib/poker.ts` repairs such moves; the
  Bots table keeps that behavior.)
- A rejected answer is sent back to the agent with what was wrong and its legal options again. The agent keeps
  retrying until it answers correctly or its turn time runs out.
- When the turn time runs out, the agent checks if checking is free, otherwise it folds (the same rule as a
  human's turn timer).

### Turn time

- Chosen as a match setting before the match starts, with these options only:
  5 s (quick match), 10 s, 15 s, 30 s, 1 min, 1.5 min, 2 min, 3 min, 5 min.
- The default is in the 15-30 s range (today's Fast and Normal clocks); Part 3 fixes the exact default.
- One clock for every player at the table, human or agent. An agent's retries all happen inside it.

### What the agent receives

- The player's own prompt replaces the built-in persona ("You are an expert player..."). It is the agent's
  whole personality and strategy.
- The app adds, every turn, a part the player cannot edit:
  - the table briefing: every player, their stack and bet this round, folded or all-in, the dealer, the pot,
    the board, the agent's own hole cards, and every action so far this hand in order, with names and amounts
    ("Opus calls 40", "Sol raises to 120");
  - "It is your turn to act now";
  - the legal options with minimum and maximum amounts;
  - the required answer format.
- The briefing is sent when it is the agent's turn. Agents are not called on other players' turns, since each
  call costs money and has no decision to make, but every one of those moves is in the next briefing.
- On the canvas the briefing is a locked "Table state" node wired into the model. In Part 5 it becomes a
  connector the player can wire into whichever agents should receive it.

### Where agents play

- **Bots** (today's "Start Match with Bots" tab, renamed): a casual table against plain models. It asks who
  plays: "I play against agents" (you, as today) or "My agent plays against agents" (one of your saved agents
  takes your seat, under the strict-turn rules; the plain-model bots stay as they are).
- **Friend tables**: when joining, a player picks "I play" or "My agent plays".
- **Competitive lobby**: agents only. Players' agents play against each other.

## Part 1: Agent builder and strict turns

Status: built on branch `build-your-agent`, not merged. Spec: `docs/superpowers/specs/2026-10-09-agent-builder-design.md`; plan: `docs/superpowers/plans/2026-10-09-agent-builder.md`.

- The Build Your Agent tab (today a "Coming soon" placeholder) becomes a React Flow canvas (`@xyflow/react`)
  with four nodes in one chain:
  - Table state (locked, cannot be removed);
  - Prompt, where the player writes the agent's persona and strategy;
  - Model: provider, model and reasoning effort;
  - Output (locked, cannot be removed or edited): the strict answer format.
- Agents are saved to the player's account.
- The strict-turn rules above: a per-turn answer format built from the legal options, server-side checking,
  retry with feedback until valid or out of time, then check or fold.
- A "Test your agent" panel: runs the agent on a sample hand and shows the briefing, each answer, each rejection
  with its reason, and the final move.
- A cap of 20 model calls per turn, even if turn time remains, so a failing agent can't run up a bill.

## Part 2: Your agent at the Bots table

Its own branch, after Part 1.

- The Bots tab's "My agent plays against agents" option (added as "Coming soon" in commit `eb8f9f1`) goes live:
  pick a saved agent and it plays the bot table in your seat, under the strict-turn rules.
- The Bots table runs in the browser, so it sends the hand as your seat sees it to a server route that
  recomputes the legal options and runs the same strict-turn loop as Part 1.
- Rename "Start Match with Bots" to "Bots".

## Part 3: Agents at friend tables

- When joining (or hosting) a friend table, a player picks "I play" or "My agent plays".
- The host picks the turn time from the options above when creating the table, replacing the fixed 30 s
  server-side clock in `lib/tables.ts`.
- Agent turns run on the server with the agent owner's API key; the owner pays for their agent's calls.
- Friend tables advance on players' polls today. On an agent's turn, the server makes the model call and
  applies the move. A per-table lock makes sure two players' polls never both call the model.

## Part 4: Competitive lobby

- Tables where only agents play: players enter their agent, and it plays other players' agents.
- Matchmaking: how agents are grouped into tables and when a table starts.
- Agent-only tables must keep playing when nobody is watching. Today a table only moves when someone polls
  it, so this part needs a background worker on the server. The deploy and server-owned-game phases in
  `ROADMAP.md` cover the same need.

## Part 5: Multi-agent graphs

- n8n-style arrangements on the canvas: several prompts and models chained or combined, for example advisor
  agents feeding a final decision maker.
- The player wires the Table state connector into whichever agents should receive the briefing.
- The locked Output node stays the single place where the final move comes out, under the same strict rules.
- Needs its own rules for how several agents' answers become one move.
