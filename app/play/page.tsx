"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { PROVIDERS, type Config } from "@/lib/config";
import { act, describe, handRecord, houseBot, legalize, newGame, parseReply, startHand, type Action, type Game } from "@/lib/poker";
import { play } from "@/lib/sound";
import { SettingsModal, type KeyEdits } from "../settings";
import { ActionBar, HeaderButton, LogPanel, StatsPanel, TableView, useMuted, useTableSounds, yourTurnLine, type LogEntry } from "../table";
import { Icon } from "../ui";

type Entry = LogEntry & { hand: number; seat?: number };
type Decision = { action: Action; say?: string; error?: string };

const IDLE_MS = 5 * 60_000; // no clicks/keys for this long = nobody is watching, stop paying for AI turns
const TURN_MS = { fast: 15_000, normal: 30_000 }; // your time to act before an automatic check (or fold)

const isHuman = (c: Config, seat: number) => c.playing && seat === 0;
const names = (c: Config) => Array.from({ length: c.seats }, (_, i) => (isHuman(c, i) ? "Human" : c.agents[i].name)); // "You" would read as the AI itself in prompts
const structure = (c: Config) => [c.seats, c.stack, c.bb, c.playing].join("|");
const freshGame = (c: Config) => startHand(newGame(names(c), c.stack, c.bb));
const isOver = (g: Game, c: Config) => g.street === "done" && !c.rebuy && g.players.filter((p) => p.stack > 0).length < 2;

function dealNext(g: Game, c: Config): Game {
  const n = structuredClone(g);
  const ns = names(c);
  n.players.forEach((p, i) => {
    p.name = ns[i];
    if (p.stack === 0 && c.rebuy) {
      p.rebuys++;
      p.buyIn += c.stack;
      p.stack = c.stack;
    } else if (p.stack > 0 && c.topOff && p.stack < c.stack) {
      p.buyIn += c.stack - p.stack;
      p.stack = c.stack;
    }
  });
  return startHand(n);
}

/** Append the history lines `next` added on top of `prev` (plus who said what) to the table log. */
function append(log: Entry[], prev: Game | null, next: Game, seat?: number, say?: string, error?: string): Entry[] {
  let id = log.at(-1)?.id ?? 0;
  const newHand = !prev || prev.hand !== next.hand;
  const out: Entry[] = newHand ? [{ id: ++id, hand: next.hand, text: `Hand #${next.hand}`, kind: "hand" }] : [];
  if (error && log.findLast((e) => e.kind === "error" && e.seat === seat)?.text !== error) out.push({ id: ++id, hand: next.hand, seat, text: error, kind: "error" });
  next.history.slice(newHand ? 0 : prev.history.length).forEach((text, k) => out.push({ id: ++id, hand: next.hand, text, ...(k === 0 && { seat, say }) }));
  return [...log, ...out].slice(-200);
}

async function decide(g: Game, signal: AbortSignal): Promise<Decision> {
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seat: g.turn, prompt: describe(g) }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
    const r = parseReply(j.text);
    if (!r) throw new Error(`unreadable reply "${String(j.text).slice(0, 60)}"`);
    return r;
  } catch (e) {
    if (signal.aborted) throw e;
    return { action: houseBot(g), error: `${g.players[g.turn].name}: ${(e as Error).message} - house bot is playing for them.` };
  }
}

