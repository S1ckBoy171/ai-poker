"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PROVIDERS, type Config } from "@/lib/config";
import { fetchJson } from "@/lib/fetch-json";
import {
  act,
  describe,
  handRecord,
  houseBot,
  legalize,
  newGame,
  parseReply,
  playersWithChips,
  startHand,
  type Action,
  type AgentReply,
  type Game,
} from "@/lib/poker";
import { play } from "@/lib/sound";
import type { SettingsResponse } from "../api/settings/route";
import { SettingsModal, type KeyEdits } from "../settings";
import { ActionBar, HeaderButton, LogPanel, StatsPanel, TableHeader, TableView, useMuted, useTableSounds, yourTurnLine, type LogEntry } from "../table";
import { Icon } from "../ui";

type Entry = LogEntry & { hand: number; seat?: number };
type Decision = AgentReply & { error?: string };
/** Who just acted, and what came with it, for the table log. */
type TurnNote = { seat?: number; say?: string; error?: string };

const IDLE_MS = 5 * 60_000; // no clicks/keys for this long = nobody is watching, stop paying for AI turns
const TURN_MS = { fast: 15_000, normal: 30_000 }; // your time to act before an automatic check (or fold)
const NEXT_HAND_MS = { fast: 3000, normal: 5500 }; // the result stays up this long
const MIN_AI_TURN_MS = { fast: 400, normal: 1200 }; // even instant answers take this long, so the table is readable
const LOG_LIMIT = 200;
const YOUR_COLOR = "#e8c27a";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isHuman = (config: Config, seat: number) => config.playing && seat === 0;

/** Names at the table; you are "Human", because "You" would read as the AI itself in its prompts. */
const seatNames = (config: Config) => Array.from({ length: config.seats }, (_, seat) => (isHuman(config, seat) ? "Human" : config.agents[seat].name));

/** The settings that need a new game when they change. */
const tableShape = (config: Config) => [config.seats, config.stack, config.bb, config.playing].join("|");

const freshGame = (config: Config) => startHand(newGame(seatNames(config), config.stack, config.bb));

const isGameOver = (game: Game, config: Config) => game.street === "done" && !config.rebuy && playersWithChips(game) < 2;

/** Deal the next hand, first applying renamed seats and the auto rebuy / top-off settings. */
function dealNextHand(game: Game, config: Config): Game {
  const next = structuredClone(game);
  const names = seatNames(config);
  next.players.forEach((player, seat) => {
    player.name = names[seat];
    if (player.stack === 0 && config.rebuy) {
      player.rebuys++;
      player.buyIn += config.stack;
      player.stack = config.stack;
    } else if (player.stack > 0 && config.topOff && player.stack < config.stack) {
      player.buyIn += config.stack - player.stack;
      player.stack = config.stack;
    }
  });
  return startHand(next);
}

/** Append the history lines `next` added on top of `previous` (plus who said what) to the table log. */
function appendToLog(log: Entry[], previous: Game | null, next: Game, turn: TurnNote): Entry[] {
  let id = log.at(-1)?.id ?? 0;
  const added: Entry[] = [];
  const newHand = !previous || previous.hand !== next.hand;
  if (newHand) {
    added.push({ id: ++id, hand: next.hand, text: `Hand #${next.hand}`, kind: "hand" });
  }
  // The same failure on every turn of a seat is logged once.
  const lastErrorForSeat = log.findLast((entry) => entry.kind === "error" && entry.seat === turn.seat)?.text;
  if (turn.error && lastErrorForSeat !== turn.error) {
    added.push({ id: ++id, hand: next.hand, seat: turn.seat, text: turn.error, kind: "error" });
  }
  const newLines = next.history.slice(newHand ? 0 : previous.history.length);
  newLines.forEach((text, k) => {
    const entry: Entry = { id: ++id, hand: next.hand, text };
    if (k === 0) {
      entry.seat = turn.seat; // the first new line is the action that seat just took
      entry.say = turn.say;
    }
    added.push(entry);
  });
  return [...log, ...added].slice(-LOG_LIMIT);
}

/** Ask the seat's AI for its move; if that fails, the house bot moves for it (unless the request was cancelled). */
async function decide(game: Game, signal: AbortSignal): Promise<Decision> {
  try {
    const { text } = await fetchJson<{ text: string }>("/api/agent", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seat: game.turn, prompt: describe(game) }),
    });
    const reply = parseReply(text);
    if (!reply) {
      throw new Error(`unreadable reply "${String(text).slice(0, 60)}"`);
    }
    return reply;
  } catch (e) {
    if (signal.aborted) {
      throw e;
    }
    const name = game.players[game.turn].name;
    return { action: houseBot(game), error: `${name}: ${(e as Error).message} - house bot is playing for them.` };
  }
}

