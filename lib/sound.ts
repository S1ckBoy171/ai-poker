// Table sounds, synthesized with Web Audio (no audio files). Browsers only allow audio after a user gesture,
// so the context is created lazily and resumed on the first click or key press.

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

export function play(name: Sound) {
  try {
    SOUNDS[name]();
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
