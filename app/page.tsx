"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PROVIDERS, type Config } from "@/lib/config";
import { act, describe, houseBot, legal, legalize, newGame, parseReply, startHand, type Action, type Card as CardT, type Game, type Player } from "@/lib/poker";
import { Icon, SettingsModal, type KeyEdits } from "./settings";

type Entry = { hand: number; text: string; seat?: number; say?: string; kind?: "hand" | "error" };
type Decision = { action: Action; say?: string; error?: string };

const isHuman = (c: Config, seat: number) => c.playing && seat === 0;
const names = (c: Config) => Array.from({ length: c.seats }, (_, i) => (isHuman(c, i) ? "Human" : c.agents[i].name));
const structure = (c: Config) => [c.seats, c.stack, c.bb, c.playing].join("|");
const freshGame = (c: Config) => startHand(newGame(names(c), c.stack, c.bb));
const IDLE_MS = 5 * 60_000; // no clicks/keys for this long = nobody is watching, stop paying for AI turns
const isOver = (g: Game, c: Config) => g.street === "done" && !c.rebuy && g.players.filter((p) => p.stack > 0).length < 2;

function dealNext(g: Game, c: Config): Game {
  const n = structuredClone(g);
  const ns = names(c);
  n.players.forEach((p, i) => {
    p.name = ns[i];
    if (p.stack === 0 ? c.rebuy : c.topOff && p.stack < c.stack) p.stack = c.stack;
  });
  return startHand(n);
}