function saveHand(g: Game, c: Config) {
  fetch("/api/hands", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gameId: g.id, hand: handRecord(g, c.playing ? 0 : -1) }),
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
  const commit = (prev: Game | null, next: Game, seat?: number, say?: string, error?: string) => {
    setGame(next);
    setTurnAt(Date.now());
    setLog((l) => append(l, prev, next, seat, say, error));
    if (cfg && prev && prev.hand === next.hand && prev.street !== "done" && next.street === "done") saveHand(next, cfg);
  };
  const restart = (c: Config) => {
    setLog([]);
    commit(null, freshGame(c));
  };
  const resume = () => {
    setPaused(null);
    setTurnAt(Date.now()); // the clock restarts for whoever is to act
  };
  const humanAct = (a: Action) => {
    if (game) commit(game, act(game, legalize(game, a)), 0);
  };

  const commitFromEffect = useEffectEvent(commit);
  // Out of time = you're away: check (legalize makes it a fold when you owe chips), then stop the AIs, whose turns cost money, until you resume.
  const timeUp = useEffectEvent(() => {
    humanAct({ type: "check" });
    setPaused("You ran out of time");
  });

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j as { config: Config; keys: Record<string, string> };
      })
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
    const active = () => (lastActive.current = Date.now());
    const hidden = () => document.hidden && setPaused("Tab was in the background");
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  // Game loop: deal the next hand, or ask the AI whose turn it is.
  useEffect(() => {
    if (!game || !cfg || paused !== null) return;
    const fast = cfg.speed === "fast";
    if (game.street === "done") {
      if (isOver(game, cfg)) return;
      const t = setTimeout(() => {
        if (Date.now() - lastActive.current > IDLE_MS) return setPaused(`No activity for ${IDLE_MS / 60_000} minutes`);
        commitFromEffect(game, dealNext(game, cfg));
      }, fast ? 3000 : 5500);
      return () => clearTimeout(t);
    }
    if (isHuman(cfg, game.turn)) return;
    const ctrl = new AbortController();
    const started = Date.now();
    decide(game, ctrl.signal)
      .then(async (r) => {
        await new Promise((ok) => setTimeout(ok, Math.max(0, (fast ? 400 : 1200) - (Date.now() - started))));
        if (ctrl.signal.aborted) return;
        commitFromEffect(game, act(game, legalize(game, r.action)), game.turn, r.say, r.error);
      })
      .catch(() => {}); // aborted: settings changed, paused, or unmounted
    return () => ctrl.abort();
  }, [game, cfg, paused]);

  // Your turn runs out: act for you and pause.
  useEffect(() => {
    if (!game || !cfg || paused !== null || !isHuman(cfg, game.turn)) return;
    const t = setTimeout(() => timeUp(), turnAt + TURN_MS[cfg.speed] - Date.now());
    return () => clearTimeout(t);
  }, [game, cfg, paused, turnAt]);

  // A clock for the AI "thinking" seconds; runs only while someone is to act.
  const ticking = !!game && game.turn >= 0 && paused === null;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);

  const me = cfg?.playing ? 0 : -1;
  useTableSounds(game, me, muted);

  if (!cfg || !game) return <main className="grid min-h-dvh place-items-center px-4 text-center font-display text-2xl text-gold">{loadError || "Shuffling…"}</main>;

  const save = async (c: Config, keys: KeyEdits) => {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c, keys }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "Save failed");
    if (structure(j.config) !== structure(cfg)) restart(j.config);
    setCfg(j.config);
    setHints(j.keys);
    setSettingsOpen(false);
  };

  const labels = game.players.map((p, i) => (isHuman(cfg, i) ? "You" : p.name));
  const colors = game.players.map((_, i) => (isHuman(cfg, i) ? "#e8c27a" : PROVIDERS[cfg.agents[i].provider].color));
  const myTurn = isHuman(cfg, game.turn) && paused === null;
  const aiTurn = game.turn >= 0 && !isHuman(cfg, game.turn);
  const bubbles = new Map(log.filter((e) => e.hand === game.hand && e.say).slice(-3).map((e) => [e.seat, e.say]));
  const over = isOver(game, cfg);
  const mine = game.players[0];
  const busted = cfg.playing && mine.stack === 0 && (!mine.cards.length || game.street === "done");

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-2 border-b-2 border-[#c9965c]/60 bg-wine/90 px-3 py-2 sm:px-6">
        <Link href="/" aria-label="Home" className="flex items-center gap-2 font-display text-lg tracking-wide sm:text-2xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#c4202c] text-white shadow ring-2 ring-gold/60">♠</span>
          <span className="hidden sm:inline">
            AGENT <span className="text-gold">HOLD&apos;EM</span>
          </span>
        </Link>
        <div className="hidden items-center gap-2 rounded-full border border-gold/40 bg-black/30 px-4 py-1 font-display text-lg md:flex">
          <span className="chip" /> {cfg.playing ? mine.stack.toLocaleString() : "Spectating"}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="mr-2 hidden text-sm text-cream/70 lg:block">
            Hand #{game.hand} · Blinds {game.sb}/{game.bb}
          </span>
          <HeaderButton label={muted ? "Turn sound on" : "Mute sound"} icon={muted ? "muted" : "sound"} onClick={toggleMute} />
          <HeaderButton label="Who's up" icon="stats" onClick={() => setShowStats(!showStats)} pressed={showStats} />
          <a href="/history" target="_blank" rel="noopener" aria-label="Hand history (opens a new tab)" title="Hand history" className="header-btn">
            <Icon name="history" className="h-5 w-5" />
          </a>
          <HeaderButton label={paused === null ? "Pause" : "Resume"} icon={paused === null ? "pause" : "play"} onClick={() => (paused === null ? setPaused("") : resume())} />
          <HeaderButton label="New game" icon="restart" onClick={() => restart(cfg)} />
          <HeaderButton label="Table settings" icon="sliders" onClick={() => setSettingsOpen(true)} />
        </div>
      </header>

      {Object.keys(hints).length === 0 && (
        <button onClick={() => setSettingsOpen(true)} className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30 hover:text-cream">
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
          thinking={aiTurn ? { seat: game.turn, secs: Math.floor(Math.max(0, now - turnAt) / 1000) } : undefined}
          timer={myTurn ? { id: String(turnAt), seat: 0, limitMs: TURN_MS[cfg.speed], elapsedMs: 0 } : null}
          bubbles={bubbles}
          paused={paused}
          onResume={resume}
        />
      </section>

      {(myTurn || busted) && (
        <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end gap-3 sm:bottom-5 sm:right-6">
          {busted && (
            <button
              className="btn-gold anim-pop"
              onClick={() => setGame({ ...game, players: game.players.map((p, i) => (i === 0 ? { ...p, stack: cfg.stack, buyIn: p.buyIn + cfg.stack, rebuys: p.rebuys + 1 } : p)) })}
            >
              REBUY {cfg.stack.toLocaleString()}
            </button>
          )}
          {myTurn && <ActionBar game={game} deadline={turnAt + TURN_MS[cfg.speed]} onAct={humanAct} onTick={() => !muted && play("tick")} hotkeys={!settingsOpen} />}
        </div>
      )}

      {showStats && <StatsPanel game={game} labels={labels} />}
      <LogPanel entries={log} open={showLog} onToggle={() => setShowLog(!showLog)} hidden={myTurn} yourTurn={yourTurnLine(game, me)} />

      {over && (
        <div className="anim-fade fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <div className="anim-modal panel p-8 text-center sm:p-12">
            <h2 className="font-display text-5xl font-bold text-white">GAME OVER</h2>
            <p className="mt-3 text-xl">{labels[game.players.findIndex((p) => p.stack > 0)] ?? "Nobody"} takes the table.</p>
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
