"use client";

// The poker table UI shared by bot matches (/play) and friend tables (/t/[code]).
import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { isShowdown, legal, potTotal, type Action, type Game, type LegalOptions, type Player, type Winner } from "@/lib/poker";
import { play, unlockAudio, type Sound } from "@/lib/sound";
import { BrandName, Card, DIMS, Icon, SpadeBadge, netColor, type IconName } from "./ui";

/** A spot on the table, in % of the table box. */
type Point = { x: number; y: number };
/** A running turn clock, drawn as a shrinking bar under that seat's name. */
export type Timer = { id: string; seat: number; limitMs: number; elapsedMs: number };
export type LogEntry = { id: number; text: string; say?: string; kind?: "hand" | "error" };

const POT: Point = { x: 50, y: 39 }; // where the pot pill sits
const BOARD_DELAY = [0, 110, 220, 0, 0]; // flop cards land one after another
const CHIPS_NEAR_YOU = 0.45; // your bet and winnings sit this far out: further and your own big cards hide them
const DEAL_STEP_MS = 70; // between hole cards as they go round the table
const DEAL_FLIGHT_MS = 320; // a card's trip from the deck to a seat (matches .deal-fly in globals.css)
const FLICK_MS = 240; // one flick of the dealer's hand (matches .robot-flick in globals.css)
const SOUND_GAP_MS = 140; // between sounds for one game update

/** Seats are evenly spaced around the oval: position 0 at the bottom, then clockwise. */
const seatAngle = (position: number, count: number) => Math.PI / 2 + (position * 2 * Math.PI) / count;

/**
 * Where the robot dealer stands, without moving any seat: top center when that spot is free (an odd number of
 * players); otherwise someone sits there, so the dealer stands in the gap to their left.
 */
function dealerAngle(count: number): number {
  const top = (3 * Math.PI) / 2;
  if (count % 2 === 1) {
    return top;
  }
  const halfGap = Math.PI / count;
  return top - Math.min(halfGap, Math.PI / 4);
}

/** The point at `angle` on an oval of `radius` (1 = the rim), in % of the table box. */
function pointOnOval(angle: number, radius: number): Point {
  return { x: 50 + 50 * radius * Math.cos(angle), y: 50 + 50 * radius * Math.sin(angle) };
}

const place = (point: Point): CSSProperties => ({ left: `${point.x}%`, top: `${point.y}%` });

/**
 * Style for a hole card flying from the dealer's deck to a seat. The deck is drawn with the robot, a fixed
 * distance below its spot on the rim (--deck-drop in globals.css), so the start is offset from `dealerSpot`.
 */
function flyFromDeck(dealerSpot: Point, to: Point, delay: number) {
  return {
    ...place(to),
    "--fx": `${dealerSpot.x}%`,
    "--fy": `calc(${dealerSpot.y}% + var(--deck-drop))`,
    "--tx": `${to.x}%`,
    "--ty": `${to.y}%`,
    animationDelay: `${delay}ms, ${delay + DEAL_FLIGHT_MS}ms`,
  } as CSSProperties;
}

/** Style for a `.fly` element: slides from one table point to another, resting at `to`. */
function fly(from: Point, to: Point) {
  return { ...place(to), "--fx": `${from.x}%`, "--fy": `${from.y}%`, "--tx": `${to.x}%`, "--ty": `${to.y}%` } as CSSProperties;
}

export const clampTo = (options: LegalOptions, amount: number) => Math.min(options.maxTo, Math.max(options.minTo, amount));

// The first pattern a history line matches picks its sound.
const SOUND_PATTERNS: [RegExp, Sound][] = [
  [/ wins /, "win"],
  [/ folds/, "fold"],
  [/ checks/, "check"],
  [/ (calls|bets|raises)/, "chip"],
  [/^(flop|turn|river): /, "card"],
];
const soundFor = (line: string) => SOUND_PATTERNS.find(([pattern]) => pattern.test(line))?.[1];

