"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { fetchJson } from "@/lib/fetch-json";
import { playersWithChips, type Game } from "@/lib/poker";
import { play } from "@/lib/sound";
import type { SeatAction, TableView as View } from "@/lib/tables";
import { ActionBar, HeaderButton, LogPanel, StatsPanel, TableHeader, TableView, useMuted, useTableSounds, yourTurnLine, type LogEntry, type Timer } from "../../table";

const COLORS = ["#e8c27a", "#d97757", "#10a37f", "#7c7ff5", "#e05d8a", "#3fa7d6", "#9ccc65", "#ffb74d", "#ba68c8"];
const MAX_SEATS = 9;
const POLL_MS = 1000;
const COPIED_MS = 2000; // how long "LINK COPIED" shows

const colorFor = (seat: number) => COLORS[seat % COLORS.length];

// Your seat's secret token for this table lives only in this browser.
const tokenKey = (code: string) => `agent-holdem-table:${code}`;
function readToken(code: string) {
  try {
    return localStorage.getItem(tokenKey(code)) ?? "";
  } catch {
    return "";
  }
}

/** The log for the current hand, rebuilt from its history (ids stay stable as lines are added). */
function logEntriesFor(game: Game): LogEntry[] {
  const handLine: LogEntry = { id: game.hand * 1000, text: `Hand #${game.hand}`, kind: "hand" };
  return [handLine, ...game.history.map((text, k) => ({ id: game.hand * 1000 + k + 1, text }))];
}

export function FriendTable() {
  const { code } = useParams<{ code: string }>();
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
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const latest = await fetchJson<View>(`/api/tables/${code}`, { headers: { "x-table-token": readToken(code) }, cache: "no-store" });
        if (mounted) {
          showFromPoll(latest);
        }
      } catch (e) {
        if (mounted) {
          setError((e as Error).message);
        }
      }
    };
    poll();
    // ponytail: a full read every second per player; switch to server-sent events if tables get busy
    const interval = setInterval(poll, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [code]);

  useTableSounds(view?.game ?? null, view?.you ?? -1, muted);

  const send = async (body: object) => {
    setBusy(true);
    try {
      const reply = await fetchJson<{ view: View; token?: string }>(`/api/tables/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-table-token": readToken(code) },
        body: JSON.stringify(body),
      });
      if (reply.token) {
        localStorage.setItem(tokenKey(code), reply.token);
      }
      show(reply.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onAct = (action: SeatAction) => send({ op: "act", action });
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
  const errorMessage = error && (
    <p role="alert" className="mt-3 text-red-200">
      {error}
    </p>
  );

  // Not seated yet: say who you are.
  if (me < 0) {
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
          <button disabled={busy || !(name.trim() || session)} className="btn-gold disabled:opacity-50">
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
              <span className="grid h-7 w-7 place-items-center rounded-full font-display text-sm text-white" style={{ background: colorFor(seat) }}>
                {seatName.slice(0, 2).toUpperCase()}
              </span>
              {seat === me ? `${seatName} (you)` : seatName}
              {seat === 0 && <span className="text-xs text-cream/50">host</span>}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          {me === 0 && (
            <button onClick={() => send({ op: "deal" })} disabled={busy || !enoughPlayers} className="btn-gold disabled:opacity-50">
              {enoughPlayers ? "DEAL CARDS" : "WAITING FOR A FRIEND…"}
            </button>
          )}
          {me !== 0 && <p className="text-cream/75">Waiting for {view.names[0]} to deal…</p>}
        </div>
        {errorMessage}
      </Shell>
    );
  }

  const mine = game.players[me];
  const handOver = game.street === "done";
  const myTurn = !handOver && game.turn === me;
  const busted = mine.stack === 0 && (!mine.cards.length || handOver);
  const stuck = handOver && playersWithChips(game) < 2;

  return (
    <main className="flex min-h-dvh flex-col">
      <TableHeader
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
      </TableHeader>

      {(error || stuck) && (
        <p role="status" className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30">
          {error || "Only one player has chips left. Anyone who is out can rebuy to keep playing."}
        </p>
      )}

      <section className="flex flex-1 items-center justify-center px-12 pb-60 pt-20 sm:px-24 sm:pb-36">
        <TableView
          game={game}
          me={me}
          labels={labels}
          colors={labels.map((_, seat) => colorFor(seat))}
          thinking={!handOver && game.turn !== me ? { seat: game.turn } : undefined}
          timer={timer}
        />
      </section>

      {(myTurn || busted) && (
        <div className="fixed bottom-3 right-3 z-30 flex flex-col items-end gap-3 sm:bottom-5 sm:right-6">
          {busted && (
            <button className="btn-gold anim-pop" disabled={busy} onClick={() => onAct({ type: "rebuy" })}>
              REBUY {view.stack.toLocaleString()}
            </button>
          )}
          {myTurn && timer && <ActionBar game={game} deadline={timer.deadline} onAct={onAct} onTick={() => !muted && play("tick")} />}
        </div>
      )}

      {showStats && <StatsPanel game={game} labels={labels} />}
      <LogPanel entries={logEntriesFor(game)} open={showLog} onToggle={() => setShowLog(!showLog)} hidden={myTurn} yourTurn={yourTurnLine(game, me)} />
    </main>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="anim-modal panel w-full max-w-2xl p-6 text-center sm:p-10">{children}</div>
    </main>
  );
}
