// Which sounds a table plays when its game changes, and when. The table pages schedule them (app/table.tsx).
import type { Game } from "./poker.ts";
import type { Sound } from "./sound.ts";

export const DEAL_STEP_MS = 70; // between hole cards as they go round the table
const SOUND_GAP_MS = 140; // between the other sounds for one game update

// The first pattern a history line matches picks its sound.
const SOUND_PATTERNS: [RegExp, Sound][] = [
  [/ wins /, "win"],
  [/ folds/, "fold"],
  [/ checks/, "check"],
  [/ (calls|bets|raises)/, "chips"],
  [/^(flop|turn|river): /, "card"],
];
const soundFor = (line: string) => SOUND_PATTERNS.find(([pattern]) => pattern.test(line))?.[1];

/** How many hole cards are out this hand, everyone's together. */
export const holeCardCount = (game: Game) => game.players.reduce((sum, player) => sum + player.cards.length, 0);

/** A sound to play `delayMs` from now. */
export type TimedSound = { sound: Sound; delayMs: number };

/**
 * The sounds for whatever changed from `before` to `game`. A new hand plays the card sound once for every hole
 * card, in step with the cards leaving the deck; anything else follows once the deal is done.
 * `me` is your seat, or -1 when you are only watching.
 */
export function soundsForUpdate(before: Game, game: Game, me: number): TimedSound[] {
  const newHand = before.hand !== game.hand;
  const dealtCards = newHand ? holeCardCount(game) : 0;
  const dealSounds = Array.from({ length: dealtCards }, (_, card): TimedSound => ({ sound: "card", delayMs: card * DEAL_STEP_MS }));

  const newLines = newHand ? [] : game.history.slice(before.history.length); // a new hand starts its history over
  const lineSounds = newLines.map(soundFor).filter((sound): sound is Sound => !!sound);
  // every bet is heard; any other sound plays once, however many of the new lines ask for it
  const laterSounds = lineSounds.filter((sound, i) => sound === "chips" || lineSounds.indexOf(sound) === i);
  const turnJustCame = before.turn !== me || before.street !== game.street || newHand;
  if (me >= 0 && game.turn === me && turnJustCame) {
    laterSounds.push("turn");
  }

  const dealMs = dealtCards * DEAL_STEP_MS;
  return [...dealSounds, ...laterSounds.map((sound, i): TimedSound => ({ sound, delayMs: dealMs + i * SOUND_GAP_MS }))];
}
