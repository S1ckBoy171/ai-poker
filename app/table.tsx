"use client";

// The poker table UI shared by bot matches (/play) and friend tables (/t/[code]).
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { legal, type Action, type Game, type Player } from "@/lib/poker";
import { play, unlockAudio, type Sound } from "@/lib/sound";
import { Card, DIMS, Icon } from "./ui";

type Pt = { x: number; y: number };
/** A running turn clock, drawn as a shrinking bar under that seat's name. */
export type Timer = { id: string; seat: number; limitMs: number; elapsedMs: number };
export type LogEntry = { id: number; text: string; say?: string; kind?: "hand" | "error" };

const POT: Pt = { x: 50, y: 39 }; // where the pot pill sits, in % of the table box
const BOARD_DELAY = [0, 110, 220, 0, 0]; // flop cards land one after another

const point = (i: number, n: number, r: number, turn = 0): Pt => {
  const t = Math.PI / 2 + (i * 2 * Math.PI) / n + turn; // position 0 at the bottom, clockwise
  return { x: 50 + 50 * r * Math.cos(t), y: 50 + 50 * r * Math.sin(t) };
};
const place = (p: Pt): CSSProperties => ({ left: `${p.x}%`, top: `${p.y}%` });
/** Style for a `.fly` element: slides from one table point to another, resting at `to`. */
const fly = (from: Pt, to: Pt) => ({ ...place(to), "--fx": `${from.x}%`, "--fy": `${from.y}%`, "--tx": `${to.x}%`, "--ty": `${to.y}%` }) as CSSProperties;
export const clampTo = (lg: ReturnType<typeof legal>, v: number) => Math.min(lg.maxTo, Math.max(lg.minTo, v));

const soundFor = (line: string): Sound | undefined =>
  / wins /.test(line) ? "win" : / folds/.test(line) ? "fold" : / checks/.test(line) ? "check" : / (calls|bets|raises)/.test(line) ? "chip" : /^(flop|turn|river): /.test(line) ? "card" : undefined;

const MUTE_KEY = "agent-holdem-muted";
const muteListeners = new Set<() => void>();

/** Sound on/off, remembered in this browser (shared by every table page). */
export function useMuted(): [boolean, () => void] {
  const muted = useSyncExternalStore(
    (cb) => {
      muteListeners.add(cb);
      return () => muteListeners.delete(cb);
    },
    () => {
      try {
        return localStorage.getItem(MUTE_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  const toggle = () => {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "0" : "1");
    } catch {}
    muteListeners.forEach((cb) => cb());
  };
  return [muted, toggle];
}

/** Plays the table's sounds for whatever changed since the last game state. Browsers allow audio only after a click or key press. */
export function useTableSounds(game: Game | null, me: number, muted: boolean) {
  const prev = useRef<Game | null>(null);
  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before || !game || before === game || muted) return;
    const sounds: Sound[] =
      before.hand !== game.hand ? ["deal"] : [...new Set(game.history.slice(before.history.length).map(soundFor).filter((s): s is Sound => !!s))];
    if (me >= 0 && game.turn === me && (before.turn !== me || before.street !== game.street || before.hand !== game.hand)) sounds.push("turn");
    sounds.forEach((s, k) => setTimeout(() => play(s), k * 140));
  }, [game, me, muted]);
}

