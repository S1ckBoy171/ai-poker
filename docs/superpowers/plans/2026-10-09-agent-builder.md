# Agent Builder (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players build AI poker agents on an n8n-style canvas, save up to 10 per account, and test them on sample hands under strict turn rules.

**Architecture:** Pure turn rules (`lib/turn-rules.ts`) decide the legal options, the briefing, the per-turn answer schema and the strict check. A server loop (`lib/strict-turn.ts`) calls the model through `lib/agents.ts`, retrying with feedback until the answer is valid, time runs out, or 20 calls are made. Agents are stored in a new Prisma `Agent` model behind account-scoped routes; the builder UI is a React Flow canvas in the Build Your Agent tab.

**Tech Stack:** Next.js 16.4 (App Router), React 19.3, TypeScript strict, Prisma 7.10 + Postgres, `@xyflow/react` 12, Node's built-in test runner.

Spec: `docs/superpowers/specs/2026-10-09-agent-builder-design.md`. Execution: inline in this session (the user asked to implement now).

## Global Constraints

- Follow `.claude/skills/readable-code/SKILL.md`: descriptive names, guard clauses, no nested ternaries, one statement per line, comments for intent only, strict types (`unknown` at boundaries), focused tests.
- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md).
- Files that `npm test` loads import local modules with explicit `.ts` extensions (as `lib/match-bots.ts` does).
- Turn-time options, exactly: 5, 10, 15, 30, 60, 90, 120, 180, 300 seconds.
- At most 20 model calls per turn; at most 10 agents per account; agent name 1-24 characters, unique per account; prompt 1-4,000 characters; layout JSON at most 10 KB; table talk at most 120 characters.
- Nothing is rounded, clamped or converted when checking an answer.
- The Bots table's prompt text and behavior stay unchanged.
- Do not touch `app/match-setup.tsx` (another session owns it).
- Commit only when the user asks (session rule); each task ends with checks passing instead.

## Files

| File | Responsibility |
| --- | --- |
| `lib/config.ts` (modify) | `TURN_SECONDS`, `TurnSeconds`, `isTurnSeconds` |
| `lib/poker.ts` (modify) | `tableLines(game)` shared by `describe` and `briefing` |
| `lib/turn-rules.ts` (new) | `turnOptions`, `optionsText`, `answerSchema`, `checkAnswer`, `rejectionMessage`, `briefing`, `onlyMove`, `timeoutMove`, `sampleSpot` |
| `lib/agents.ts` (modify) | `askModel` (system + conversation + optional schema), `errorStatus`, refusal marker; `askAgent` keeps working |
| `lib/strict-turn.ts` (new) | `playStrictTurn`, `MAX_CALLS_PER_TURN` |
| `lib/built-agents.ts` (new) | saved-agent types, layout and chain rules, `checkAgentInput`, limits |
| `prisma/schema.prisma` + migration (modify/new) | `Agent` model |
| `lib/db.ts` (modify) | `listAgents`, `getAgent`, `createAgent`, `updateAgent`, `deleteAgent` |
| `app/api/agents/route.ts`, `app/api/agents/[id]/route.ts`, `app/api/agents/[id]/test/route.ts` (new) | HTTP API |
| `app/agent-builder.tsx` (new) | the tab: agent list, canvas, settings panel, status line, save |
| `app/agent-nodes.tsx` (new) | the four React Flow node components |
| `app/agent-test.tsx` (new) | Test drawer |
| `app/page.tsx` (modify) | Build Your Agent tab renders `<AgentBuilder />` |
| `app/globals.css` (modify) | canvas theme |
| Tests (new) | `lib/turn-rules.test.mts`, `lib/agents.test.mts`, `lib/strict-turn.test.mts`, `lib/built-agents.test.mts`; cases in `tests/api.test.mts` |

---

### Task 1: Turn rules

**Files:** Modify `lib/config.ts`, `lib/poker.ts`. Create `lib/turn-rules.ts`, `lib/turn-rules.test.mts`.

**Interfaces (produces):**

