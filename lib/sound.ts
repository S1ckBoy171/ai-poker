// Table sounds, synthesized with Web Audio (no audio files). Browsers only allow audio after a user gesture,
// so the context is created lazily and resumed on the first click or key press.

let ctx: AudioContext | null = null;

function audio() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number) {
  const a = audio();
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(at: number, dur: number, gain: number, freq: number) {
  const a = audio();
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const filter = a.createBiquadFilter();
  const g = a.createGain();
  src.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.value = freq;
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS = {
  deal: () => [0, 0.07, 0.14, 0.21].forEach((at) => noise(at, 0.05, 0.5, 3200)),
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
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, "triangle", 0.11)),
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
  } catch {} // no audio support: stay silent
}

/** Call once from a click/keydown so later sounds are allowed to play. */
export function unlockAudio() {
  try {
    audio();
  } catch {}
}
