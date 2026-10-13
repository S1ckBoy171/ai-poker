// Table sounds and background music. A sound plays its recording from public/assets/sounds/<name>.mp3 when
// that file exists, otherwise a version synthesized with Web Audio. Browsers only allow audio after a user
// gesture, so the context is created lazily and resumed on the first click or key press.

let audioContext: AudioContext | null = null;

function audio(): AudioContext {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }
  return audioContext;
}

/** A short beep: `frequency` Hz starting `delay` s from now, fading out over `duration` s. */
function tone(frequency: number, delay: number, duration: number, type: OscillatorType, volume: number) {
  const context = audio();
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0, start);
  envelope.gain.linearRampToValueAtTime(volume, start + 0.005);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** A burst of fading noise through a band-pass filter around `frequency` Hz: card and chip swishes. */
function noise(delay: number, duration: number, volume: number, frequency: number) {
  const context = audio();
  const start = context.currentTime + delay;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    const fade = 1 - i / samples.length;
    samples[i] = (Math.random() * 2 - 1) * fade;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = frequency;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
}

const SOUNDS = {
  deal: () => [0, 0.07, 0.14, 0.21].forEach((delay) => noise(delay, 0.05, 0.5, 3200)),
  card: () => noise(0, 0.06, 0.45, 2600),
  chip: () => {
    tone(2600, 0, 0.06, "triangle", 0.1);
    tone(3400, 0.035, 0.08, "triangle", 0.08);
  },
  check: () => {
    tone(170, 0, 0.09, "sine", 0.35);
    tone(150, 0.11, 0.09, "sine", 0.3);
  },
  fold: () => noise(0, 0.22, 0.35, 900),
  win: () => [523, 659, 784, 1047].forEach((frequency, i) => tone(frequency, i * 0.09, 0.3, "triangle", 0.11)),
  turn: () => {
    tone(880, 0, 0.18, "sine", 0.12);
    tone(1320, 0.13, 0.25, "sine", 0.1);
  },
  tick: () => tone(1100, 0, 0.05, "square", 0.04),
};

export type Sound = keyof typeof SOUNDS;

const RECORDINGS_URL = "/assets/sounds";

// Each file is requested once per page load, so a file added later is picked up after a reload.
const recordings = new Map<Sound, Promise<AudioBuffer | null>>();

/** The decoded recording for `name`, or null when there is no usable file. */
function recordingFor(name: Sound): Promise<AudioBuffer | null> {
  let recording = recordings.get(name);
  if (!recording) {
    recording = loadRecording(name);
    recordings.set(name, recording);
  }
  return recording;
}

async function loadRecording(name: Sound): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(`${RECORDINGS_URL}/${name}.mp3`);
    if (!response.ok) {
      return null;
    }
    const bytes = await response.arrayBuffer();
    const recording = await audio().decodeAudioData(bytes);
    return recording;
  } catch {
    // network error, no audio support or not a valid audio file: use the synthesized sound
    return null;
  }
}

function playRecording(recording: AudioBuffer) {
  const context = audio();
  const source = context.createBufferSource();
  source.buffer = recording;
  source.connect(context.destination);
  source.start();
}

/** Plays the recording for `name` if there is one, otherwise the synthesized sound. Never rejects. */
export async function play(name: Sound): Promise<void> {
  const recording = await recordingFor(name);
  try {
    if (recording) {
      playRecording(recording);
    } else {
      SOUNDS[name]();
    }
  } catch {
    // no audio support: stay silent
  }
}

/** Call once from a click/keydown so later sounds are allowed to play. */
export function unlockAudio() {
  try {
    audio();
  } catch {
    // no audio support: nothing to unlock
  }
}

// Background music: the tracks in public/assets/music play in order from a random first one, quietly under
// the table sounds, each fading into the next. Volume goes through Web Audio because iOS ignores an
// <audio> element's own volume.

const MUSIC_URL = "/assets/music";

/** The music's gain with the volume slider all the way up. */
const LOUDEST_MUSIC = 0.25;
/** Where the volume slider starts: 40% of the loudest, the quiet level the mix was tuned for. */
export const DEFAULT_MUSIC_LEVEL = 0.4;
const VOLUME_CHANGE_SECONDS = 0.15; // a short glide, so dragging the slider doesn't click

const CROSSFADE_SECONDS = 8;
const STOP_FADE_SECONDS = 1;