```ts
// lib/config.ts
export const TURN_SECONDS: readonly number[]; // [5, 10, 15, 30, 60, 90, 120, 180, 300]
export function isTurnSeconds(value: unknown): value is number;

// lib/poker.ts
export function tableLines(game: Game): string[]; // describe() = tableLines + its two closing lines, text unchanged

// lib/turn-rules.ts
export type MoveName = "fold" | "check" | "call" | "bet" | "raise" | "all-in";
export type TurnOptions = { moves: MoveName[]; callAmount: number; minTo: number; maxTo: number };
export type Answer = { action: Action; say: string };
export type Verdict = { ok: true; answer: Answer } | { ok: false; reason: string };
export function turnOptions(game: Game): TurnOptions;
export function optionsText(options: TurnOptions): string; // "fold, call 40, raise to 80-1000, all-in (1000)"
export function answerSchema(options: TurnOptions): Record<string, unknown>;
export function checkAnswer(options: TurnOptions, text: string): Verdict;
export function rejectionMessage(reason: string, options: TurnOptions): string;
export function briefing(game: Game): string;
export function onlyMove(options: TurnOptions): Action | null;
export function timeoutMove(options: TurnOptions): Action; // check if free, else fold
export function sampleSpot(agentName: string): Game;
```

Rules: owing chips → fold, call, plus raise and all-in when `legal().canRaise`; calling takes the whole stack → fold, call. Owing nothing → check, plus (when `canRaise`) "bet" if `game.currentBet === 0` else "raise", and all-in. Bet/raise amounts are totals for the round, `minTo..maxTo` from `legal()`. All-in maps to `{ type: "raise", amount: maxTo }`.

- [ ] Write `lib/turn-rules.test.mts` covering: options per spot (no bet; facing a bet; big blind option preflop = check/raise/all-in; short stack = fold/call; everyone else all-in = check or fold/call only); `optionsText` wording; schema enum equals moves; `checkAnswer` accepts a valid call, a raise at min and at max, all-in, table talk; rejects (with a reason naming the problem) 20,000 with max 20, check while owing, bet below min, fractional amount, negative amount, missing amount on raise, amount on call, unknown action, extra field, missing `say`, `say` over 120 characters, text around the JSON, broken JSON; `briefing` contains the cards, every history line, "It is your turn to act now." and the options; `onlyMove`/`timeoutMove`; `sampleSpot` always returns a game where the agent's seat is to act and the hand is running (200 runs); `describe()` output unchanged (existing poker test still passes).
- [ ] Run `npm test` → new tests fail (module missing).
- [ ] Implement `TURN_SECONDS`/`isTurnSeconds`, `tableLines` (move lines out of `describe`), and `lib/turn-rules.ts`.
- [ ] Run `npm test`, `npx --no-install tsc --noEmit`, `npm run lint` → all pass.

### Task 2: Provider calls with a conversation and an answer schema

**Files:** Modify `lib/agents.ts` (imports switch to `./config.ts`, `./poker.ts`). Create `lib/agents.test.mts`.

**Interfaces (produces):**

```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ModelSettings = Pick<Agent, "provider" | "model" | "effort">;
export type ModelRequest = { agent: ModelSettings; key: string; system: string; messages: ChatMessage[]; schema?: Record<string, unknown>; signal: AbortSignal };
export function askModel(request: ModelRequest): Promise<string>;
export function errorStatus(error: unknown): number | undefined;
export function isRefusal(error: unknown): boolean; // Claude's stop_reason "refusal"
// askAgent(call: AgentCall) unchanged for callers: it becomes askModel with system(agent.name) and one user message.
```

Schema placement: Anthropic `output_config: { format: { type: "json_schema", schema }, effort? }`; OpenAI Responses `text: { format: { type: "json_schema", name: "poker_move", schema, strict: true } }` and `input` as the message list; OpenRouter `response_format: { type: "json_schema", json_schema: { name: "poker_move", strict: true, schema } }`.

