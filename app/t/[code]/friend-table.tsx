"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import type { Action } from "@/lib/poker";
import { play } from "@/lib/sound";
import type { TableView as View } from "@/lib/tables";
import { ActionBar, HeaderButton, LogPanel, StatsPanel, TableView, useMuted, useTableSounds, yourTurnLine, type Timer } from "../../table";

const COLORS = ["#e8c27a", "#d97757", "#10a37f", "#7c7ff5", "#e05d8a", "#3fa7d6", "#9ccc65", "#ffb74d", "#ba68c8"];
// Your seat's secret token for this table lives only in this browser.
const tokenKey = (code: string) => `agent-holdem-table:${code}`;
const readToken = (code: string) => {
  try {
    return localStorage.getItem(tokenKey(code)) ?? "";
  } catch {
    return "";
  }
};

export function FriendTable() {
  const { code } = useParams<{ code: string }>();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [timer, setTimer] = useState<(Timer & { deadline: number }) | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [muted, toggleMute] = useMuted();
  const lastSeen = useRef("");

  /** Show what the server sent; a new turn restarts the turn clock. */
  const show = (v: View) => {
    const key = JSON.stringify({ ...v, turnMsLeft: 0 }); // skip re-rendering identical polls
    if (key !== lastSeen.current) {
      lastSeen.current = key;
      setView(v);
    }
    const g = v.game;
    const id = g && g.street !== "done" ? `${g.hand}-${g.history.length}` : null;
    const deadline = Date.now() + v.turnMsLeft;
    setTimer((t) => (!g || !id ? null : t?.id === id ? t : { id, seat: g.turn, limitMs: v.turnMs, elapsedMs: v.turnMs - v.turnMsLeft, deadline }));
    setError("");
  };
  const showFromPoll = useEffectEvent(show);

  // Every player polls the table each second; the server also runs turn timeouts and the next deal on these reads.
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/tables/${code}`, { headers: { "x-table-token": readToken(code) }, cache: "no-store" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (live) showFromPoll(j);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    poll();
    // ponytail: a full read every second per player; switch to server-sent events if tables get busy
    const id = setInterval(poll, 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [code]);

  useTableSounds(view?.game ?? null, view?.you ?? -1, muted);

  const send = async (body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tables/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-table-token": readToken(code) },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (j.token) localStorage.setItem(tokenKey(code), j.token);
      show(j.view);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const onAct = (action: Action | { type: "rebuy" }) => send({ op: "act", action });
  const join = (e: FormEvent) => {
    e.preventDefault();
    send({ op: "join", name });
  };
  const copyInvite = async () => {
    const url = `${location.origin}/t/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this invite link and send it to your friends:", url); // no clipboard on plain http from another device
    }
  };

  if (!view)
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

  const g = view.game;
  const me = view.you;
  const labels = view.names.map((n, i) => (i === me ? "You" : n));
  const invite = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <span className="rounded-xl bg-black/40 px-4 py-2 font-display text-2xl tracking-[0.25em] text-gold ring-1 ring-gold/40" aria-label={`Table code ${code}`}>
        {code}
      </span>
      <button onClick={copyInvite} className="btn-gold">
        {copied ? "LINK COPIED" : "COPY INVITE LINK"}
      </button>
    </div>
  );

  // Not seated yet: say who you are.
  if (me < 0)
    return (
      <Shell>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">JOIN THE TABLE</h1>
        <p className="mt-2 text-cream/75">
          {view.names.length} of 9 seats taken: {view.names.join(", ")}. Blinds {view.bb / 2}/{view.bb}, {view.stack.toLocaleString()} chips each.
        </p>
        <form onSubmit={join} className="mx-auto mt-6 flex max-w-md gap-2">
          <input autoFocus aria-label="Your name" maxLength={16} placeholder="Your name" className="field w-full text-lg" value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={busy || !name.trim()} className="btn-gold disabled:opacity-50">
            JOIN
          </button>
        </form>
        {error && <p role="alert" className="mt-3 text-red-200">{error}</p>}
      </Shell>
    );

  // Seated, waiting for the host to deal.
  if (!g)
    return (
      <Shell>
        <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">INVITE YOUR FRIENDS</h1>
        <p className="mt-2 text-cream/75">Send them the link, or have them enter the code on the home page.</p>
        <div className="mt-6">{invite}</div>
        <h2 className="mt-8 font-display text-lg tracking-wider text-gold">AT THE TABLE · {view.names.length}/9</h2>
        <ul className="mt-3 flex flex-wrap justify-center gap-2">
          {view.names.map((n, i) => (
            <li key={i} className="anim-pop flex items-center gap-2 rounded-full bg-black/35 py-1 pl-1 pr-3 ring-1 ring-gold/25">
              <span className="grid h-7 w-7 place-items-center rounded-full font-display text-sm text-white" style={{ background: COLORS[i % COLORS.length] }}>
                {n.slice(0, 2).toUpperCase()}
              </span>
              {i === me ? `${n} (you)` : n}
              {i === 0 && <span className="text-xs text-cream/50">host</span>}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          {me === 0 ? (
            <button onClick={() => send({ op: "deal" })} disabled={busy || view.names.length < 2} className="btn-gold disabled:opacity-50">
              {view.names.length < 2 ? "WAITING FOR A FRIEND…" : "DEAL CARDS"}
            </button>
          ) : (
            <p className="text-cream/75">Waiting for {view.names[0]} to deal…</p>
          )}
        </div>
        {error && <p role="alert" className="mt-3 text-red-200">{error}</p>}
      </Shell>
    );

  const mine = g.players[me];
  const myTurn = g.street !== "done" && g.turn === me;
  const busted = mine.stack === 0 && (!mine.cards.length || g.street === "done");
  const stuck = g.street === "done" && g.players.filter((p) => p.stack > 0).length < 2;
  const entries = [{ id: g.hand * 1000, text: `Hand #${g.hand}`, kind: "hand" as const }, ...g.history.map((text, k) => ({ id: g.hand * 1000 + k + 1, text }))];

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
          <span className="chip" /> {mine.stack.toLocaleString()}
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="mr-2 hidden text-sm text-cream/70 lg:block">
            Table {code} · Hand #{g.hand} · Blinds {g.sb}/{g.bb}
          </span>
          <HeaderButton label={copied ? "Invite link copied" : "Copy invite link"} icon="link" onClick={copyInvite} />
          <HeaderButton label={muted ? "Turn sound on" : "Mute sound"} icon={muted ? "muted" : "sound"} onClick={toggleMute} />
          <HeaderButton label="Who's up" icon="stats" onClick={() => setShowStats(!showStats)} pressed={showStats} />
        </div>
      </header>

      {(error || stuck) && (
        <p role="status" className="mx-auto mt-3 rounded-full bg-black/40 px-4 py-1.5 text-sm text-cream/80 ring-1 ring-gold/30">
          {error || "Only one player has chips left. Anyone who is out can rebuy to keep playing."}
        </p>
      )}

      <section className="flex flex-1 items-center justify-center px-12 pb-60 pt-20 sm:px-24 sm:pb-36">
        <TableView
          game={g}
          me={me}
          labels={labels}
          colors={labels.map((_, i) => COLORS[i % COLORS.length])}
          thinking={g.street !== "done" && g.turn !== me ? { seat: g.turn } : undefined}
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
          {myTurn && timer && <ActionBar game={g} deadline={timer.deadline} onAct={onAct} onTick={() => !muted && play("tick")} />}
        </div>
      )}

      {showStats && <StatsPanel game={g} labels={labels} />}
      <LogPanel entries={entries} open={showLog} onToggle={() => setShowLog(!showLog)} hidden={myTurn} yourTurn={yourTurnLine(g, me)} />
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="anim-modal panel w-full max-w-2xl p-6 text-center sm:p-10">{children}</div>
    </main>
  );
}
