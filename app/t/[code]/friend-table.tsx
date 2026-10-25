"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { fetchJson } from "@/lib/fetch-json";
import { playersReady, playersWithChips, type Game } from "@/lib/poker";
import { play } from "@/lib/sound";
import { seatChair } from "@/lib/table-shape";
import type { SeatAction, TableView as View } from "@/lib/tables";
import {
  ActionBar,
  HeaderButton,
  LogPanel,
  StandDialog,
  StatsPanel,
  TableHeader,
  TableView,
  useLeaveGuard,
  useMuted,
  useTableSounds,
  yourTurnLine,
  type LogEntry,
  type Timer,
} from "../../table";

const COLORS = ["#e8c27a", "#d97757", "#10a37f", "#7c7ff5", "#e05d8a", "#3fa7d6", "#9ccc65", "#ffb74d", "#ba68c8"];
const MAX_SEATS = 9;
const POLL_MS = 1000;
const COPIED_MS = 2000; // how long "LINK COPIED" shows

/** A player's color goes with their chair, so it stays theirs when someone joins and seat numbers shift. */
const colorFor = (seat: number, playerCount: number) => COLORS[seatChair(seat, playerCount) % COLORS.length];

/** The log for the current hand, rebuilt from its history (ids stay stable as lines are added). */
function logEntriesFor(game: Game): LogEntry[] {
  const handLine: LogEntry = { id: game.hand * 1000, text: `Hand #${game.hand}`, kind: "hand" };
  return [handLine, ...game.history.map((text, k) => ({ id: game.hand * 1000 + k + 1, text }))];
}