const MUTE_KEY = "agent-holdem-muted";
const muteListeners = new Set<() => void>();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeToMute(listener: () => void) {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/** Sound on/off, remembered in this browser (shared by every table page). */
export function useMuted(): [boolean, () => void] {
  const muted = useSyncExternalStore(subscribeToMute, readMuted, () => false);
  const toggle = () => {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "0" : "1");
    } catch {
      // storage blocked: the change is lost on reload, nothing else breaks
    }
    muteListeners.forEach((listener) => listener());
  };
  return [muted, toggle];
}

/** Plays the table's sounds for whatever changed since the last game state. Browsers allow audio only after a click or key press. */
export function useTableSounds(game: Game | null, me: number, muted: boolean) {
  const previousGame = useRef<Game | null>(null);

  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    const before = previousGame.current;
    previousGame.current = game;
    if (!before || !game || before === game || muted) {
      return;
    }
    const newHand = before.hand !== game.hand;
    const newLines = game.history.slice(before.history.length);
    const lineSounds = newLines.map(soundFor).filter((sound): sound is Sound => !!sound);
    const sounds: Sound[] = newHand ? ["deal"] : [...new Set(lineSounds)];
    const turnJustCame = before.turn !== me || before.street !== game.street || newHand;
    if (me >= 0 && game.turn === me && turnJustCame) {
      sounds.push("turn");
    }
    sounds.forEach((sound, i) => setTimeout(() => play(sound), i * SOUND_GAP_MS));
  }, [game, me, muted]);
}

type TableViewProps = {
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
};