/** Felt, board, pot, chips in motion, dealer button and seats. Seat `me` is drawn at the bottom (-1 = just watching). */
export function TableView(props: {
  game: Game;
  me: number;
  labels: string[];
  colors: string[];
  reveal?: boolean;
  thinking?: { seat: number; secs?: number };
  timer?: Timer | null;
  bubbles?: Map<number | undefined, string | undefined>;
  paused?: string | null;
  onResume?: () => void;
}) {
  const { game, me, labels, colors, reveal, thinking, timer, bubbles, paused, onResume } = props;
  const n = game.players.length;
  const at = (i: number, r: number, turn = 0) => point(me >= 0 ? (i - me + n) % n : i, n, r, turn);
  const committed = game.players.reduce((s, p) => s + p.committed, 0);
  const showdown = game.street === "done" && game.players.filter((p) => !p.folded).length > 1;
  const winners = new Set(game.winners.map((w) => w.seat));
  const winCards = new Set(game.winners.flatMap((w) => w.cards));
  // hole cards go out one at a time starting left of the button, twice around
  const dealDelay = (i: number, k: number) => (k * n + ((i - game.dealer - 1 + n) % n)) * 55;

  return (
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
          <div key={`win-${game.hand}`} className="anim-pop whitespace-nowrap rounded-full bg-black/65 px-4 py-1 text-center font-display text-sm text-gold shadow-lg sm:text-lg">
            {game.winners.map((w) => `${w.seat === me ? "You win" : `${labels[w.seat]} wins`} ${w.amount.toLocaleString()}${w.hand && ` · ${w.hand}`}`).join("   |   ")}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-1 font-display text-base sm:text-xl">
            <span className="chip" /> POT {committed.toLocaleString()}
          </div>
        )}
        <div className="flex gap-1 sm:gap-1.5">
          {[0, 1, 2, 3, 4].map((k) => {
            const c = game.board[k];
            return c ? (
              <Card key={`${game.hand}-${c}`} c={c} size="md" delay={BOARD_DELAY[k]} win={winCards.has(c)} dim={winCards.size > 0 && !winCards.has(c)} />
            ) : (
              <div key={k} className={`slot ${DIMS.md}`} />
            );
          })}
        </div>
        {paused != null && (
          <button onClick={onResume} className="anim-pop rounded-2xl bg-black/70 px-4 py-1 text-center font-display tracking-widest text-gold hover:bg-black/85">
            PAUSED · RESUME
            {paused && <span className="block font-sans text-xs tracking-normal text-cream/75">{paused}</span>}
          </button>
        )}
      </div>

      {/* chips: into a bet, bets into the pot at the end of a street, the pot out to the winners */}
      {game.players.map(
        (p, i) =>
          p.bet > 0 && (
            <div key={`${game.hand}-${i}-${p.bet}`} className="fly chips-in z-[5]" style={fly(at(i, 0.84), at(i, 0.6))}>
              <Chips amount={p.bet} />
            </div>
          ),
      )}
      {game.swept.map((s) => (
        <div key={`${game.hand}-${s.street}-${s.seat}`} className="fly chips-sweep z-[5]" style={fly(at(s.seat, 0.6), POT)}>
          <Chips amount={s.amount} />
        </div>
      ))}
      {game.street === "done" &&
        game.winners.map((w) => (
          <div key={`${game.hand}-won-${w.seat}`} className="fly chips-win z-[7]" style={fly(POT, at(w.seat, 0.78))}>
            <Chips amount={w.amount} plus />
          </div>
        ))}

      {game.hand > 0 && (
        <div
          className="dealer-btn absolute z-[5] grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-black text-zinc-800 shadow-md ring-2 ring-zinc-300"
          style={place(at(game.dealer, 0.74, 0.3))}
        >
          D
        </div>
      )}

      {game.players.map((p, i) => (
        <Seat
          key={i}
          p={p}
          label={labels[i]}
          human={i === me}
          color={colors[i]}
          thinking={thinking?.seat === i && paused == null ? (thinking.secs === undefined ? "thinking" : `thinking ${thinking.secs}s`) : undefined}
          won={winners.has(i)}
          bubble={bubbles?.get(i)}
          faceUp={i === me || !!reveal || (showdown && !p.folded)}
          winCards={winCards}
          hand={game.hand}
          dealDelay={(k) => dealDelay(i, k)}
          timer={timer?.seat === i && paused == null ? timer : undefined}
          style={place(at(i, 1))}
        />
      ))}
    </div>
  );
}