// To add a track, put it in public/assets/music and list it here with its loudness, measured with:
//   ffmpeg -i <file> -af ebur128 -f null -   (the "I:" value under "Integrated loudness")
const MUSIC_TRACKS = [
  { file: "casino-vip-music-edm-casino-lounge-8-469403.mp3", loudness: -13.3 },
  { file: "casino-vip-music-game-casino-music-3-469380.mp3", loudness: -13.3 },
  { file: "casino-vip-music-mafia-casino-jazz-2-469343.mp3", loudness: -15.9 },
  { file: "casino-vip-music-vip-casino-music-7-469284.mp3", loudness: -14.1 },
  { file: "echobrainz-casino-royal-612527.mp3", loudness: -15.1 },
];

// Louder tracks are turned down to match the quietest, so no track jumps out of the mix.
const QUIETEST_LOUDNESS = Math.min(...MUSIC_TRACKS.map((track) => track.loudness));

type MusicTrack = { element: HTMLAudioElement; volume: GainNode; loudnessMatch: number };

let nextTrackIndex = Math.floor(Math.random() * MUSIC_TRACKS.length);
let musicLevel = DEFAULT_MUSIC_LEVEL;

// The newest track. During a crossfade the previous one is still in `playingTracks`, fading out.
let currentTrack: MusicTrack | null = null;
const playingTracks = new Set<MusicTrack>();

/** The track's volume at the slider's level, turned down to the quietest track's loudness. */
const fullVolume = (track: MusicTrack) => LOUDEST_MUSIC * musicLevel * track.loudnessMatch;

/** Ramps `track` from its current volume to `volume` over `seconds`. */
function fadeTrack(track: MusicTrack, volume: number, seconds: number) {
  const gain = track.volume.gain;
  const now = audio().currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(volume, now + seconds);
}

function fadeOutAndStop(track: MusicTrack, seconds: number) {
  fadeTrack(track, 0, seconds);
  setTimeout(() => {
    track.element.pause();
    track.volume.disconnect();
    playingTracks.delete(track);
  }, seconds * 1000);
}

function startNextTrack() {
  const { file, loudness } = MUSIC_TRACKS[nextTrackIndex];
  nextTrackIndex = (nextTrackIndex + 1) % MUSIC_TRACKS.length;

  const context = audio();
  const element = new Audio(`${MUSIC_URL}/${file}`);
  const volume = context.createGain();
  volume.gain.value = 0;
  context.createMediaElementSource(element).connect(volume).connect(context.destination);

  const loudnessMatch = 10 ** ((QUIETEST_LOUDNESS - loudness) / 20);
  const track = { element, volume, loudnessMatch };
  currentTrack = track;
  playingTracks.add(track);

  // Start the next track while this one still has CROSSFADE_SECONDS to go, so the two overlap.
  // Until the file's length is known, `duration` is NaN and the comparison is false.
  element.addEventListener("timeupdate", () => {
    const secondsLeft = element.duration - element.currentTime;
    const isEnding = secondsLeft <= CROSSFADE_SECONDS;
    if (track === currentTrack && isEnding) {
      startNextTrack();
      fadeOutAndStop(track, CROSSFADE_SECONDS);
    }
  });

  element.play().then(
    () => {
      // stopMusic() may have run while the file was loading.
      if (track === currentTrack) {
        fadeTrack(track, fullVolume(track), CROSSFADE_SECONDS);
      }
    },
    () => {
      // Autoplay blocked until the first click or key press, or the file is missing: the next startMusic() retries.
      track.volume.disconnect();
      playingTracks.delete(track);
      if (track === currentTrack) {
        currentTrack = null;
      }
    },
  );
}

/** Starts the background music unless it is already playing. Call it again from a click if autoplay was blocked. */
export function startMusic() {
  if (currentTrack) {
    return;
  }
  try {
    startNextTrack();
  } catch {
    // no audio support: stay silent
  }
}

/** Fades out all background music. */
export function stopMusic() {
  currentTrack = null;
  for (const track of playingTracks) {
    fadeOutAndStop(track, STOP_FADE_SECONDS);
  }
}

/** Sets the music volume from the slider, 0 (silent) to 1 (loudest). The playing track follows right away. */
export function setMusicLevel(level: number) {
  musicLevel = Math.min(1, Math.max(0, level));
  if (currentTrack) {
    fadeTrack(currentTrack, fullVolume(currentTrack), VOLUME_CHANGE_SECONDS);
  }
}