- [ ] Read the claude-api skill before editing (session rule for Anthropic SDK code).
- [ ] Write `lib/agents.test.mts` with `globalThis.fetch` stubbed: for each provider, the request carries the system prompt, every message in order, and the schema in the right field; with no schema, no format field; `errorStatus` reads HTTP errors; a Claude refusal is recognized by `isRefusal`.
- [ ] Run → fail. Implement. Run `npm test`, tsc, lint → pass; existing `/api/agent` and `/api/models/check` still compile unchanged.

### Task 3: Strict-turn loop

**Files:** Create `lib/strict-turn.ts`, `lib/strict-turn.test.mts`.

**Interfaces:**

- Consumes: Task 1 rules, Task 2 `ModelRequest`, `errorStatus`, `isRefusal`.
- Produces:

```ts
export const MAX_CALLS_PER_TURN = 20;
export type Attempt = { answer: string; verdict: "accepted" | "rejected" | "provider error"; reason?: string };
export type TurnEnd = "answered" | "only move" | "out of time" | "call limit" | "key rejected" | "model unavailable" | "provider refused" | "cancelled";
export type StrictTurnResult = { move: Action | null; say: string; briefing: string; attempts: Attempt[]; end: TurnEnd; message: string; ms: number };
export type StrictTurnInput = { agent: ModelSettings; prompt: string; key: string; game: Game; turnMs: number; signal: AbortSignal; ask: (request: ModelRequest) => Promise<string>; retryDelayMs?: number };
export function playStrictTurn(input: StrictTurnInput): Promise<StrictTurnResult>;
```

