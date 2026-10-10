"use client";

// Background music on/off, with a volume slider that opens when the button is hovered or reached with Tab.
// Fixed in the top-right corner of every page (the root layout renders it once); headers with their own
// top-right buttons leave room for it.
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_MUSIC_LEVEL, setMusicLevel, startMusic, stopMusic } from "@/lib/sound";
import { Icon } from "./ui";

const MUSIC_OFF_KEY = "agent-holdem-music-off";
const MUSIC_LEVEL_KEY = "agent-holdem-music-level";
const musicSettingListeners = new Set<() => void>();

// Kept in memory as well as in storage, so the controls still work when storage is blocked.
let musicOff: boolean | null = null;
let musicLevel: number | null = null;

function readMusicOff(): boolean {
  if (musicOff === null) {
    try {
      musicOff = localStorage.getItem(MUSIC_OFF_KEY) === "1";
    } catch {
      musicOff = false;
    }
  }
  return musicOff;
}

/** The saved slider level, 0 to 1, or the default when nothing valid is saved. */
function readMusicLevel(): number {
  if (musicLevel === null) {
    musicLevel = DEFAULT_MUSIC_LEVEL;
    try {
      const saved = localStorage.getItem(MUSIC_LEVEL_KEY);
      const level = saved === null ? NaN : Number(saved);
      const isValid = Number.isFinite(level) && level >= 0 && level <= 1;
      if (isValid) {
        musicLevel = level;
      }
    } catch {
      // storage blocked: start at the default
    }
  }
  return musicLevel;
}

function subscribeToMusicSettings(listener: () => void) {
  musicSettingListeners.add(listener);
  return () => musicSettingListeners.delete(listener);
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts until the page reloads
  }
}

const announceMusicSettings = () => musicSettingListeners.forEach((listener) => listener());

export function MusicButton() {
  const isOff = useSyncExternalStore(subscribeToMusicSettings, readMusicOff, () => false);
  const level = useSyncExternalStore(subscribeToMusicSettings, readMusicLevel, () => DEFAULT_MUSIC_LEVEL);

  // Music starts right away when the browser allows it, otherwise on the first click or key press.
  useEffect(() => {
    if (isOff) {
      return;
    }
    startMusic();
    window.addEventListener("pointerdown", startMusic);
    window.addEventListener("keydown", startMusic);
    return () => {
      window.removeEventListener("pointerdown", startMusic);
      window.removeEventListener("keydown", startMusic);
      stopMusic();
    };
  }, [isOff]);

  // The saved level applies from the first track on.
  useEffect(() => {
    setMusicLevel(level);
  }, [level]);

  function turnMusic(on: boolean) {
    musicOff = !on;
    save(MUSIC_OFF_KEY, musicOff ? "1" : "0");
    if (on) {
      // Started inside the click itself, which some browsers require before playing audio.
      startMusic();
    }
    announceMusicSettings();
  }

  function changeLevel(percent: number) {
    musicLevel = percent / 100;
    save(MUSIC_LEVEL_KEY, String(musicLevel));
    setMusicLevel(musicLevel);
    const wantsToHear = isOff && musicLevel > 0; // turning the volume up means you want to hear it
    if (wantsToHear) {
      turnMusic(true); // also tells the controls about the new level
      return;
    }
    announceMusicSettings();
  }

  const toggleMusic = () => turnMusic(isOff);

  const label = isOff ? "Turn music on" : "Turn music off";
  const percent = Math.round(level * 100);
  // The slider drops down below the button, clear of the header buttons beside it. Only the music button opens
  // it: until then the wrapper and the slider ignore the pointer, so hovering where the slider would be opens
  // nothing. Once the button is hovered, the whole wrapper takes the pointer, so the slider stays open while the
  // pointer moves down onto it from any angle. Keyboard users open it by tabbing in: :focus-visible, unlike plain
  // focus, isn't set by a click, so a click doesn't leave it stuck open.
  const sliderVisibility =
    "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100";

  return (
    <div className="group pointer-events-none fixed right-3 top-2 z-50 flex flex-col items-end hover:pointer-events-auto sm:right-6">
      <button type="button" aria-label={label} title={label} onClick={toggleMusic} className="header-btn pointer-events-auto">
        <Icon name={isOff ? "musicOff" : "music"} className="h-5 w-5" />
      </button>
      <label className={`pt-5 transition-opacity duration-150 ${sliderVisibility}`}>
        <span className="flex h-9 items-center gap-2 rounded-full bg-[#22050a] px-3 shadow-lg shadow-black/50 ring-1 ring-gold/40">
          <span className="sr-only">Music volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            aria-valuetext={`${percent}%`}
            onChange={(e) => changeLevel(Number(e.target.value))}
            className="w-28 accent-gold"
          />
          <span aria-hidden className="w-8 text-right text-xs tabular-nums text-cream/70">
            {percent}%
          </span>
        </span>
      </label>
    </div>
  );
}