function Seat(props: {
  p: Player;
  label: string;
  human: boolean;
  color: string;
  thinking?: string; // badge text while this seat is deciding
  won: boolean;
  bubble?: string;
  faceUp: boolean;
  winCards: Set<string>;
  hand: number;
  dealDelay: (k: number) => number;
  timer?: Timer;
  style: CSSProperties;
}) {
  const { p, label, human, color, thinking, won, bubble, faceUp, winCards, hand, dealDelay, timer, style } = props;
  const sittingOut = !p.cards.length;
  const badge = thinking ?? p.last;
  return (
    <div
      className={`absolute z-10 flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-opacity duration-300 sm:w-28 ${(p.folded && !won) || sittingOut ? "opacity-55" : ""}`}
      style={style}
    >
      {bubble && (
        <div key={bubble} className="anim-pop bubble absolute bottom-full z-20 mb-3 w-max max-w-44 origin-bottom rounded-xl bg-[#fff7e6] px-2.5 py-1.5 text-center text-xs font-bold text-zinc-900 shadow-lg">
          {bubble}
        </div>
      )}
      <div className="relative">
        {thinking && <div className="turn-ring" />}
        <div
          className={`${won ? "winner" : "avatar"} grid h-12 w-12 place-items-center rounded-full font-display text-lg text-white sm:h-16 sm:w-16 sm:text-2xl`}
          style={{ background: `radial-gradient(circle at 35% 30%, ${color}, #1a0508 125%)` }}
        >
          {label.slice(0, 2).toUpperCase()}
        </div>
        {!p.folded && !sittingOut && (
          <div className={human ? "absolute bottom-[40%] left-1/2 flex -translate-x-1/2 gap-0.5" : "absolute left-[62%] top-[-12%] flex -space-x-3"}>
            {p.cards.map((c, k) => (
              <div key={`${hand}-${k}-${faceUp && !!c}`} className={human ? "" : k ? "rotate-[10deg]" : "-rotate-[4deg]"}>
                <Card
                  c={faceUp ? c : undefined}
                  size={human ? "lg" : "sm"}
                  delay={faceUp && !human ? 0 : dealDelay(k)}
                  win={faceUp && winCards.has(c)}
                  dim={faceUp && !!c && winCards.size > 0 && !winCards.has(c)}
                />
              </div>
            ))}
          </div>
        )}
        {badge && (
          <span
            key={thinking ? "thinking" : badge}
            className={`anim-pop absolute origin-right whitespace-nowrap ${human ? "right-full top-[55%] mr-9" : "right-[68%] top-0"} rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide shadow ${thinking ? "bg-cream text-wine" : "bg-gold text-wine"}`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-1 w-full overflow-hidden rounded-lg bg-black/70 px-2 py-0.5 text-center shadow ring-1 ring-gold/30">
        <div className="truncate text-[11px] text-cream/80 sm:text-xs">{label}</div>
        <div className="font-display text-sm text-gold sm:text-base">{sittingOut && !p.stack ? "BUSTED" : p.stack.toLocaleString()}</div>
        {timer && (
          <div key={timer.id} className="timer-bar absolute inset-x-0 bottom-0" style={{ animationDuration: `${timer.limitMs}ms`, animationDelay: `-${timer.elapsedMs}ms` }} />
        )}
      </div>
    </div>
  );
}

function Chips({ amount, plus }: { amount: number; plus?: boolean }) {
  return (
    <span className={`flex items-center gap-1 whitespace-nowrap rounded-full bg-black/60 py-0.5 pl-0.5 pr-2 font-display text-sm shadow-md sm:text-base ${plus ? "text-gold" : "text-cream"}`}>
      <span className="chip text-lg" />
      {plus && "+"}
      {amount.toLocaleString()}
    </span>
  );
}

/** Your controls when it's your turn: raise sizing, Fold / Check-Call / Raise (F, C, R on the keyboard) and the countdown. */
export function ActionBar({ game, deadline, onAct, onTick, hotkeys = true }: { game: Game; deadline: number; onAct: (a: Action) => void; onTick?: () => void; hotkeys?: boolean }) {
  const lg = legal(game);
  const [raiseTo, setRaiseTo] = useState(0);
  const [now, setNow] = useState(0);
  const to = clampTo(lg, raiseTo);
  const committed = game.players.reduce((s, p) => s + p.committed, 0);
  const quick: [string, number][] = [
    ["Min", lg.minTo],
    ["½ Pot", game.currentBet + Math.round((committed + lg.owe) / 2)],
    ["Pot", game.currentBet + committed + lg.owe],
    ["Max", lg.maxTo],
  ];
  const secondsLeft = now ? Math.ceil(Math.max(0, deadline - now) / 1000) : null;

  const tick = useEffectEvent(() => onTick?.());
  const key = useEffectEvent((e: KeyboardEvent) => {
    if (!hotkeys || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest("input:not([type=range]), select, textarea")) return;
    const k = e.key.toLowerCase();
    if (k === "f" && lg.owe > 0) onAct({ type: "fold" });
    else if (k === "c") onAct({ type: lg.owe ? "call" : "check" });
    else if (k === "r" && lg.canRaise) onAct({ type: "raise", amount: to });
    else return;
    e.preventDefault();
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    const left = deadline - Date.now();
    const ticks = [5, 4, 3, 2, 1].filter((s) => left > s * 1000).map((s) => setTimeout(() => tick(), left - s * 1000)); // the last five seconds
    return () => {
      clearInterval(id);
      ticks.forEach(clearTimeout);
    };
  }, [deadline]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => key(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {lg.canRaise && (
        <div className="anim-rise flex flex-wrap items-center justify-end gap-2 rounded-2xl bg-black/60 p-2 ring-1 ring-gold/30">
          {quick.map(([text, amount]) => (
            <button key={text} onClick={() => setRaiseTo(amount)} className="rounded-full bg-wine px-3 py-1 text-sm ring-1 ring-gold/40 transition-colors hover:bg-[#5a121b]">
              {text}
            </button>
          ))}
          <input type="range" aria-label="Raise amount" min={lg.minTo} max={lg.maxTo} value={to} onChange={(e) => setRaiseTo(Number(e.target.value))} className="w-36 accent-gold sm:w-48" />
        </div>
      )}
      <div className="anim-rise flex items-end gap-4 sm:gap-6">
        <div className="mb-2 flex min-w-10 flex-col items-center" aria-hidden>
          <span className={`font-display text-2xl tabular-nums transition-colors ${secondsLeft !== null && secondsLeft <= 5 ? "text-red-300" : "text-cream"}`}>{secondsLeft ?? ""}s</span>
          <span className="text-[10px] uppercase tracking-wider text-cream/50">to act</span>
        </div>
        {lg.owe > 0 && <ActionButton label="Fold" hotkey="F" icon="x" onClick={() => onAct({ type: "fold" })} />}
        <ActionButton label={lg.owe ? `Call ${lg.owe.toLocaleString()}` : "Check"} hotkey="C" icon="check" onClick={() => onAct({ type: lg.owe ? "call" : "check" })} />
        {lg.canRaise && (
          <ActionButton label={to === lg.maxTo ? "All-in" : `${game.currentBet ? "Raise" : "Bet"} ${to.toLocaleString()}`} hotkey="R" icon="up" onClick={() => onAct({ type: "raise", amount: to })} />
        )}
      </div>
    </>
  );
}

function ActionButton({ label, hotkey, icon, onClick }: { label: string; hotkey: string; icon: "x" | "check" | "up"; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-keyshortcuts={hotkey} className="flex flex-col items-center gap-1.5">
      <span className="flex items-center gap-1.5 font-display text-lg tracking-wide drop-shadow sm:text-xl">
        {label}
        <kbd className="rounded border border-cream/30 px-1 font-sans text-[10px] leading-4 text-cream/60">{hotkey}</kbd>
      </span>
      <span className="round-btn">
        <Icon name={icon} className="h-7 w-7" />
      </span>
    </button>
  );
}

/** Who's up or down: chips now (counting chips in the pot) minus everything brought in, rebuys and top-offs included. */
export function StatsPanel({ game, labels }: { game: Game; labels: string[] }) {
  const net = (p: Player) => p.stack + (game.street === "done" ? 0 : p.committed) - p.buyIn;
  return (
    <aside aria-label="Who's up" className="anim-rise fixed right-3 top-16 z-30 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl bg-black/75 p-4 text-sm ring-1 ring-gold/25 backdrop-blur sm:right-6">
      <h2 className="mb-2 font-display tracking-wider text-gold">WHO&apos;S UP</h2>
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-cream/50">
            <th className="pb-1 font-normal">Player</th>
            <th className="pb-1 text-right font-normal">Chips</th>
            <th className="pb-1 text-right font-normal">Net</th>
            <th className="pb-1 text-right font-normal">Rebuys</th>
          </tr>
        </thead>
        <tbody>
          {game.players
            .map((p, i) => ({ p, i, net: net(p) }))
            .toSorted((a, b) => b.net - a.net)
            .map(({ p, i, net }) => (
              <tr key={i} className="border-t border-white/5">
                <td className="py-1.5">{labels[i]}</td>
                <td className="py-1.5 text-right tabular-nums">{p.stack.toLocaleString()}</td>
                <td className={`py-1.5 text-right font-display tabular-nums ${net > 0 ? "text-emerald-300" : net < 0 ? "text-red-300" : "text-cream/60"}`}>
                  {net > 0 ? "+" : ""}
                  {net.toLocaleString()}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.rebuys}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-cream/50">Net = chips now (counting chips in this pot) minus everything brought in, rebuys and top-offs included.</p>
    </aside>
  );
}

/** "Table talk": the running log, newest at the bottom, and screen-reader announcements of each new line. */
export function LogPanel({ entries, open, onToggle, hidden, yourTurn }: { entries: LogEntry[]; open: boolean; onToggle: () => void; hidden?: boolean; yourTurn?: { key: string; text: string } }) {
  return (
    <>
      <aside className={`fixed bottom-3 left-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] sm:bottom-5 sm:left-6 ${hidden ? "hidden sm:block" : ""}`}>
        {open && (
          <ol aria-label="Table log" className="anim-rise mb-2 flex max-h-[30vh] flex-col-reverse overflow-y-auto rounded-2xl bg-black/65 p-3 text-sm ring-1 ring-gold/25 backdrop-blur">
            {entries.toReversed().map((e) => (
              <li key={e.id} className={e.kind === "hand" ? "mt-3 font-display tracking-wider text-gold" : e.kind === "error" ? "py-0.5 text-red-300" : "py-0.5 text-cream/90"}>
                {e.text}
                {e.say && <span className="block pl-3 italic text-cream/65">“{e.say}”</span>}
              </li>
            ))}
          </ol>
        )}
        <button onClick={onToggle} className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm ring-1 ring-gold/30 transition-colors hover:bg-black/80" aria-expanded={open}>
          <Icon name="list" className="h-5 w-5" /> Table talk
        </button>
      </aside>
      {/* screen readers hear each action as it happens, and when it's their turn */}
      <ol aria-live="polite" aria-relevant="additions" className="sr-only">
        {entries.slice(-6).map((e) => (
          <li key={e.id}>
            {e.text}
            {e.say && `. They say: ${e.say}`}
          </li>
        ))}
        {yourTurn && <li key={yourTurn.key}>{yourTurn.text}</li>}
      </ol>
    </>
  );
}

export function HeaderButton({ label, icon, onClick, pressed }: { label: string; icon: "play" | "pause" | "restart" | "sliders" | "sound" | "muted" | "stats" | "link"; onClick: () => void; pressed?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} aria-pressed={pressed} className="header-btn">
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

/** "Your turn. 40 to call. ..." for screen readers; a new key every turn so it is announced again. */
export function yourTurnLine(game: Game, me: number) {
  if (me < 0 || game.turn !== me || game.street === "done") return undefined;
  const { owe } = legal(game);
  return { key: `${game.hand}-${game.history.length}`, text: `Your turn. ${owe ? `${owe} to call.` : "You can check."} Press F to fold, C to ${owe ? "call" : "check"}, R to raise.` };
}