Behavior: only one legal move → no call, end "only move". Each call gets `AbortSignal.any([signal, AbortSignal.timeout(remaining)])`. Rejected answer or refusal → append the answer (assistant) and `rejectionMessage` (user), retry. 429, 5xx or no status → "provider error" attempt, wait `retryDelayMs` (default 1000, capped by time left), retry. 401/403 → "key rejected"; 404 → "model unavailable"; other 4xx → "provider refused" (stop, provider's message), move null. Request signal aborted → "cancelled", move null. Time used up → `timeoutMove`, "out of time". 20 calls → `timeoutMove`, "call limit".

- [ ] Write tests with a fake `ask`: valid first answer; invalid then valid (second request's last message contains the reason, first answer kept as assistant turn); 20 bad answers → call limit + fold; slow `ask` with `turnMs` 50 → out of time + check/fold; 401 → key rejected after 1 call; 404 → model unavailable; 429 then valid with `retryDelayMs: 0`; refusal then valid; only-move spot makes zero calls; cancelled signal → cancelled.
- [ ] Run → fail. Implement. Run `npm test`, tsc, lint → pass.

### Task 4: Saved agents (rules, database, queries)

**Files:** Create `lib/built-agents.ts`, `lib/built-agents.test.mts`. Modify `prisma/schema.prisma` (model `Agent`, `User.agents`), add migration via `npx prisma migrate dev --name agents`, modify `lib/db.ts`.

**Interfaces (produces):**

```ts
// lib/built-agents.ts
export const AGENT_LIMIT = 10;
export const MAX_AGENT_NAME = 24;
export const MAX_PROMPT_LENGTH = 4000;
export type NodeId = "table" | "prompt" | "model" | "output";
export type Wire = { from: NodeId; to: NodeId };
export type AgentLayout = { positions: Partial<Record<NodeId, { x: number; y: number }>>; wires: Wire[] };
export type AgentInput = { name: string; prompt: string; provider: Provider; model: string; effort: Effort; layout: AgentLayout };
export type SavedAgent = AgentInput & { id: string; updatedAt: string };
export type AgentSummary = Pick<SavedAgent, "id" | "name" | "provider" | "model" | "effort" | "updatedAt">;
export const REQUIRED_WIRES: Wire[]; // table→model, prompt→model, model→output
export function isAllowedWire(from: string, to: string): boolean;
export function newAgentLayout(): AgentLayout; // all four nodes placed, no wires
export function whatIsMissing(input: { prompt: string; model: string; layout: AgentLayout }): string | null; // "Connect the Prompt to the Model", ...
export function checkAgentInput(raw: unknown): { ok: true; agent: AgentInput } | { ok: false; error: string };

// lib/db.ts
export function listAgents(userId: string): Promise<AgentSummary[]>;
export function getAgent(userId: string, id: string): Promise<SavedAgent | null>;
export function createAgent(userId: string, input: AgentInput): Promise<SavedAgent | "limit" | "duplicate name">;
export function updateAgent(userId: string, id: string, input: AgentInput): Promise<SavedAgent | "not found" | "duplicate name">;
export function deleteAgent(userId: string, id: string): Promise<boolean>;
```

- [ ] Write `lib/built-agents.test.mts`: valid input passes and is trimmed; rejects empty/long name, empty/long prompt, unknown provider, bad effort, empty model, a missing node, a disallowed wire, a missing required wire (with the matching "Connect ..." message), non-number positions, layout over 10 KB; `whatIsMissing` order and messages; `isAllowedWire`.
- [ ] Run → fail. Implement `lib/built-agents.ts`. Add the Prisma model (`@@unique([userId, name])`, `@@index([userId, updatedAt])`), run the migration, add the queries (duplicate name = Prisma `P2002`; ponytail note on the count-then-create race for the limit).
- [ ] Run `npm test`, tsc, lint → pass.

### Task 5: Agents API

**Files:** Create the three route files. Modify `tests/api.test.mts` (new `describe("built agents")`).

**Interfaces:** Consumes Tasks 1-4. Responses: `GET /api/agents` → `{ agents: AgentSummary[] }`; `POST` → 201 `{ agent: SavedAgent }`; `GET/PUT /api/agents/[id]` → `{ agent }`; `DELETE` → 204; `POST /api/agents/[id]/test` body `{ turnSeconds }` → `StrictTurnResult`. Errors as in the spec (400 reason, 404, 409 limit/duplicate, 400 "Add an X key").

- [ ] Read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (or the current route-handler guide) first.
- [ ] Write HTTP tests: create → list → read → update → delete; another account gets 404 on read/update/delete/test; 11th agent → 409; duplicate name → 409; bad input → 400 with reason; test with no saved key → 400 "Add an Anthropic key"; test with bad `turnSeconds` → 400.
- [ ] Implement the routes with `ownPageOnly`.
- [ ] Run `npm run test:api` against the dev server, plus `npm test`, tsc, lint → pass.

### Task 6: Builder UI

**Files:** `npm install @xyflow/react@12.12.0`. Create `app/agent-builder.tsx`, `app/agent-nodes.tsx`, `app/agent-test.tsx`. Modify `app/page.tsx`, `app/globals.css`.

**Interfaces:** Consumes the API (Task 5), `briefing`/`sampleSpot`/`answerSchema` (Task 1) for the read-only panels, `isAllowedWire`/`whatIsMissing`/`newAgentLayout`/limits (Task 4), `/api/settings` (saved key hints), `/api/models` and `/api/models/check` (existing).

- [ ] Read the React Flow 12 API (types in `node_modules/@xyflow/react/dist`) and the Next.js CSS guide for importing `@xyflow/react/dist/style.css`.
- [ ] Build: agent list (new, rename, delete, select); canvas with the four nodes, locked Table state and Output (`deletable: false`), wires only via `isAllowedWire`, Delete removes Prompt/Model, "Add node" re-adds them; settings panel per node; status line from `whatIsMissing`; Save (POST/PUT) disabled until complete; unsaved-changes tracking; Test drawer with turn-time select, Run, result view, paid-call note, abort on close; phone layout (panel below canvas).
- [ ] Browser check with headless Chrome (desktop 1280 and phone 390): draw the three wires, save, reload and see it intact; Test with a fake key shows the clear error; no console errors.
- [ ] Run tsc, lint, `npm test` → pass.

### Task 7: Docs and final verification

**Files:** Modify `README.md` (Build Your Agent section; note the user's own uncommitted README edits and preserve them), `docs/agents-roadmap.md` (Part 1 status).

- [ ] Update docs.
- [ ] Run everything: `npm test`, `npm run lint`, `npx --no-install tsc --noEmit`, `npm run test:api`, `npm run build`.
- [ ] Report results, what was not verified (real model behavior), and ask before committing.
