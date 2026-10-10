// Server-only: one strict agent turn. The model is asked for a move in a fixed format; a rejected answer goes back
// to it with the reason, again and again, until it answers correctly, its time runs out, or it has used up its calls.
import { errorStatus, isRefusal, type ChatMessage, type ModelRequest, type ModelSettings } from "./agents.ts";
import { PROVIDERS } from "./config.ts";
import type { Action, Game } from "./poker.ts";
import { answerSchema, briefing, checkAnswer, onlyMove, rejectionMessage, timeoutMove, turnOptions, type TurnOptions } from "./turn-rules.ts";

/** A spending guard: even with time left, a turn never makes more model calls than this. */
export const MAX_CALLS_PER_TURN = 20;
const RETRY_DELAY_MS = 1000; // after a rate limit or server error
const REFUSAL_REASON = "You declined to answer, but you must choose one of your options.";

export type Attempt = { answer: string; verdict: "accepted" | "rejected" | "provider error"; reason?: string };

export type TurnEnd = "answered" | "only move" | "out of time" | "call limit" | "key rejected" | "model unavailable" | "provider refused" | "cancelled";

export type StrictTurnResult = {
  move: Action | null; // null when the turn ended without a move (a key problem, or cancelled)
  say: string;
  briefing: string;
  attempts: Attempt[];
  end: TurnEnd;
  message: string; // how the turn ended, for people
  ms: number;
};

export type StrictTurnInput = {
  agent: ModelSettings;
  prompt: string; // the agent's own persona and strategy, sent as the system prompt
  key: string;
  game: Game; // at the agent's turn
  turnMs: number;
  signal: AbortSignal; // aborted when whoever asked for the turn stops waiting
  ask: (request: ModelRequest) => Promise<string>;
  retryDelayMs?: number;
};

type Stop = { end: TurnEnd; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function playStrictTurn(input: StrictTurnInput): Promise<StrictTurnResult> {
  const startedAt = Date.now();
  const deadline = startedAt + input.turnMs;
  const options = turnOptions(input.game);
  const turnBriefing = briefing(input.game);
  const attempts: Attempt[] = [];

  const finish = (end: TurnEnd, move: Action | null, message: string, say = ""): StrictTurnResult => ({
    move,
    say,
    briefing: turnBriefing,
    attempts,
    end,
    message,
    ms: Date.now() - startedAt,
  });

  const forcedMove = onlyMove(options);
  if (forcedMove) {
    return finish("only move", forcedMove, "Only one move was legal, so the model was not asked.");
  }

  const messages: ChatMessage[] = [{ role: "user", content: turnBriefing }];
  const schema = answerSchema(options);

  while (attempts.length < MAX_CALLS_PER_TURN) {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) {
      break;
    }

    const callSignal = AbortSignal.any([input.signal, AbortSignal.timeout(timeLeft)]);
    let answer: string;
    try {
      answer = await input.ask({ agent: input.agent, key: input.key, system: input.prompt, messages, schema, signal: callSignal });
    } catch (error) {
      if (input.signal.aborted) {
        return finish("cancelled", null, "Cancelled before the agent answered.");
      }
      if (callSignal.aborted) {
        break; // cut off at the end of the turn
      }
      if (isRefusal(error)) {
        attempts.push({ answer: "", verdict: "rejected", reason: REFUSAL_REASON });
        addRejection(messages, "", REFUSAL_REASON, options);
        continue;
      }

      const reason = error instanceof Error ? error.message : String(error);
      attempts.push({ answer: "", verdict: "provider error", reason });
      const stop = stopFor(errorStatus(error), reason, input.agent);
      if (stop) {
        return finish(stop.end, null, stop.message);
      }
      await sleep(Math.min(input.retryDelayMs ?? RETRY_DELAY_MS, deadline - Date.now()));
      continue;
    }

    const verdict = checkAnswer(options, answer);
    if (verdict.ok) {
      attempts.push({ answer, verdict: "accepted" });
      return finish("answered", verdict.answer.action, `Answered on attempt ${attempts.length}.`, verdict.answer.say);
    }
    attempts.push({ answer, verdict: "rejected", reason: verdict.reason });
    addRejection(messages, answer, verdict.reason, options);
  }

  const fallback = timeoutMove(options);
  if (attempts.length >= MAX_CALLS_PER_TURN) {
    return finish("call limit", fallback, `Stopped after ${MAX_CALLS_PER_TURN} attempts: ${fallback.type}.`);
  }
  return finish("out of time", fallback, `Out of time after ${attempts.length} attempts: ${fallback.type}.`);
}

/** Continue the conversation with the model's rejected answer and what was wrong with it. */
function addRejection(messages: ChatMessage[], answer: string, reason: string, options: TurnOptions) {
  if (answer.trim()) {
    messages.push({ role: "assistant", content: answer });
  }
  messages.push({ role: "user", content: rejectionMessage(reason, options) });
}

/**
 * Provider errors that retrying can't fix end the turn at once. Rate limits (429), timeouts (408), server errors
 * (5xx) and network failures (no status) are worth another try.
 */
function stopFor(status: number | undefined, reason: string, agent: ModelSettings): Stop | null {
  const { label } = PROVIDERS[agent.provider];
  if (status === 401 || status === 403) {
    return { end: "key rejected", message: `${label} rejected this API key.` };
  }
  if (status === 404) {
    return { end: "model unavailable", message: `${label} says ${agent.model} isn't available to this key.` };
  }
  const isClientError = status !== undefined && status >= 400 && status < 500;
  if (isClientError && status !== 408 && status !== 429) {
    return { end: "provider refused", message: `${label} refused the request: ${reason}` };
  }
  return null;
}