/** Append the history lines `next` added on top of `prev` (plus who said what) to the table log. */
function append(log: Entry[], prev: Game | null, next: Game, seat?: number, say?: string, error?: string): Entry[] {
  const newHand = !prev || prev.hand !== next.hand;
  const out: Entry[] = newHand ? [{ hand: next.hand, text: `Hand #${next.hand}`, kind: "hand" }] : [];
  if (error && log.findLast((e) => e.kind === "error" && e.seat === seat)?.text !== error) out.push({ hand: next.hand, seat, text: error, kind: "error" });
  next.history.slice(newHand ? 0 : prev.history.length).forEach((text, k) => out.push({ hand: next.hand, text, ...(k === 0 && { seat, say }) }));
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

const spot = (i: number, n: number, r: number, turn = 0): CSSProperties => {
  const t = Math.PI / 2 + (i * 2 * Math.PI) / n + turn; // seat 0 at the bottom, clockwise
  return { left: `${50 + 50 * r * Math.cos(t)}%`, top: `${50 + 50 * r * Math.sin(t)}%` };
};

export default function Home() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [game, setGame] = useState<Game | null>(null);
  const [log, setLog] = useState<Entry[]>([]);
  const [paused, setPaused] = useState<string | null>(null); // why the game is paused ("" = by hand), null = running
  const lastActive = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ config, keys }: { config: Config; keys: Record<string, string> }) => {
        const g = freshGame(config);
        setCfg(config);
        setHints(keys);
        setGame(g);
        setLog(append([], null, g));
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
        const n = dealNext(game, cfg);
        setGame(n);
        setLog((l) => append(l, game, n));
      }, fast ? 2500 : 5000);
      return () => clearTimeout(t);
    }
    if (isHuman(cfg, game.turn)) return;
    const ctrl = new AbortController();
    const started = Date.now();
    decide(game, ctrl.signal)
      .then(async (r) => {
        await new Promise((ok) => setTimeout(ok, Math.max(0, (fast ? 400 : 1200) - (Date.now() - started))));
        if (ctrl.signal.aborted) return;
        const n = act(game, legalize(game, r.action));
        setGame(n);
        setLog((l) => append(l, game, n, game.turn, r.say, r.error));
      })
      .catch(() => {}); // aborted: settings changed, paused, or unmounted
    return () => ctrl.abort();
  }, [game, cfg, paused]);

  if (!cfg || !game) return <main className="grid min-h-dvh place-items-center font-display text-2xl text-gold">{loadError || "Shuffling…"}</main>;

  const restart = (c: Config) => {
    const g = freshGame(c);
    setGame(g);
    setLog(append([], null, g));
  };

  const save = async (c: Config, keys: KeyEdits) => {
    const res = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: c, keys }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "Save failed");
    if (structure(j.config) !== structure(cfg)) restart(j.config);
    setCfg(j.config);
    setHints(j.keys);
    setSettingsOpen(false);
  };

  const humanAct = (a: Action) => {
    const n = act(game, legalize(game, a));
    setGame(n);
    setLog((l) => append(l, game, n, 0));
  };

  const n = game.players.length;
  const committed = game.players.reduce((s, p) => s + p.committed, 0);
    const showdown = game.street === "done" && game.players.filter((p) => !p.folded).length > 1;
  const lg = isHuman(cfg, game.turn) ? legal(game) : null;
  const to = lg ? Math.min(lg.maxTo, Math.max(lg.minTo, raiseTo)) : 0;
  const quick: [string, number][] = lg
    ? [["Min", lg.minTo], ["½ Pot", game.currentBet + Math.round((committed + lg.owe) / 2)], ["Pot", game.currentBet + committed + lg.owe], ["Max", lg.maxTo]]
    : [];
  const bubbles = new Map(log.filter((e) => e.hand === game.hand && e.say).slice(-3).map((e) => [e.seat, e.say]));
  const winners = new Set(game.winners.map((w) => w.seat));
  const over = isOver(game, cfg);
  const me = game.players[0];
  const busted = cfg.playing && me.stack === 0 && (!me.cards.length || game.street === "done");

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b-2 border-[#c9965c]/60 bg-wine/90 px-3 py-2 sm:px-6">
        <div className="flex items-center gap-2 font-display text-lg tracking-wide sm:text-2xl">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#c4202c] text-white shadow ring-2 ring-gold/60">♠</span>
          AGENT <span className="-ml-1 text-gold">HOLD&apos;EM</span>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-gold/40 bg-black/30 px-4 py-1 font-display text-lg sm:flex">
          <span className="chip" /> {cfg.playing ? me.stack.toLocaleString() : "Spectating"}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="mr-2 hidden text-sm text-cream/70 md:block">
            Hand #{game.hand} · Blinds {game.sb}/{game.bb}
          </span>
          <HeaderButton label={paused === null ? "Pause" : "Resume"} icon={paused === null ? "pause" : "play"} onClick={() => setPaused(paused === null ? "" : null)} />
          <HeaderButton label="New game" icon="restart" onClick={() => restart(cfg)} />
          <HeaderButton label="Table settings" icon="sliders" onClick={() => setSettingsOpen(true)} />
        </div>
      </header>

      {Object.keys(hints).length === 0 && (
        <button onClick={() => setSettingsOpen(true)} className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30 hover:text-cream">
          No API keys saved yet, so house bots are playing. Add keys in <b>Settings → Agents &amp; Keys</b>.
        </button>
      )}

      <section className="flex flex-1 items-center justify-center px-12 pb-44 pt-20 sm:px-24 sm:pb-36">
        <div className="table-box">
          <div className="rail absolute inset-0 rounded-[50%] p-[2.4%]">
            <div className="felt relative h-full w-full rounded-[50%]">
              <div className="absolute inset-[6%] rounded-[50%] border-2 border-[#ffd9a8]/15" />
              <div className="absolute left-1/2 top-[24%] -translate-x-1/2 select-none whitespace-nowrap font-display text-[clamp(12px,2.2vw,24px)] tracking-[.35em] text-black/25">
                AGENT HOLD&apos;EM
              </div>
            </div>
          </div>

          <div className="absolute left-1/2 top-1/2 z-[6] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 sm:gap-3">
            {game.winners.length ? (
              <div className="whitespace-nowrap rounded-full bg-black/65 px-4 py-1 text-center font-display text-sm text-gold shadow-lg sm:text-lg">
                {game.winners.map((w) => `${isHuman(cfg, w.seat) ? "You win" : `${game.players[w.seat].name} wins`} ${w.amount.toLocaleString()}${w.hand && ` · ${w.hand}`}`).join("   |   ")}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-1 font-display text-base sm:text-xl">
                <span className="chip" /> POT {committed.toLocaleString()}
              </div>
            )}
            <div className="flex gap-1 sm:gap-1.5">
              {[0, 1, 2, 3, 4].map((k) => (game.board[k] ? <Card key={game.board[k]} c={game.board[k]} size="md" /> : <div key={k} className={`slot ${DIMS.md}`} />))}
            </div>
            {paused !== null && (
              <button onClick={() => setPaused(null)} className="rounded-2xl bg-black/70 px-4 py-1 text-center font-display tracking-widest text-gold hover:bg-black/85">
                PAUSED · RESUME
                {paused && <span className="block font-sans text-xs tracking-normal text-cream/75">{paused}</span>}
              </button>
            )}
          </div>

          {game.players.map(
            (p, i) =>
              p.bet > 0 && (
                <div key={i} className="absolute z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-black/55 py-0.5 pl-0.5 pr-2 font-display text-sm sm:text-base" style={spot(i, n, 0.6)}>
                  <span className="chip text-lg" />
                  {p.bet.toLocaleString()}
                </div>
              ),
          )}
          {game.hand > 0 && (
            <div className="absolute z-[5] grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-black text-zinc-800 shadow-md ring-2 ring-zinc-300" style={spot(game.dealer, n, 0.74, 0.3)}>
              D
            </div>
          )}

          {game.players.map((p, i) => (
            <Seat
              key={i}
              p={p}
              label={isHuman(cfg, i) ? "You" : p.name}
              human={isHuman(cfg, i)}
              color={isHuman(cfg, i) ? "#e8c27a" : PROVIDERS[cfg.agents[i].provider].color}
              turn={game.turn === i && paused === null}
              won={winners.has(i)}
              bubble={bubbles.get(i)}
              faceUp={isHuman(cfg, i) || cfg.reveal || showdown}
              style={spot(i, n, 1)}
            />
          ))}
        </div>
      </section>

      {(lg || busted) && (
        <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end gap-3 sm:bottom-5 sm:right-6">
          {busted && (
            <button className="btn-gold" onClick={() => setGame({ ...game, players: game.players.map((p, i) => (i === 0 ? { ...p, stack: cfg.stack } : p)) })}>
              REBUY {cfg.stack.toLocaleString()}
            </button>
          )}
          {lg?.canRaise && (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl bg-black/60 p-2 ring-1 ring-gold/30">
              {quick.map(([label, amount]) => (
                <button key={label} onClick={() => setRaiseTo(amount)} className="rounded-full bg-wine px-3 py-1 text-sm ring-1 ring-gold/40 hover:bg-[#5a121b]">
                  {label}
                </button>
              ))}
              <input type="range" aria-label="Raise amount" min={lg.minTo} max={lg.maxTo} value={to} onChange={(e) => setRaiseTo(Number(e.target.value))} className="w-36 accent-gold sm:w-48" />
            </div>
          )}
          {lg && (
            <div className="flex items-end gap-4 sm:gap-6">
              {lg.owe > 0 && <ActionButton label="Fold" icon="x" onClick={() => humanAct({ type: "fold" })} />}
              <ActionButton label={lg.owe ? `Call ${lg.owe.toLocaleString()}` : "Check"} icon="check" onClick={() => humanAct({ type: lg.owe ? "call" : "check" })} />
              {lg.canRaise && (
                <ActionButton label={to === lg.maxTo ? "All-in" : `${game.currentBet ? "Raise" : "Bet"} ${to.toLocaleString()}`} icon="up" onClick={() => humanAct({ type: "raise", amount: to })} />
              )}
            </div>
          )}
        </div>
      )}

      <aside className="fixed bottom-3 left-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] sm:bottom-5 sm:left-6">
        {showLog && (
          <ol aria-label="Table log" className="mb-2 flex max-h-[30vh] flex-col-reverse overflow-y-auto rounded-2xl bg-black/65 p-3 text-sm ring-1 ring-gold/25 backdrop-blur">
            {log.toReversed().map((e, k) => (
              <li key={log.length - k} className={e.kind === "hand" ? "mt-3 font-display tracking-wider text-gold" : e.kind === "error" ? "py-0.5 text-red-300" : "py-0.5 text-cream/90"}>
                {e.text}
                {e.say && <span className="block pl-3 italic text-cream/65">“{e.say}”</span>}
              </li>
            ))}
          </ol>
        )}
        <button onClick={() => setShowLog(!showLog)} className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm ring-1 ring-gold/30 hover:bg-black/80" aria-expanded={showLog}>
          <Icon name="list" className="h-5 w-5" /> Table talk
        </button>
      </aside>

      {over && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <div className="panel p-8 text-center sm:p-12">
            <h2 className="font-display text-5xl font-bold text-white">GAME OVER</h2>
            <p className="mt-3 text-xl">{game.players.find((p) => p.stack > 0)?.name ?? "Nobody"} takes the table.</p>
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

function Seat({ p, label, human, color, turn, won, bubble, faceUp, style }: { p: Player; label: string; human: boolean; color: string; turn: boolean; won: boolean; bubble?: string; faceUp: boolean; style: CSSProperties }) {
  const sittingOut = !p.cards.length;
  const badge = turn && !human ? "thinking…" : p.last;
  return (
    <div className={`absolute z-10 flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center sm:w-28 ${(p.folded && !won) || sittingOut ? "opacity-55" : ""}`} style={style}>
      {bubble && (
        <div className="bubble absolute bottom-full z-20 mb-3 w-max max-w-44 rounded-xl bg-[#fff7e6] px-2.5 py-1.5 text-center text-xs font-bold text-zinc-900 shadow-lg">{bubble}</div>
      )}
      <div className="relative">
        {turn && <div className="turn-ring" />}
        <div
          className={`${won ? "winner" : "avatar"} grid h-12 w-12 place-items-center rounded-full font-display text-lg text-white sm:h-16 sm:w-16 sm:text-2xl`}
          style={{ background: `radial-gradient(circle at 35% 30%, ${color}, #1a0508 125%)` }}
        >
          {label.slice(0, 2).toUpperCase()}
        </div>
        {!p.folded && !sittingOut && (
          <div className={human ? "absolute bottom-[40%] left-1/2 flex -translate-x-1/2 gap-0.5" : "absolute left-[62%] top-[-12%] flex -space-x-3"}>
            {p.cards.map((c, k) => (
              <div key={c} className={human ? "" : k ? "rotate-[10deg]" : "-rotate-[4deg]"}>
                <Card c={faceUp ? c : undefined} size={human ? "lg" : "sm"} />
              </div>
            ))}
          </div>
        )}
        {badge && (
          <span className={`absolute right-[68%] top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide shadow ${turn ? "animate-pulse bg-cream text-wine" : "bg-gold text-wine"}`}>
            {badge}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-1 w-full rounded-lg bg-black/70 px-2 py-0.5 text-center shadow ring-1 ring-gold/30">
        <div className="truncate text-[11px] text-cream/80 sm:text-xs">{label}</div>
        <div className="font-display text-sm text-gold sm:text-base">{sittingOut && !p.stack ? "BUSTED" : p.stack.toLocaleString()}</div>
      </div>
    </div>
  );
}

const DIMS = {
  sm: "h-9 w-[26px] text-[10px]",
  md: "h-[52px] w-9 text-sm sm:h-[78px] sm:w-14 sm:text-xl",
  lg: "h-[70px] w-12 text-lg sm:h-[84px] sm:w-[60px] sm:text-xl",
};
const SUITS: Record<string, string> = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" };

function Card({ c, size }: { c?: CardT; size: keyof typeof DIMS }) {
  if (!c) return <div className={`card-back ${DIMS[size]}`} />;
  const rank = c[0] === "T" ? "10" : c[0];
  return (
    <div role="img" aria-label={rank + c[1]} className={`card ${DIMS[size]} ${c[1] === "h" || c[1] === "d" ? "text-[#c8102e]" : "text-zinc-900"}`}>
      <span className="absolute left-[10%] top-[7%] flex flex-col items-center">
        {rank}
        <span>{SUITS[c[1]]}</span>
      </span>
      <span className="absolute bottom-[5%] right-[9%] text-[1.7em]">{SUITS[c[1]]}</span>
    </div>
  );
}

function HeaderButton({ label, icon, onClick }: { label: string; icon: "play" | "pause" | "restart" | "sliders"; onClick: () => void }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="grid h-10 w-10 place-items-center rounded-full border-2 border-gold/70 bg-black/30 text-cream hover:bg-[#5a121b]">
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

function ActionButton({ label, icon, onClick }: { label: string; icon: "x" | "check" | "up"; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span className="font-display text-lg tracking-wide drop-shadow sm:text-xl">{label}</span>
      <span className="round-btn">
        <Icon name={icon} className="h-7 w-7" />
      </span>
    </button>
  );
}