export function FriendTable() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [standing, setStanding] = useState(false); // the stand-up prompt is open
  const [standError, setStandError] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState<(Timer & { deadline: number }) | null>(null);
  const [name, setName] = useState("");
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [muted, toggleMute] = useMuted();
  const lastSeen = useRef("");

  /** Show what the server sent; a new turn restarts the turn clock. */
  const show = (next: View) => {
    const fingerprint = JSON.stringify({ ...next, turnMsLeft: 0 }); // skip re-rendering identical polls
    if (fingerprint !== lastSeen.current) {
      lastSeen.current = fingerprint;
      setView(next);
    }
    const game = next.game;
    const turnId = game && game.street !== "done" ? `${game.hand}-${game.history.length}` : null;
    const deadline = Date.now() + next.turnMsLeft;
    setTimer((current) => {
      if (!game || !turnId) {
        return null;
      }
      if (current?.id === turnId) {
        return current; // same turn: keep the running clock
      }
      return { id: turnId, seat: game.turn, limitMs: next.turnMs, elapsedMs: next.turnMs - next.turnMsLeft, deadline };
    });
    setError("");
  };
  const showFromPoll = useEffectEvent(show);

  // Every player polls the table each second; the server also runs turn timeouts and the next deal on these reads.
  // The next poll is scheduled only once the last one is back, so a slow server never gets a pile of overlapping
  // reads, and an older reply can't land after a newer one.
  useEffect(() => {
    let mounted = true;
    let next: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const latest = await fetchJson<View>(`/api/tables/${code}`, { cache: "no-store" });
        if (mounted) {
          showFromPoll(latest);
        }
      } catch (e) {
        if (mounted) {
          setError((e as Error).message);
        }
      }
      if (mounted) {
        // ponytail: a full read every second per player; switch to server-sent events if tables get busy
        next = setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => {
      mounted = false;
      clearTimeout(next);
    };
  }, [code]);

  useTableSounds(view?.game ?? null, view?.you ?? -1, muted);

  // Seated, you leave with the Stand button only; a reload, or this table opened on another device, finds your seat again.
  const seated = (view?.you ?? -1) >= 0;
  useLeaveGuard(seated && !standing, () => setStanding(true));

  const send = async (body: object) => {
    setBusy(true);
    try {
      const reply = await fetchJson<{ view: View }>(`/api/tables/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      show(reply.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onAct = (action: SeatAction) => send({ op: "act", action });
  const askToStand = () => {
    setStandError("");
    setStanding(true);
  };
  const standUp = async () => {
    setBusy(true);
    try {
      await fetchJson(`/api/tables/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "stand" }),
      });
      router.push("/");
    } catch (e) {
      setStandError((e as Error).message);
      setBusy(false);
    }
  };
  const standDialog = standing && (
    <StandDialog
      detail="You leave the table and your chips go with you. If you're in a hand, you fold."
      busy={busy}
      error={standError}
      onStand={standUp}
      onStay={() => setStanding(false)}
    />
  );
  const join = (e: FormEvent) => {
    e.preventDefault();
    send({ op: "join", name: name || session?.user.name }); // defaults to your account name
  };
  const copyInvite = async () => {
    const url = `${location.origin}/t/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      window.prompt("Copy this invite link and send it to your friends:", url); // no clipboard on plain http from another device
    }
  };

  if (!view) {
    return (
      <main className="grid min-h-dvh place-items-center px-4 text-center">
        <div>
          <p className="font-display text-2xl text-gold">{error || "Finding the table…"}</p>
          {error && (
            <Link href="/" className="btn-gold mt-6 inline-block">
              HOME
            </Link>
          )}
        </div>
      </main>
    );
  }

  const game = view.game;
  const me = view.you;
  const labels = view.names.map((seatName, seat) => (seat === me ? "You" : seatName));
  const tick = () => {
    if (!muted) {
      play("tick");
    }
  };
  const errorMessage = error && (
    <p role="alert" className="mt-3 text-red-200">
      {error}
    </p>
  );

  // Not seated yet: say who you are.
  if (me < 0) {
    const haveName = Boolean(name.trim() || session); // typed, or taken from your account
    return (
      <Shell>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">JOIN THE TABLE</h1>
        <p className="mt-2 text-cream/75">
          {view.names.length} of {MAX_SEATS} seats taken: {view.names.join(", ")}. Blinds {view.bb / 2}/{view.bb}, {view.stack.toLocaleString()} chips each.
        </p>
        <form onSubmit={join} className="mx-auto mt-6 flex max-w-md gap-2">
          <input
            autoFocus
            aria-label="Your name"
            maxLength={16}
            placeholder={session?.user.name.slice(0, 16) ?? "Your name"}
            className="field w-full text-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy || !haveName} className="btn-gold disabled:opacity-50">
            JOIN
          </button>
        </form>
        {errorMessage}
      </Shell>
    );
  }

  // Seated, waiting for the host to deal.
  if (!game) {
    const enoughPlayers = view.names.length >= 2;
    return (
      <Shell>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">INVITE YOUR FRIENDS</h1>
        <p className="mt-2 text-cream/75">Send them the link, or have them enter the code on the home page.</p>
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span
              className="rounded-xl bg-black/40 px-4 py-2 font-display text-2xl tracking-[0.25em] text-gold ring-1 ring-gold/40"
              aria-label={`Table code ${code}`}
            >
              {code}
            </span>
            <button onClick={copyInvite} className="btn-gold">
              {copied ? "LINK COPIED" : "COPY INVITE LINK"}
            </button>
          </div>
        </div>
        <h2 className="mt-8 font-display text-lg tracking-wider text-gold">
          AT THE TABLE · {view.names.length}/{MAX_SEATS}
        </h2>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {view.names.map((seatName, seat) => (
            <li key={seat} className="anim-pop flex items-center gap-2 rounded-full bg-black/35 py-1 pl-1 pr-3 ring-1 ring-gold/25">
              <span className="grid h-7 w-7 place-items-center rounded-full font-display text-sm text-white" style={{ background: colorFor(seat, view.names.length) }}>
                {seatName.slice(0, 2).toUpperCase()}
              </span>
              {seat === me ? `${seatName} (you)` : seatName}
              {seat === view.host && <span className="text-xs text-cream/50">host</span>}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          {me === view.host && (
            <button onClick={() => send({ op: "deal" })} disabled={busy || !enoughPlayers} className="btn-gold disabled:opacity-50">
              {enoughPlayers ? "DEAL CARDS" : "WAITING FOR A FRIEND…"}
            </button>
          )}
          {me !== view.host && <p className="text-cream/75">Waiting for {view.names[view.host]} to deal…</p>}
        </div>
        <button onClick={askToStand} className="mt-6 text-sm text-cream/70 underline hover:text-cream">
          Stand up and leave
        </button>
        {errorMessage}
        {standDialog}
      </Shell>
    );
  }

  const mine = game.players[me];
  const handOver = game.street === "done";
  const myTurn = !handOver && game.turn === me;
  const busted = mine.stack === 0 && (!mine.cards.length || handOver);
  const away = !!mine.sittingOut;
  // One player has every chip: the game is over unless someone rebuys (then the next hand deals itself).
  const gameOver = handOver && playersWithChips(game) < 2;
  const waitingForAway = handOver && !gameOver && playersReady(game) < 2;
  const colors = labels.map((_, seat) => colorFor(seat, labels.length));
  const winnerSeat = game.players.findIndex((player) => player.stack > 0);
  const status = error || (waitingForAway && "Waiting for players who are away to come back.") || (away && "You're sitting out. You won't be dealt in until you're back.");

  return (
    <main className="flex min-h-dvh flex-col">
      <TableHeader
        onHome={askToStand}
        stack={mine.stack.toLocaleString()}
        status={
          <>
            Table {code} · Hand #{game.hand} · Blinds {game.sb}/{game.bb}
          </>
        }
      >
        <HeaderButton label={copied ? "Invite link copied" : "Copy invite link"} icon="link" onClick={copyInvite} />
        <HeaderButton label={muted ? "Turn sound on" : "Mute sound"} icon={muted ? "muted" : "sound"} onClick={toggleMute} />
        <HeaderButton label="Who's up" icon="stats" onClick={() => setShowStats(!showStats)} pressed={showStats} />
        <HeaderButton
          label={away ? "I'm back" : "Sit out"}
          icon={away ? "play" : "pause"}
          onClick={() => onAct({ type: away ? "sitIn" : "sitOut" })}
        />
        <HeaderButton label="Stand up and leave" icon="stand" onClick={askToStand} />
      </TableHeader>

      {status && (
        <p role="status" className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30">
          {status}
        </p>
      )}

      <section className="table-stage">
        <TableView
          game={game}
          me={me}
          labels={labels}
          colors={colors}
          thinking={!handOver && game.turn !== me ? { seat: game.turn } : undefined}
          timer={timer}
        />
      </section>

      {(myTurn || busted || away) && !gameOver && (
        <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end gap-3 sm:bottom-5 sm:right-6">
          {away && (
            <button className="btn-gold anim-pop" disabled={busy} onClick={() => onAct({ type: "sitIn" })}>
              I&apos;M BACK
            </button>
          )}
          {busted && (
            <button className="btn-gold anim-pop" disabled={busy} onClick={() => onAct({ type: "rebuy" })}>
              REBUY {view.stack.toLocaleString()}
            </button>
          )}
          {myTurn && timer && <ActionBar game={game} deadline={timer.deadline} onAct={onAct} onTick={tick} hotkeys={!standing} />}
        </div>
      )}

      {showStats && <StatsPanel game={game} labels={labels} />}
      <LogPanel entries={logEntriesFor(game)} open={showLog} onToggle={() => setShowLog(!showLog)} hidden={myTurn} yourTurn={yourTurnLine(game, me)} />

      {gameOver && !standing && (
        <div className="anim-fade fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
          <div className="anim-modal panel w-full max-w-md p-8 text-center sm:p-10">
            <h2 className="font-display text-5xl font-bold text-white">GAME OVER</h2>
            <p className="mt-3 text-xl">{winnerSeat === me ? "You take the table." : `${labels[winnerSeat] ?? "Nobody"} takes the table.`}</p>
            <Standings game={game} labels={labels} />
            <p className="mt-4 text-sm text-cream/70">The game carries on if anyone who is out rebuys.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {busted && (
                <button className="btn-gold" disabled={busy} onClick={() => onAct({ type: "rebuy" })}>
                  REBUY {view.stack.toLocaleString()}
                </button>
              )}
              <button className="btn-gold" onClick={askToStand}>
                LEAVE TABLE
              </button>
            </div>
          </div>
        </div>
      )}
      {standDialog}
    </main>
  );
}

/** Everyone at the table, most chips won first: what they have and what they won or lost overall. */
function Standings({ game, labels }: { game: Game; labels: string[] }) {
  const rows = game.players.map((player, seat) => ({ seat, stack: player.stack, net: player.stack - player.buyIn }));
  rows.sort((a, b) => b.net - a.net);
  return (
    <ol className="mx-auto mt-6 max-w-xs text-left">
      {rows.map(({ seat, stack, net }) => (
        <li key={seat} className="flex justify-between gap-4 border-t border-white/10 py-1.5">
          <span>{labels[seat]}</span>
          <span className="tabular-nums">
            {stack.toLocaleString()} ({net > 0 ? "+" : ""}
            {net.toLocaleString()})
          </span>
        </li>
      ))}
    </ol>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="anim-modal panel w-full max-w-2xl p-6 text-center sm:p-10">{children}</div>
    </main>
  );
}
