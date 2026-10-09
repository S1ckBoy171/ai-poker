"use client";

// Background music on/off, fixed in the top-right corner of every page (the root layout renders it once).
// Headers with their own top-right buttons leave room for it.
import { useEffect, useSyncExternalStore } from "react";
import { startMusic, stopMusic } from "@/lib/sound";
import { Icon } from "./ui";

const MUSIC_OFF_KEY = "agent-holdem-music-off";
const musicOffListeners = new Set<() => void>();

// Kept in memory as well as in storage, so the button still works when storage is blocked.
let musicOff: boolean | null = null;

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

function subscribeToMusicOff(listener: () => void) {
  musicOffListeners.add(listener);
  return () => musicOffListeners.delete(listener);
}

export function MusicButton() {
  const isOff = useSyncExternalStore(subscribeToMusicOff, readMusicOff, () => false);

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

  function toggleMusic() {
    musicOff = !isOff;
    try {
      localStorage.setItem(MUSIC_OFF_KEY, musicOff ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts until the page reloads
    }
    if (!musicOff) {
      // Started inside the click itself, which some browsers require before playing audio.
      startMusic();
    }
    musicOffListeners.forEach((listener) => listener());
  }

  const label = isOff ? "Turn music on" : "Turn music off";
  return (
    <button aria-label={label} title={label} onClick={toggleMusic} className="header-btn fixed right-3 top-2 z-50 sm:right-6">
      <Icon name={isOff ? "musicOff" : "music"} className="h-5 w-5" />
    </button>
  );
}
