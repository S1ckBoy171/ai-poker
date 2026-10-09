// Run: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { play, startMusic, stopMusic } from "./sound.ts";

// Node has no Web Audio, so a fake context records what starts playing:
// a decoded recording, a synthesized noise buffer, or "oscillator" for a synthesized tone.
const started: unknown[] = [];

type FakeAudioNode = ReturnType<typeof fakeAudioNode>;

function fakeAudioNode() {
  const node = {
    type: "",
    buffer: null as unknown,
    frequency: { value: 0 },
    gain: {
      value: 0,
      rampedTo: 0,
      setValueAtTime() {},
      cancelScheduledValues() {},
      linearRampToValueAtTime(volume: number) {
        node.gain.rampedTo = volume;
      },
      exponentialRampToValueAtTime() {},
    },
    connect: (next: unknown) => next,
    disconnect() {},
    start() {
      started.push(node.buffer ?? "oscillator");
    },
    stop() {},
  };
  return node;
}

// A music track: an <audio> element whose output is wired to its own volume node.
const musicElements: FakeAudioElement[] = [];

class FakeAudioElement extends EventTarget {
  src: string;
  duration = 120;
  currentTime = 0;
  paused = true;
  volumeNode: FakeAudioNode | null = null;

  constructor(src: string) {
    super();
    this.src = src;
    musicElements.push(this);
  }

  async play() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }
}

function fakeMediaElementSource(element: FakeAudioElement) {
  const source = fakeAudioNode();
  source.connect = (next: unknown) => {
    element.volumeNode = next as FakeAudioNode;
    return next;
  };
  return source;
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  createOscillator = fakeAudioNode;
  createGain = fakeAudioNode;
  createBiquadFilter = fakeAudioNode;
  createBufferSource = fakeAudioNode;
  createMediaElementSource = fakeMediaElementSource;

  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }

  async decodeAudioData(bytes: ArrayBuffer) {
    return { decodedFrom: new TextDecoder().decode(bytes) };
  }
}

// Only card.mp3 exists; every other sound file is a 404.
const requestedUrls: string[] = [];

async function fakeFetch(url: string | URL | Request) {
  requestedUrls.push(String(url));
  if (String(url) !== "/assets/sounds/card.mp3") {
    return new Response("Not found", { status: 404 });
  }
  return new Response("card recording");
}

globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
globalThis.Audio = FakeAudioElement as unknown as typeof Audio;
globalThis.fetch = fakeFetch;

test("a sound with a file plays the recording instead of the synthesized version", async () => {
  started.length = 0;

  await play("card");

  assert.deepEqual(started, [{ decodedFrom: "card recording" }]);
});

test("a sound without a file plays the synthesized version and asks for the file only once", async () => {
  started.length = 0;

  await play("chip");
  await play("chip");

  assert.deepEqual(started, ["oscillator", "oscillator", "oscillator", "oscillator"]);
  const chipRequests = requestedUrls.filter((url) => url === "/assets/sounds/chip.mp3");
  assert.equal(chipRequests.length, 1);
});

test("music fades in quietly, crossfades into the next track near the end, and fades out on stop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  startMusic();
  startMusic(); // a later click while music plays starts nothing new
  await flushPromises();

  assert.equal(musicElements.length, 1);
  const [first] = musicElements;
  assert.match(first.src, /^\/assets\/music\/.+\.mp3$/);
  assert.equal(first.paused, false);
  const firstVolume = first.volumeNode?.gain.rampedTo ?? 0;
  assert.ok(firstVolume > 0 && firstVolume <= 0.1, `quiet music volume, got ${firstVolume}`);

  first.currentTime = first.duration - 5;
  first.dispatchEvent(new Event("timeupdate"));
  await flushPromises();

  assert.equal(musicElements.length, 2);
  const [, second] = musicElements;
  assert.notEqual(second.src, first.src);
  assert.equal(second.paused, false);
  assert.ok((second.volumeNode?.gain.rampedTo ?? 0) > 0);
  assert.equal(first.volumeNode?.gain.rampedTo, 0);

  stopMusic();
  t.mock.timers.tick(1000);

  assert.equal(second.volumeNode?.gain.rampedTo, 0);
  assert.equal(first.paused, true);
  assert.equal(second.paused, true);
});
