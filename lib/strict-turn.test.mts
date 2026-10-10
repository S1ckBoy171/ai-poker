// Run: npm test
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ModelRequest } from "./agents.ts";
import { act, legalize, newGame, startHand, type Game } from "./poker.ts";
import { MAX_CALLS_PER_TURN, playStrictTurn, type StrictTurnInput } from "./strict-turn.ts";
import { briefing } from "./turn-rules.ts";

const CALL = '{"action":"call","amount":null,"say":"I call"}';
const CHECK = '{"action":"check","amount":null,"say":""}';

/** Heads-up, blinds 10/20: A to act, owing 10 (options: fold, call 10, raise to 40-1000, all-in). */
const facingBet = (): Game => startHand(newGame(["A", "B"], 1000, 20));

type Reply = string | Error | ((request: ModelRequest) => Promise<string>);

/** A fake provider that gives these replies in order and remembers every request. */
function scriptedAsk(...replies: Reply[]) {
  const requests: ModelRequest[] = [];
  const ask = async (request: ModelRequest): Promise<string> => {
    requests.push(structuredClone({ ...request, signal: undefined }) as unknown as ModelRequest);
    if (request.signal.aborted) {
      throw request.signal.reason;
    }
    const reply = replies[Math.min(requests.length, replies.length) - 1];
    if (reply instanceof Error) {
      throw reply;
    }
    if (typeof reply === "function") {
      return reply(request);
    }
    return reply;
  };
  return { ask, requests };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const refusal = () => Object.assign(new Error("model declined to answer"), { refused: true });

/** A reply that never comes: it waits until the call is cut off. */
const neverAnswers = (request: ModelRequest) =>
  new Promise<string>((_, fail) => request.signal.addEventListener("abort", () => fail(request.signal.reason)));

function turn(ask: StrictTurnInput["ask"], options: Partial<StrictTurnInput> = {}): Promise<Awaited<ReturnType<typeof playStrictTurn>>> {
  return playStrictTurn({
    agent: { provider: "openrouter", model: "x-ai/grok-4.7", effort: "default" },
    prompt: "You are a tight, aggressive player.",
    key: "test-key",
    game: facingBet(),
    turnMs: 10_000,
    signal: new AbortController().signal,
    ask,
    retryDelayMs: 0,
    ...options,
  });
}

describe("a strict turn", () => {
  test("a valid first answer is the move; the model got the persona, the briefing and this turn's format", async () => {
    const game = facingBet();
    const { ask, requests } = scriptedAsk(CALL);
    const result = await turn(ask, { game });

    assert.deepEqual(result.move, { type: "call" });
    assert.equal(result.say, "I call");
    assert.equal(result.end, "answered");
    assert.deepEqual(result.attempts, [{ answer: CALL, verdict: "accepted" }]);
    assert.equal(requests[0].system, "You are a tight, aggressive player.");
    assert.deepEqual(requests[0].messages, [{ role: "user", content: briefing(game) }]);
    assert.equal(result.briefing, requests[0].messages[0].content);
    const schema = requests[0].schema as { properties: { action: { enum: string[] } } };
    assert.deepEqual(schema.properties.action.enum, ["fold", "call", "raise", "all-in"]);
  });

  test("a rejected answer goes back to the model with the reason, and it tries again", async () => {
    const { ask, requests } = scriptedAsk(CHECK, CALL);
    const result = await turn(ask);

    assert.deepEqual(result.move, { type: "call" });
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.verdict),
      ["rejected", "accepted"],
    );
    const retry = requests[1].messages;
    assert.deepEqual(retry[1], { role: "assistant", content: CHECK });
    assert.equal(retry[2].role, "user");
    assert.ok(retry[2].content.includes("you owe 10"), retry[2].content);
    assert.ok(retry[2].content.includes("fold, call 10, raise to 40-1000, all-in (1000)"), retry[2].content);
  });

  test(`stops after ${MAX_CALLS_PER_TURN} calls even with time left, and folds when it owes chips`, async () => {
    const { ask, requests } = scriptedAsk(CHECK);
    const result = await turn(ask);

    assert.equal(requests.length, MAX_CALLS_PER_TURN);
    assert.equal(result.end, "call limit");
    assert.deepEqual(result.move, { type: "fold" });
  });

  test("runs out of time when the model is too slow, and folds when it owes chips", async () => {
    const { ask } = scriptedAsk(neverAnswers);
    const result = await turn(ask, { turnMs: 50 });

    assert.equal(result.end, "out of time");
    assert.deepEqual(result.move, { type: "fold" });
  });

  test("checks instead when time runs out and checking is free", async () => {
    const flop = [{ type: "call" as const }, { type: "check" as const }].reduce((game, action) => act(game, legalize(game, action)), facingBet());
    const { ask } = scriptedAsk(neverAnswers);
    const result = await turn(ask, { game: flop, turnMs: 50 });

    assert.deepEqual(result.move, { type: "check" });
  });

  test("a rejected key, a missing model or a refused request stops at once with no move", async () => {
    const cases = [
      { status: 401, end: "key rejected" },
      { status: 403, end: "key rejected" },
      { status: 404, end: "model unavailable" },
      { status: 400, end: "provider refused" },
    ];
    for (const { status, end } of cases) {
      const { ask, requests } = scriptedAsk(httpError(status));
      const result = await turn(ask);
      assert.equal(result.end, end, `HTTP ${status}`);
      assert.equal(result.move, null);
      assert.equal(requests.length, 1);
      assert.ok(result.message.length > 0);
    }
  });

  test("a provider hiccup is retried", async () => {
    for (const status of [429, 500, 503]) {
      const { ask } = scriptedAsk(httpError(status), CALL);
      const result = await turn(ask);
      assert.equal(result.end, "answered", `HTTP ${status}`);
      assert.deepEqual(
        result.attempts.map((attempt) => attempt.verdict),
        ["provider error", "accepted"],
      );
    }
  });

  test("a model that declines to answer is told so and asked again", async () => {
    const { ask, requests } = scriptedAsk(refusal(), CALL);
    const result = await turn(ask);

    assert.equal(result.end, "answered");
    assert.deepEqual(
      result.attempts.map((attempt) => attempt.verdict),
      ["rejected", "accepted"],
    );
    const lastMessage = requests[1].messages.at(-1);
    assert.equal(lastMessage?.role, "user");
    assert.ok(lastMessage?.content.includes("declined"));
  });

  test("when only one move is legal, it is made without calling the model", async () => {
    const flop = [{ type: "call" as const }, { type: "check" as const }].reduce((game, action) => act(game, legalize(game, action)), facingBet());
    const opponent = flop.players.findIndex((_, seat) => seat !== flop.turn);
    flop.players[opponent].allIn = true;
    const { ask, requests } = scriptedAsk(CALL);
    const result = await turn(ask, { game: flop });

    assert.equal(requests.length, 0);
    assert.equal(result.end, "only move");
    assert.deepEqual(result.move, { type: "check" });
  });

  test("a cancelled request ends the turn with no move", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const { ask } = scriptedAsk(CALL);
    const result = await turn(ask, { signal: cancelled.signal });

    assert.equal(result.end, "cancelled");
    assert.equal(result.move, null);
  });
});
