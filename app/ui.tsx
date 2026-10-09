// Small presentational pieces shared by the table, the settings modal and the history page (no hooks, server-safe).
import type { CSSProperties } from "react";
import type { Card as CardT } from "@/lib/poker";

const PATHS = {
  x: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  up: "m5 12 7-7 7 7M12 19V5",
  play: "M7 4v16l13-8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  restart: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
  sliders: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  user: "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM20 21a8 8 0 0 0-16 0",
  timer: "M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  sound: "M4 9h4l5-4v14l-5-4H4zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11",
  muted: "M4 9h4l5-4v14l-5-4H4zM17 9.5l5 5M22 9.5l-5 5",
  history: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3.5 2",
  stats: "M3 3v18h18M8 17v-5M13 17V8M18 17v-9",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
};

export function Icon({ name, className = "h-6 w-6" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const DIMS = {
  xs: "h-8 w-[23px] text-[10px]",
  sm: "h-9 w-[26px] text-[10px]",
  md: "h-[52px] w-9 text-sm sm:h-[78px] sm:w-14 sm:text-xl",
  lg: "h-[70px] w-12 text-lg sm:h-[84px] sm:w-[60px] sm:text-xl",
};
const SUITS: Record<string, string> = { s: "♠︎", h: "♥︎", d: "♦︎", c: "♣︎" };

/** A card face, or its back when `c` is missing. `win` lifts it as part of the winning five; `dim` fades the rest. */
export function Card({ c, size, win, dim, delay = 0 }: { c?: CardT; size: keyof typeof DIMS; win?: boolean; dim?: boolean; delay?: number }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` };
  if (!c) return <div className={`card-back ${DIMS[size]}`} style={style} />;
  const rank = c[0] === "T" ? "10" : c[0];
  return (
    <div
      role="img"
      aria-label={rank + c[1]}
      style={style}
      className={`card ${DIMS[size]} ${win ? "card-win" : ""} ${dim ? "card-dim" : ""} ${c[1] === "h" || c[1] === "d" ? "text-[#c8102e]" : "text-zinc-900"}`}
    >
      <span className="absolute left-[10%] top-[7%] flex flex-col items-center">
        {rank}
        <span>{SUITS[c[1]]}</span>
      </span>
      <span className="absolute bottom-[5%] right-[9%] text-[1.7em]">{SUITS[c[1]]}</span>
    </div>
  );
}