function saveFinishedHand(game: Game, config: Config) {
  fetch("/api/hands", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: game.id, hand: handRecord(game, config.playing ? 0 : -1) }),
  }).catch(() => {}); // history is best-effort; the game goes on
}

export default function PlayPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [game, setGame] = useState<Game | null>(null);
  const [turnAt, setTurnAt] = useState(0); // when the current turn started
  const [now, setNow] = useState(0);
  const [log, setLog] = useState<Entry[]>([]);
  const [paused, setPaused] = useState<string | null>(null); // why the game is paused ("" = by hand), null = running
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [muted, toggleMute] = useMuted();
  const [loadError, setLoadError] = useState("");
  const lastActive = useRef(0);

  /** Every game change goes through here: table log, turn clock, and saving finished hands. */
  const commit = (previous: Game | null, next: Game, turn: TurnNote = {}) => {
    setGame(next);
    setTurnAt(Date.now());
    setLog((current) => appendToLog(current, previous, next, turn));
    const handJustFinished = previous !== null && previous.hand === next.hand && previous.street !== "done" && next.street === "done";
    if (cfg && handJustFinished) {
      saveFinishedHand(next, cfg);
    }
  };
  const restart = (config: Config) => {
    setLog([]);
    commit(null, freshGame(config));
  };
  const resume = () => {
    setPaused(null);
    setTurnAt(Date.now()); // the clock restarts for whoever is to act
  };
  const humanAct = (action: Action) => {
    if (game) {
      commit(game, act(game, legalize(game, action)), { seat: 0 });
    }
  };

  const commitFromEffect = useEffectEvent(commit);
  // Out of time = you're away: check (legalize makes it a fold when you owe chips), then stop the AIs, whose turns cost money, until you resume.
  const timeUp = useEffectEvent(() => {
    humanAct({ type: "check" });
    setPaused("You ran out of time");
  });

  useEffect(() => {
    fetchJson<SettingsResponse>("/api/settings")
      .then(({ config, keys }) => {
        setCfg(config);
        setHints(keys);
        commitFromEffect(null, freshGame(config));
      })
      .catch((e) => setLoadError(`Could not load settings: ${e.message}`));
  }, []);

  // Every AI turn is a paid API call: pause when the tab goes to the background, and track activity for the idle check.
  useEffect(() => {
    lastActive.current = Date.now();
    const markActive = () => (lastActive.current = Date.now());
    const pauseWhenHidden = () => document.hidden && setPaused("Tab was in the background");
    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => {
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      document.removeEventListener("visibilitychange", pauseWhenHidden);
    };
  }, []);

  // Game loop: deal the next hand, or ask the AI whose turn it is.
  useEffect(() => {
    if (!game || !cfg || paused !== null) {
      return;
    }

    if (game.street === "done") {
      if (isGameOver(game, cfg)) {
        return;
      }
      const timer = setTimeout(() => {
        if (Date.now() - lastActive.current > IDLE_MS) {
          setPaused(`No activity for ${IDLE_MS / 60_000} minutes`);
          return;
        }
        commitFromEffect(game, dealNextHand(game, cfg));
      }, NEXT_HAND_MS[cfg.speed]);
      return () => clearTimeout(timer);
    }

    if (isHuman(cfg, game.turn)) {
      return;
    }
    const request = new AbortController();
    const startedAt = Date.now();
    decide(game, request.signal)
      .then(async (decision) => {
        const elapsed = Date.now() - startedAt;
        await sleep(Math.max(0, MIN_AI_TURN_MS[cfg.speed] - elapsed));
        if (request.signal.aborted) {
          return;
        }
        const turn = { seat: game.turn, say: decision.say, error: decision.error };
        commitFromEffect(game, act(game, legalize(game, decision.action)), turn);
      })
      .catch(() => {}); // aborted: settings changed, paused, or unmounted
    return () => request.abort();
  }, [game, cfg, paused]);

  // Your turn runs out: act for you and pause.
  useEffect(() => {
    if (!game || !cfg || paused !== null || !isHuman(cfg, game.turn)) {
      return;
    }
    const timer = setTimeout(() => timeUp(), turnAt + TURN_MS[cfg.speed] - Date.now());
    return () => clearTimeout(timer);
  }, [game, cfg, paused, turnAt]);

  // A clock for the AI "thinking" seconds; runs only while someone is to act.
  const ticking = !!game && game.turn >= 0 && paused === null;
  useEffect(() => {
    if (!ticking) {
      return;
    }
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(clock);
  }, [ticking]);

  const me = cfg?.playing ? 0 : -1;
  useTableSounds(game, me, muted);

  if (!cfg || !game) {
    return <main className="grid min-h-dvh place-items-center px-4 text-center font-display text-2xl text-gold">{loadError || "Shuffling…"}</main>;
  }

  const save = async (config: Config, keys: KeyEdits) => {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, keys }) });
    const reply = await res.json();
    if (!res.ok) {
      throw new Error(reply.error ?? "Save failed");
    }
    if (tableShape(reply.config) !== tableShape(cfg)) {
      restart(reply.config);
    }
    setCfg(reply.config);
    setHints(reply.keys);
    setSettingsOpen(false);
  };

  /** Your own rebuy, when auto re-buy is off and you're out of chips. */
  const rebuy = () => {
    const players = game.players.map((player, seat) => {
      if (seat !== 0) {
        return player;
      }
      return { ...player, stack: cfg.stack, buyIn: player.buyIn + cfg.stack, rebuys: player.rebuys + 1 };
    });
    setGame({ ...game, players });
  };

  const labels = game.players.map((player, seat) => (isHuman(cfg, seat) ? "You" : player.name));
  const colors = game.players.map((_, seat) => (isHuman(cfg, seat) ? YOUR_COLOR : PROVIDERS[cfg.agents[seat].provider].color));
  const myTurn = isHuman(cfg, game.turn) && paused === null;
  const aiTurn = game.turn >= 0 && !isHuman(cfg, game.turn);
  const thinkingSecs = Math.floor(Math.max(0, now - turnAt) / 1000);
  // speech bubbles: the last three things said this hand, one per seat
  const bubbles = new Map(
    log
      .filter((entry) => entry.hand === game.hand && entry.say)
      .slice(-3)
      .map((entry) => [entry.seat, entry.say]),
  );
  const gameOver = isGameOver(game, cfg);
  const mine = game.players[0];
  const busted = cfg.playing && mine.stack === 0 && (!mine.cards.length || game.street === "done");
  const winnerLabel = labels[game.players.findIndex((player) => player.stack > 0)] ?? "Nobody";

  return (
    <main className="flex min-h-dvh flex-col">
      <TableHeader
        stack={cfg.playing ? mine.stack.toLocaleString() : "Spectating"}
        status={
          <>
            Hand #{game.hand} · Blinds {game.sb}/{game.bb}
          </>
        }
      >
        <HeaderButton label={muted ? "Turn sound on" : "Mute sound"} icon={muted ? "muted" : "sound"} onClick={toggleMute} />
        <HeaderButton label="Who's up" icon="stats" onClick={() => setShowStats(!showStats)} pressed={showStats} />
        <a href="/history" target="_blank" rel="noopener" aria-label="Hand history (opens a new tab)" title="Hand history" className="header-btn">
          <Icon name="history" className="h-5 w-5" />
        </a>
        <HeaderButton
          label={paused === null ? "Pause" : "Resume"}
          icon={paused === null ? "pause" : "play"}
          onClick={() => (paused === null ? setPaused("") : resume())}
        />
        <HeaderButton label="New game" icon="restart" onClick={() => restart(cfg)} />
        <HeaderButton label="Table settings" icon="sliders" onClick={() => setSettingsOpen(true)} />
      </TableHeader>

      {Object.keys(hints).length === 0 && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30 hover:text-cream"
        >
          No API keys saved yet, so house bots are playing. Add keys in <b>Settings → Agents &amp; Keys</b>.
        </button>
      )}

      <section className="flex flex-1 items-center justify-center px-12 pb-60 pt-20 sm:px-24 sm:pb-36">
        <TableView
          game={game}
          me={me}
          labels={labels}
          colors={colors}
          reveal={cfg.reveal}
          thinking={aiTurn ? { seat: game.turn, secs: thinkingSecs } : undefined}
          timer={myTurn ? { id: String(turnAt), seat: 0, limitMs: TURN_MS[cfg.speed], elapsedMs: 0 } : null}
          bubbles={bubbles}
          paused={paused}
          onResume={resume}
        />
      </section>

      {(myTurn || busted) && (
        <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end gap-3 sm:bottom-5 sm:right-6">
          {busted && (
            <button className="btn-gold anim-pop" onClick={rebuy}>
              REBUY {cfg.stack.toLocaleString()}
            </button>
          )}
          {myTurn && (
            <ActionBar game={game} deadline={turnAt + TURN_MS[cfg.speed]} onAct={humanAct} onTick={() => !muted && play("tick")} hotkeys={!settingsOpen} />
          )}
        </div>
      )}

      {showStats && <StatsPanel game={game} labels={labels} />}
      <LogPanel entries={log} open={showLog} onToggle={() => setShowLog(!showLog)} hidden={myTurn} yourTurn={yourTurnLine(game, me)} />

      {gameOver && (
        <div className="anim-fade fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <div className="anim-modal panel p-8 text-center sm:p-12">
            <h2 className="font-display text-5xl font-bold text-white">GAME OVER</h2>
            <p className="mt-3 text-xl">{winnerLabel} takes the table.</p>
            <button className="btn-gold mt-8" onClick={() => restart(cfg)}>
              NEW GAME
            </button>
          </div>
        </div>
      )}

      {settingsOpen && <SettingsModal cfg={cfg} hints={hints} onSave={save} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
