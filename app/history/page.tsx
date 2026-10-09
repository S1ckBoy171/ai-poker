import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { recentHands } from "@/lib/db";
import type { HandRecord } from "@/lib/poker";
import { Card, netColor } from "../ui";

export const metadata: Metadata = { title: "Hand history · Agent Hold'em" };

const gameStart = (date: Date) => date.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-wide text-white sm:text-5xl">HAND HISTORY</h1>
          <p className="mt-1 text-sm text-cream/70">Your last 200 hands against bots, newest first. Your game keeps running in the table tab.</p>
        </div>
        <Link href="/play" className="btn-gold">
          TABLE
        </Link>
      </header>
      <Suspense fallback={<p className="text-cream/70">Loading hands…</p>}>
        <Hands />
      </Suspense>
    </main>
  );
}

async function Hands() {
  await connection(); // read the DB on every request
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login?next=/history");
  }
  const rows = await recentHands(session.user.id); // only this account's games
  if (!rows.length) {
    return <p className="text-cream/70">No hands played yet. Finished hands show up here.</p>;
  }
  const games = Map.groupBy(rows, (row) => row.gameId);

  return [...games.values()].map((hands) => {
    const firstHand = hands[hands.length - 1]; // newest first, so the game's first hand is last
    return (
      <section key={hands[0].gameId} className="mb-10">
        <h2 className="mb-3 font-display text-lg tracking-wider text-gold">GAME · {gameStart(firstHand.at).toUpperCase()}</h2>
        <div className="space-y-2">
          {hands.map(({ hand, at }) => (
            <HandDetails key={hand.number} hand={hand} at={at} />
          ))}
        </div>
      </section>
    );
  });
}

/** One hand: board and result in the summary; who held what, their net, and the action log when opened. */
function HandDetails({ hand, at }: { hand: HandRecord; at: Date }) {
  const isWinningCard = (card: string) => hand.winners.some((winner) => winner.cards.includes(card));
  const result = hand.winners
    .map((winner) => {
      const withHand = winner.hand ? ` · ${winner.hand}` : "";
      return `${winner.name} won ${winner.amount.toLocaleString()}${withHand}`;
    })
    .join(", ");

  return (
    <details className="anim-rise group rounded-2xl bg-black/35 ring-1 ring-gold/20 open:bg-black/45">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="w-24 font-display text-lg">Hand #{hand.number}</span>
        <span className="flex gap-1">
          {hand.board.length ? (
            hand.board.map((card) => <Card key={card} card={card} size="xs" win={isWinningCard(card)} />)
          ) : (
            <span className="text-sm text-cream/50">no flop</span>
          )}
        </span>
        <span className="flex-1 text-sm">{result}</span>
        <span className="text-xs text-cream/50">{at.toLocaleTimeString("en", { timeStyle: "short" })}</span>
      </summary>
      <div className="grid gap-5 border-t border-gold/15 px-4 py-4 md:grid-cols-[1fr_1.3fr]">
        <table className="h-fit w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-cream/50">
              <th className="pb-2 font-normal">Player</th>
              <th className="pb-2 font-normal">Cards</th>
              <th className="pb-2 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody>
            {hand.players.map((player) => (
              <tr key={player.name} className="border-t border-white/5">
                <td className="py-1.5">{player.name}</td>
                <td className="py-1.5">
                  <span className="flex gap-1">
                    {player.cards.length ? player.cards.map((card) => <Card key={card} card={card} size="xs" />) : <span className="text-cream/40">-</span>}
                  </span>
                </td>
                <td className={`py-1.5 text-right font-display ${netColor(player.delta)}`}>
                  {player.delta > 0 ? "+" : ""}
                  {player.delta.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ol className="space-y-0.5 text-sm text-cream/85">
          {hand.history.map((line, k) => (
            <li key={k}>{line}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