/** Felt, board, pot, chips in motion, dealer button and seats. Seat `me` is drawn at the bottom (-1 = just watching). */
export function TableView({ game, me, labels, colors, reveal, thinking, timer, bubbles, paused, onResume }: TableViewProps) {
  const seatCount = game.players.length;
  /** Where something for `seat` sits, turning the table so your own seat is at the bottom. */
  const seatPoint = (seat: number, radius: number, rotation = 0) => {
    const position = me >= 0 ? (seat - me + seatCount) % seatCount : seat;
    return pointOnOval(seatAngle(position, seatCount) + rotation, radius);
  };
  const dealerSpot = pointOnOval(dealerAngle(seatCount), 1);
  const dealtCards = game.players.reduce((sum, player) => sum + player.cards.length, 0);
  const holeCardsMs = dealtCards ? (dealtCards - 1) * DEAL_STEP_MS + DEAL_FLIGHT_MS : 0;
  // The dealer's hand flicks for as long as hole cards are going out, then once per board card.
  const flicks = { preflop: Math.ceil(holeCardsMs / FLICK_MS), flop: 3, turn: 1, river: 1, done: 0 }[game.street];
  const pot = potTotal(game);
  const showdown = isShowdown(game);
  const winningSeats = new Set(game.winners.map((winner) => winner.seat));
  const winningCards = new Set(game.winners.flatMap((winner) => winner.cards));
  // Hole cards go out one at a time starting left of the button, twice around.
  const dealDelay = (seat: number, round: number) => (round * seatCount + ((seat - game.dealer - 1 + seatCount) % seatCount)) * DEAL_STEP_MS;
  const winnerLine = (winner: Winner) => {
    const who = winner.seat === me ? "You win" : `${labels[winner.seat]} wins`;
    const withHand = winner.hand ? ` · ${winner.hand}` : "";
    return `${who} ${winner.amount.toLocaleString()}${withHand}`;
  };
  const thinkingText = thinking?.secs === undefined ? "thinking" : `thinking ${thinking.secs}s`;
  /** How far out chips sit for `seat`: closer in for you, since your own big cards cover the edge of your seat. */
  const chipRadius = (seat: number, usual: number) => (seat === me ? CHIPS_NEAR_YOU : usual);

  return (
    <div className="table-box">
      {/* drawn before the rail, so the table hides the dealer's lower half */}
      <RobotDealer hand={game.hand} style={place(dealerSpot)} />
      <div className="rail absolute inset-0 rounded-[50%] p-[2.4%]">
        <div className="felt relative h-full w-full rounded-[50%]">
          <div className="absolute inset-[6%] rounded-[50%] border-2 border-[#ffd9a8]/15" />
          <div className="absolute left-1/2 top-[24%] -translate-x-1/2 select-none whitespace-nowrap font-display text-[clamp(12px,2.2vw,24px)] tracking-[.35em] text-black/25">
            AGENT HOLD&apos;EM
          </div>
        </div>
      </div>
      <RobotHands key={`${game.hand}-${game.street}`} flicks={flicks} style={place(dealerSpot)} />

      <div className="absolute left-1/2 top-1/2 z-[6] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 sm:gap-3">
        {game.winners.length > 0 && (
          <div
            key={`win-${game.hand}`}
            className="anim-pop whitespace-nowrap rounded-full bg-black/65 px-4 py-1 text-center font-display text-sm text-gold shadow-lg sm:text-lg"
          >
            {game.winners.map(winnerLine).join("   |   ")}
          </div>
        )}
        {game.winners.length === 0 && (
          <div className="flex items-center gap-2 rounded-full bg-black/50 px-4 py-1 font-display text-base sm:text-xl">
            <span className="chip" /> POT {pot.toLocaleString()}
          </div>
        )}
        <div className="flex gap-1 sm:gap-1.5">
          {[0, 1, 2, 3, 4].map((k) => {
            const card = game.board[k];
            if (!card) {
              return <div key={k} className={`slot ${DIMS.md}`} />;
            }
            return (
              <Card
                key={`${game.hand}-${card}`}
                card={card}
                size="md"
                delay={BOARD_DELAY[k]}
                win={winningCards.has(card)}
                dim={winningCards.size > 0 && !winningCards.has(card)}
              />
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

      {/* hole cards: the dealer sends them round the table from the deck, two each, starting left of the button */}
      {game.street === "preflop" &&
        game.players.flatMap((player, seat) =>
          player.cards.map((_, round) => {
            const delay = dealDelay(seat, round);
            return (
              <div
                key={`${game.hand}-deal-${seat}-${round}`}
                className="fly deal-fly z-[9]"
                style={flyFromDeck(dealerSpot, seatPoint(seat, 0.97), delay)}
              >
                <div className={`card-back ${DIMS.sm}`} />
              </div>
            );
          }),
        )}

      {/* chips: into a bet, bets into the pot at the end of a street, the pot out to the winners */}
      {game.players.map(
        (player, seat) =>
          player.bet > 0 && (
            <div key={`${game.hand}-${seat}-${player.bet}`} className="fly chips-in z-[5]" style={fly(seatPoint(seat, 0.84), seatPoint(seat, chipRadius(seat, 0.6)))}>
              <Chips amount={player.bet} />
            </div>
          ),
      )}
      {game.swept.map((bet) => (
        <div key={`${game.hand}-${bet.street}-${bet.seat}`} className="fly chips-sweep z-[5]" style={fly(seatPoint(bet.seat, chipRadius(bet.seat, 0.6)), POT)}>
          <Chips amount={bet.amount} />
        </div>
      ))}
      {game.street === "done" &&
        game.winners.map((winner) => (
          <div key={`${game.hand}-won-${winner.seat}`} className="fly chips-win z-[7]" style={fly(POT, seatPoint(winner.seat, chipRadius(winner.seat, 0.78)))}>
            <Chips amount={winner.amount} plus />
          </div>
        ))}

      {game.hand > 0 && (
        <div
          className="dealer-btn absolute z-[5] grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-xs font-black text-zinc-800 shadow-md ring-2 ring-zinc-300"
          style={place(seatPoint(game.dealer, 0.74, 0.3))}
        >
          D
        </div>
      )}

      {game.players.map((player, seat) => (
        <Seat
          key={seat}
          player={player}
          label={labels[seat]}
          human={seat === me}
          color={colors[seat]}
          thinking={thinking?.seat === seat && paused == null ? thinkingText : undefined}
          won={winningSeats.has(seat)}
          bubble={bubbles?.get(seat)}
          faceUp={seat === me || !!reveal || (showdown && !player.folded)}
          winningCards={winningCards}
          hand={game.hand}
          dealDelay={(round) => dealDelay(seat, round) + DEAL_FLIGHT_MS}
          timer={timer?.seat === seat && paused == null ? timer : undefined}
          style={place(seatPoint(seat, 1))}
        />
      ))}
    </div>
  );
}

/** The robot dealer, dressed for the casino, standing behind the table at `style`'s point on the rim. Its eyes flash as each new hand is dealt. */
function RobotDealer({ hand, style }: { hand: number; style: CSSProperties }) {
  return (
    <div className="robot-dealer pointer-events-none absolute" style={style} aria-hidden>
      <svg viewBox="0 0 120 160" className="h-auto w-full">
        <defs>
          <linearGradient id="robot-metal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4efe6" />
            <stop offset="0.55" stopColor="#c9c2b6" />
            <stop offset="1" stopColor="#8d857a" />
          </linearGradient>
        </defs>
        <rect x="53" y="48" width="14" height="13" fill="#8d857a" stroke="#2a0a0c" strokeWidth="2" />
        {/* white shirt, black waistcoat with gold trim, bow tie and a gold name badge */}
        <path d="M8 160 C10 92 26 64 46 60 H74 C94 64 110 92 112 160 Z" fill="#f4efe6" stroke="#2a0a0c" strokeWidth="2.5" />
        <path d="M24 76 C30 66 38 62 46 60 L58 100 V160 H14 C14 120 17 92 24 76 Z" fill="#1c1517" stroke="#c99a4a" strokeWidth="1.5" />
        <path d="M96 76 C90 66 82 62 74 60 L62 100 V160 H106 C106 120 103 92 96 76 Z" fill="#1c1517" stroke="#c99a4a" strokeWidth="1.5" />
        <circle cx="60" cy="80" r="1.4" fill="#c9c2b6" />
        <circle cx="60" cy="90" r="1.4" fill="#c9c2b6" />
        <path d="M49 57 L60 65 L52 70 Z M71 57 L60 65 L68 70 Z" fill="#ffffff" stroke="#c9c2b6" strokeWidth="1" />
        <path d="M47 61 L60 66 L47 71 Z M73 61 L60 66 L73 71 Z" fill="#121012" />
        <rect x="56.5" y="63.5" width="7" height="5" rx="1.5" fill="#2b2326" />
        <rect x="76" y="73" width="18" height="6" rx="1.5" fill="#e8c27a" />
        <path d="M79 76h12" stroke="#7a5a26" strokeWidth="1.2" />
        <g className="robot-head">
          <line x1="60" y1="5" x2="60" y2="15" stroke="#8d857a" strokeWidth="3" strokeLinecap="round" />
          <circle className="robot-light" cx="60" cy="5" r="4.5" fill="#ffd27a" />
          <rect x="21" y="26" width="11" height="16" rx="4" fill="#8d857a" stroke="#2a0a0c" strokeWidth="2" />
          <rect x="88" y="26" width="11" height="16" rx="4" fill="#8d857a" stroke="#2a0a0c" strokeWidth="2" />
          <rect x="28" y="13" width="64" height="40" rx="16" fill="url(#robot-metal)" stroke="#2a0a0c" strokeWidth="2.5" />
          <rect x="36" y="21" width="48" height="19" rx="9.5" fill="#1a0508" />
          <g key={hand} className="robot-look">
            <rect className="robot-eye" x="44" y="25.5" width="10" height="10" rx="5" fill="#ffd27a" />
            <rect className="robot-eye" x="66" y="25.5" width="10" height="10" rx="5" fill="#ffd27a" />
          </g>
          <path d="M52 45 Q60 50 68 45" fill="none" stroke="#6b645b" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}

type Joint = { x: number; y: number };

const SLEEVE = "#f4efe6";
const OUTLINE = "#2a0a0c";

/** A point `t` of the way from `a` to `b`. */
const between = (a: Joint, b: Joint, t: number): Joint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** One sleeve segment, outlined, as thick round-ended strokes. */
function Sleeve({ from, to }: { from: Joint; to: Joint }) {
  return (
    <>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={OUTLINE} strokeWidth="16" strokeLinecap="round" />
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={SLEEVE} strokeWidth="12" strokeLinecap="round" />
    </>
  );
}

type DealerArmProps = {
  shoulder: Joint;
  elbow: Joint; // out to the side, resting on the rail
  wrist: Joint; // on the felt, beside the deck
  dealing?: { flicks: number }; // the forearm swings out from the elbow this many times
};

/**
 * A casino dealer's arm: white shirt sleeve with a gold garter above the elbow, a black cuff, and a metal mitten
 * of a hand. The upper arm hangs from the shoulder, the forearm rests on the table, angled in toward the deck.
 */
function DealerArm({ shoulder, elbow, wrist, dealing }: DealerArmProps) {
  const garterFrom = between(shoulder, elbow, 0.45);
  const garterTo = between(shoulder, elbow, 0.62);
  const cuffFrom = between(elbow, wrist, 0.72);
  const handAngle = (Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) * 180) / Math.PI;
  const hand = between(elbow, wrist, 1.22);
  return (
    <>
      <Sleeve from={shoulder} to={elbow} />
      <line x1={garterFrom.x} y1={garterFrom.y} x2={garterTo.x} y2={garterTo.y} stroke="#c99a4a" strokeWidth="12" />
      <g
        className={dealing ? "robot-flick" : undefined}
        style={dealing ? { animationIterationCount: dealing.flicks, transformOrigin: `${elbow.x}px ${elbow.y}px` } : undefined}
      >
        <Sleeve from={elbow} to={wrist} />
        <line x1={cuffFrom.x} y1={cuffFrom.y} x2={wrist.x} y2={wrist.y} stroke="#121012" strokeWidth="12" strokeLinecap="round" />
        {/* covers where the forearm's outline crosses the upper sleeve, so the elbow bends smoothly */}
        <circle cx={elbow.x} cy={elbow.y} r="6" fill={SLEEVE} />
        {dealing && (
          <rect
            x={hand.x - 3}
            y={hand.y - 4}
            width="15"
            height="10"
            rx="2"
            fill="#a3182a"
            stroke="#f3dcb5"
            strokeWidth="1.5"
            transform={`rotate(${handAngle} ${hand.x} ${hand.y})`}
          />
        )}
        <ellipse
          cx={hand.x}
          cy={hand.y}
          rx="8"
          ry="6.5"
          fill="url(#robot-metal)"
          stroke={OUTLINE}
          strokeWidth="2"
          transform={`rotate(${handAngle} ${hand.x} ${hand.y})`}
        />
      </g>
    </>
  );
}

/**
 * The dealer's arms and hands, in front of the rail, either side of the deck it deals from. Same box as RobotDealer,
 * so they line up. The left forearm flicks `flicks` times as cards go out (remount it to deal again).
 */
function RobotHands({ flicks, style }: { flicks: number; style: CSSProperties }) {
  return (
    <div className="robot-hands pointer-events-none absolute z-[5]" style={style} aria-hidden>
      <svg viewBox="0 0 120 160" className="h-auto w-full">
        {/* the deck, lying on the felt */}
        <rect x="51" y="128" width="20" height="13" rx="2" fill="#6e0d18" stroke="#f3dcb5" strokeWidth="1.5" />
        <rect x="50" y="126" width="20" height="13" rx="2" fill="#a3182a" stroke="#f3dcb5" strokeWidth="1.5" />
        <DealerArm shoulder={{ x: 94, y: 70 }} elbow={{ x: 106, y: 101 }} wrist={{ x: 86, y: 122 }} />
        <DealerArm shoulder={{ x: 26, y: 70 }} elbow={{ x: 14, y: 101 }} wrist={{ x: 34, y: 122 }} dealing={{ flicks }} />
      </svg>
    </div>
  );
}

type SeatProps = {
  player: Player;
  label: string;
  human: boolean; // your own seat: bigger cards, drawn differently
  color: string;
  thinking?: string; // badge text while this seat is deciding
  won: boolean;
  bubble?: string;
  faceUp: boolean;
  winningCards: Set<string>;
  hand: number;
  dealDelay: (round: number) => number;
  timer?: Timer;
  style: CSSProperties;
};

function Seat({ player, label, human, color, thinking, won, bubble, faceUp, winningCards, hand, dealDelay, timer, style }: SeatProps) {
  const sittingOut = !player.cards.length;
  const faded = (player.folded && !won) || sittingOut;
  const badge = thinking ?? player.last;
  const cardsPosition = human ? "absolute bottom-[40%] left-1/2 flex -translate-x-1/2 gap-0.5" : "absolute left-[62%] top-[-12%] flex -space-x-3";
  const badgePosition = human ? "right-full top-[55%] mr-9" : "right-[68%] top-0";
  const badgeColors = thinking ? "bg-cream text-wine" : "bg-gold text-wine";
  /** Other players' two cards fan out slightly. */
  const cardTilt = (round: number) => {
    if (human) {
      return "";
    }
    return round ? "rotate-[10deg]" : "-rotate-[4deg]";
  };

  return (
    <div
      className={`absolute z-10 flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-opacity duration-300 sm:w-28 ${faded ? "opacity-55" : ""}`}
      style={style}
    >
      {bubble && (
        <div
          key={bubble}
          className="anim-pop bubble absolute bottom-full z-20 mb-3 w-max max-w-44 origin-bottom rounded-xl bg-[#fff7e6] px-2.5 py-1.5 text-center text-xs font-bold text-zinc-900 shadow-lg"
        >
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
        {!player.folded && !sittingOut && (
          <div className={cardsPosition}>
            {player.cards.map((card, round) => (
              <div key={`${hand}-${round}-${faceUp && !!card}`} className={cardTilt(round)}>
                <Card
                  card={faceUp ? card : undefined}
                  size={human ? "lg" : "sm"}
                  delay={faceUp && !human ? 0 : dealDelay(round)}
                  win={faceUp && winningCards.has(card)}
                  dim={faceUp && !!card && winningCards.size > 0 && !winningCards.has(card)}
                />
              </div>
            ))}
          </div>
        )}
        {badge && (
          <span
            key={thinking ? "thinking" : badge}
            className={`anim-pop absolute origin-right whitespace-nowrap ${badgePosition} rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide shadow ${badgeColors}`}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="relative z-10 mt-1 w-full overflow-hidden rounded-lg bg-black/70 px-2 py-0.5 text-center shadow ring-1 ring-gold/30">
        <div className="truncate text-[11px] text-cream/80 sm:text-xs">{label}</div>
        <div className="font-display text-sm text-gold sm:text-base">{sittingOut && !player.stack ? "BUSTED" : player.stack.toLocaleString()}</div>
        {timer && (
          <div
            key={timer.id}
            className="timer-bar absolute inset-x-0 bottom-0"
            style={{ animationDuration: `${timer.limitMs}ms`, animationDelay: `-${timer.elapsedMs}ms` }}
          />
        )}
      </div>
    </div>
  );
}

function Chips({ amount, plus }: { amount: number; plus?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1 whitespace-nowrap rounded-full bg-black/60 py-0.5 pl-0.5 pr-2 font-display text-sm shadow-md sm:text-base ${plus ? "text-gold" : "text-cream"}`}
    >
      <span className="chip text-lg" />
      {plus && "+"}
      {amount.toLocaleString()}
    </span>
  );
}

type ActionBarProps = {
  game: Game;
  deadline: number; // epoch ms when your time runs out
  onAct: (action: Action) => void;
  onTick?: () => void; // each of the last five seconds
  hotkeys?: boolean;
};

/** Your controls when it's your turn: raise sizing, Fold / Check-Call / Raise (F, C, R on the keyboard) and the countdown. */
export function ActionBar({ game, deadline, onAct, onTick, hotkeys = true }: ActionBarProps) {
  const options = legal(game);
  const [raiseInput, setRaiseInput] = useState(0);
  const [now, setNow] = useState(0);
  const raiseTo = clampTo(options, raiseInput);
  const pot = potTotal(game);
  const quickSizes: [string, number][] = [
    ["Min", options.minTo],
    ["½ Pot", game.currentBet + Math.round((pot + options.owe) / 2)],
    ["Pot", game.currentBet + pot + options.owe],
    ["Max", options.maxTo],
  ];
  const secondsLeft = now ? Math.ceil(Math.max(0, deadline - now) / 1000) : null;
  const callOrCheck: Action = { type: options.owe ? "call" : "check" };
  const raise: Action = { type: "raise", amount: raiseTo };

  let raiseLabel = `${game.currentBet ? "Raise" : "Bet"} ${raiseTo.toLocaleString()}`;
  if (raiseTo === options.maxTo) {
    raiseLabel = "All-in";
  }

  const tick = useEffectEvent(() => onTick?.());
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!hotkeys || e.repeat || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    if (e.target instanceof Element && e.target.closest("input:not([type=range]), select, textarea")) {
      return; // typing somewhere else
    }
    const key = e.key.toLowerCase();
    if (key === "f" && options.owe > 0) {
      onAct({ type: "fold" });
    } else if (key === "c") {
      onAct(callOrCheck);
    } else if (key === "r" && options.canRaise) {
      onAct(raise);
    } else {
      return;
    }
    e.preventDefault();
  });

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 250);
    const msLeft = deadline - Date.now();
    // a tick for each of the last five seconds
    const warnings = [5, 4, 3, 2, 1].filter((seconds) => msLeft > seconds * 1000).map((seconds) => setTimeout(() => tick(), msLeft - seconds * 1000));
    return () => {
      clearInterval(clock);
      warnings.forEach(clearTimeout);
    };
  }, [deadline]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      {options.canRaise && (
        <div className="anim-rise flex flex-wrap items-center justify-end gap-2 rounded-2xl bg-black/60 p-2 ring-1 ring-gold/30">
          {quickSizes.map(([text, amount]) => (
            <button
              key={text}
              onClick={() => setRaiseInput(amount)}
              className="rounded-full bg-wine px-3 py-1 text-sm ring-1 ring-gold/40 transition-colors hover:bg-[#5a121b]"
            >
              {text}
            </button>
          ))}
          <input
            type="range"
            aria-label="Raise amount"
            min={options.minTo}
            max={options.maxTo}
            value={raiseTo}
            onChange={(e) => setRaiseInput(Number(e.target.value))}
            className="w-36 accent-gold sm:w-48"
          />
        </div>
      )}
      <div className="anim-rise flex items-end gap-4 sm:gap-6">
        <div className="mb-2 flex min-w-10 flex-col items-center" aria-hidden>
          <span className={`font-display text-2xl tabular-nums transition-colors ${secondsLeft !== null && secondsLeft <= 5 ? "text-red-300" : "text-cream"}`}>
            {secondsLeft ?? ""}s
          </span>
          <span className="text-[10px] uppercase tracking-wider text-cream/50">to act</span>
        </div>
        {options.owe > 0 && <ActionButton label="Fold" hotkey="F" icon="x" onClick={() => onAct({ type: "fold" })} />}
        <ActionButton
          label={options.owe ? `Call ${options.owe.toLocaleString()}` : "Check"}
          hotkey="C"
          icon="check"
          onClick={() => onAct(callOrCheck)}
        />
        {options.canRaise && <ActionButton label={raiseLabel} hotkey="R" icon="up" onClick={() => onAct(raise)} />}
      </div>
    </>
  );
}

function ActionButton({ label, hotkey, icon, onClick }: { label: string; hotkey: string; icon: IconName; onClick: () => void }) {
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
  const netOf = (player: Player) => {
    const inPot = game.street === "done" ? 0 : player.committed;
    return player.stack + inPot - player.buyIn;
  };
  const rows = game.players.map((player, seat) => ({ player, seat, net: netOf(player) })).toSorted((a, b) => b.net - a.net);

  return (
    <aside
      aria-label="Who's up"
      className="anim-rise fixed right-3 top-16 z-30 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl bg-black/75 p-4 text-sm ring-1 ring-gold/25 backdrop-blur sm:right-6"
    >
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
          {rows.map(({ player, seat, net }) => (
            <tr key={seat} className="border-t border-white/5">
              <td className="py-1.5">{labels[seat]}</td>
              <td className="py-1.5 text-right tabular-nums">{player.stack.toLocaleString()}</td>
              <td className={`py-1.5 text-right font-display tabular-nums ${netColor(net)}`}>
                {net > 0 ? "+" : ""}
                {net.toLocaleString()}
              </td>
              <td className="py-1.5 text-right tabular-nums">{player.rebuys}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-cream/50">Net = chips now (counting chips in this pot) minus everything brought in, rebuys and top-offs included.</p>
    </aside>
  );
}

const ENTRY_STYLES = {
  hand: "mt-3 font-display tracking-wider text-gold",
  error: "py-0.5 text-red-300",
  line: "py-0.5 text-cream/90",
};

type LogPanelProps = {
  entries: LogEntry[];
  open: boolean;
  onToggle: () => void;
  hidden?: boolean; // hidden on phones (your action bar needs the room)
  yourTurn?: { key: string; text: string };
};

/** "Table talk": the running log, newest at the bottom, and screen-reader announcements of each new line. */
export function LogPanel({ entries, open, onToggle, hidden, yourTurn }: LogPanelProps) {
  return (
    <>
      <aside className={`fixed bottom-3 left-3 z-30 w-[min(22rem,calc(100vw-1.5rem))] sm:bottom-5 sm:left-6 ${hidden ? "hidden sm:block" : ""}`}>
        {open && (
          <ol
            aria-label="Table log"
            className="anim-rise mb-2 flex max-h-[30vh] flex-col-reverse overflow-y-auto rounded-2xl bg-black/65 p-3 text-sm ring-1 ring-gold/25 backdrop-blur"
          >
            {entries.toReversed().map((entry) => (
              <li key={entry.id} className={ENTRY_STYLES[entry.kind ?? "line"]}>
                {entry.text}
                {entry.say && <span className="block pl-3 italic text-cream/65">“{entry.say}”</span>}
              </li>
            ))}
          </ol>
        )}
        <button
          onClick={onToggle}
          className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm ring-1 ring-gold/30 transition-colors hover:bg-black/80"
          aria-expanded={open}
        >
          <Icon name="list" className="h-5 w-5" /> Table talk
        </button>
      </aside>
      {/* screen readers hear each action as it happens, and when it's their turn */}
      <ol aria-live="polite" aria-relevant="additions" className="sr-only">
        {entries.slice(-6).map((entry) => (
          <li key={entry.id}>
            {entry.text}
            {entry.say && `. They say: ${entry.say}`}
          </li>
        ))}
        {yourTurn && <li key={yourTurn.key}>{yourTurn.text}</li>}
      </ol>
    </>
  );
}

export function HeaderButton({ label, icon, onClick, pressed }: { label: string; icon: IconName; onClick: () => void; pressed?: boolean }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} aria-pressed={pressed} className="header-btn">
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

type TableHeaderProps = {
  stack: ReactNode; // shown in the chip pill
  status: ReactNode; // hand, blinds... (large screens only)
  children: ReactNode; // the header buttons
};

/** The bar above the table: home link, your chips, the hand status and the header buttons. */
export function TableHeader({ stack, status, children }: TableHeaderProps) {
  return (
    <header className="flex items-center justify-between gap-2 border-b-2 border-[#c9965c]/60 bg-wine/90 px-3 py-2 sm:px-6">
      <Link href="/" aria-label="Home" className="flex items-center gap-2 font-display text-lg tracking-wide sm:text-2xl">
        <SpadeBadge />
        <span className="hidden sm:inline">
          <BrandName />
        </span>
      </Link>
      <div className="hidden items-center gap-2 rounded-full border border-gold/40 bg-black/30 px-4 py-1 font-display text-lg md:flex">
        <span className="chip" /> {stack}
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="mr-2 hidden text-sm text-cream/70 lg:block">{status}</span>
        {children}
      </div>
    </header>
  );
}

/** "Your turn. 40 to call. ..." for screen readers; a new key every turn so it is announced again. */
export function yourTurnLine(game: Game, me: number) {
  if (me < 0 || game.turn !== me || game.street === "done") {
    return undefined;
  }
  const { owe } = legal(game);
  const toCall = owe ? `${owe} to call.` : "You can check.";
  return {
    key: `${game.hand}-${game.history.length}`,
    text: `Your turn. ${toCall} Press F to fold, C to ${owe ? "call" : "check"}, R to raise.`,
  };
}
