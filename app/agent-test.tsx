"use client";

// The Test drawer of Build Your Agent: one strict turn for the saved agent on a random sample hand, with real calls.
import { useEffect, useRef, useState } from "react";
import { TURN_SECONDS } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import type { Action } from "@/lib/poker";
import type { Attempt, StrictTurnResult } from "@/lib/strict-turn";
import { Icon } from "./ui";

type AgentTestProps = {
  agentId: string | null;
  blockedReason: string | null; // why the agent can't be tested right now, if it can't
  onClose: () => void;
};

const DEFAULT_TURN_SECONDS = 30;
const MAX_SHOWN_ANSWER = 400;
const VERDICT_STYLES: Record<Attempt["verdict"], string> = {
  accepted: "bg-emerald-900/60 text-emerald-200",
  rejected: "bg-red-900/60 text-red-200",
  "provider error": "bg-amber-900/60 text-amber-200",
};

/** "5 s (quick match)", "30 s", "1.5 min"... */
function turnTimeLabel(seconds: number): string {
  if (seconds === TURN_SECONDS[0]) {
    return `${seconds} s (quick match)`;
  }
  if (seconds < 60) {
    return `${seconds} s`;
  }
  return `${seconds / 60} min`;
}

function moveLabel(move: Action | null): string {
  if (!move) {
    return "No move";
  }
  if (move.type === "raise") {
    return `Bet / raise to ${move.amount}`;
  }
  return move.type[0].toUpperCase() + move.type.slice(1);
}

export function AgentTest({ agentId, blockedReason, onClose }: AgentTestProps) {
  const [turnSeconds, setTurnSeconds] = useState(DEFAULT_TURN_SECONDS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<StrictTurnResult | null>(null);
  const [error, setError] = useState("");
  const runningRequest = useRef<AbortController | null>(null);

  // Closing the drawer stops a running test, so its calls stop costing money.
  useEffect(() => () => runningRequest.current?.abort(), []);

  const run = async () => {
    if (!agentId) {
      return;
    }
    const request = new AbortController();
    runningRequest.current = request;
    setRunning(true);
    setResult(null);
    setError("");
    try {
      const turn = await fetchJson<StrictTurnResult>(`/api/agents/${agentId}/test`, {
        method: "POST",
        signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnSeconds }),
      });
      setResult(turn);
    } catch (e) {
      if (!request.signal.aborted) {
        setError((e as Error).message);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <section aria-labelledby="agent-test-title" className="anim-rise mt-5 rounded-2xl bg-black/30 p-4 ring-1 ring-gold/30">
      <div className="flex items-center justify-between gap-3">
        <h3 id="agent-test-title" className="font-display text-xl tracking-wider text-gold">
          TEST YOUR AGENT
        </h3>
        <button type="button" aria-label="Close the test" className="rounded-lg p-1 text-cream/70 hover:text-cream" onClick={onClose}>
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-1 text-xs text-cream/60">
        Plays one turn of a random hand with your saved agent. Each run makes real, paid calls with your API key, up to 20 per turn.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          Turn time
          <select className="field" value={turnSeconds} onChange={(e) => setTurnSeconds(Number(e.target.value))}>
            {TURN_SECONDS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {turnTimeLabel(seconds)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-gold disabled:cursor-not-allowed disabled:opacity-50" disabled={running || Boolean(blockedReason)} onClick={run}>
          {running ? "PLAYING…" : "RUN TEST"}
        </button>
        {blockedReason && <span className="text-sm text-red-200">{blockedReason}</span>}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {result && <TestResult result={result} />}
    </section>
  );
}

function TestResult({ result }: { result: StrictTurnResult }) {
  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="text-base">
        <b className="font-display tracking-wide text-white">{moveLabel(result.move)}</b>
        {result.say && <span className="italic text-cream/75"> &ldquo;{result.say}&rdquo;</span>}
      </p>
      <p className="text-cream/75">
        {result.message} ({(result.ms / 1000).toFixed(1)} s)
      </p>
      <details className="rounded-lg bg-black/30 p-3">
        <summary className="cursor-pointer text-cream/80">What the agent was told</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-cream/85">{result.briefing}</pre>
      </details>
      {result.attempts.length > 0 && (
        <ol className="space-y-2">
          {result.attempts.map((attempt, index) => (
            <li key={index} className="rounded-lg bg-black/30 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-cream/60">Attempt {index + 1}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${VERDICT_STYLES[attempt.verdict]}`}>{attempt.verdict}</span>
              </div>
              {attempt.answer && <code className="mt-1 block break-all text-xs text-cream/85">{attempt.answer.slice(0, MAX_SHOWN_ANSWER)}</code>}
              {attempt.reason && <p className="mt-1 text-xs text-cream/70">{attempt.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
