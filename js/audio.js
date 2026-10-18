// The sound language, synthesised with the Web Audio API so every cue is
// exactly reproducible and nothing has to download before play.
//
//   step   a wooden tap, like a game piece set down on a board
//   wall   a dull, close thud: the "touch" of a boundary
//   fork   two marimba notes: more than one way is open here
//   soft   soft and smooth: this way leads out          (Parisha's key)
//   harsh  rough and buzzing, no louder: this way doesn't (Parisha's key)
//   exit   the soft sound rising: you're out
//   up / down / left / right   route tones: high, low, two short, one long
//   empty  two dry ticks: no listens left
//
// Meaning is carried by pitch, rhythm and texture. Left/right panning is
// extra help on headphones, never the only clue, so laptop speakers work.

const SOFT_ROOT = 392; // G4
const ROUTE_MID = 523.25; // C5
const HARSH_PEAK = 0.6;

export function createAudio({ onStateChange } = {}) {
  let ctx = null;
  let master = null;
  let sfxBus = null;
  let voiceBus = null;
  let noise = null;
  let voice = null; // { src, fade } of the line playing now
  let target = null; // where sounds being scheduled right now connect to
  const groups = new Set(); // one gain per play()/sequence() call, so cues can be cut
  let mono = false;
  const levels = { sounds: 0.8, voice: 0.9 };

  function context() {
    if (!ctx) {
      // Without this, iPhones play Web Audio through the ringer channel, so
      // the game is silent when the phone's silent switch is on.
      if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx();
      ctx.addEventListener('statechange', () => {
        if (onStateChange) onStateChange(ctx.state);
      });
      // A gentle limiter keeps any pile-up of sounds from getting loud.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      master = ctx.createGain();
      master.connect(limiter).connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = levels.sounds;
      sfxBus.connect(master);
      voiceBus = ctx.createGain();
      voiceBus.gain.value = levels.voice;
      voiceBus.connect(master);

      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume();
    return ctx;
  }

  // Envelope: silent -> peak over `attack`, then decays to silence by `end`.
  function envelope(gainNode, t, peak, attack, end) {
    const g = gainNode.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + end);
    g.linearRampToValueAtTime(0, t + end + 0.02);
  }

  function output(pan) {
    const bus = target || sfxBus;
    if (!pan || mono || !ctx.createStereoPanner) return bus;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(bus);
    return p;
  }

  // Schedules one cue or sequence into its own gain node, so stopCues() can
  // silence it. If the browser has the clock frozen (sound blocked), the group
  // starts muted: otherwise every cue queued meanwhile would fire at once on resume.
  function scheduleGroup(build) {
    const c = context();
    const group = c.createGain();
    group.gain.value = c.state === 'running' ? 1 : 0;
    group.connect(sfxBus);
    target = group;
    let length;
    try {
      length = build(c.currentTime + 0.01);
    } finally {
      target = null;
    }
    groups.add(group);
    setTimeout(() => {
      groups.delete(group);
      group.disconnect();
    }, (length + 0.3) * 1000);
    return length;
  }

  function stopVoice(v) {
    if (ctx.state === 'running') {
      // A 5 ms fade instead of a hard stop, which would click.
      v.fade.gain.setTargetAtTime(0, ctx.currentTime, 0.005);
      try {
        v.src.stop(ctx.currentTime + 0.03);
      } catch {
        // Already stopped.
      }
    } else {
      try {
        v.src.stop();
      } catch {
        // Already stopped.
      }
    }
  }

  function osc({ type = 'sine', freq, glideTo, t, peak, attack = 0.005, end, pan = 0, filter }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + end * 0.8);
    const g = ctx.createGain();
    envelope(g, t, peak, attack, end);
    let node = o.connect(g);
    if (filter) node = node.connect(makeFilter(filter));
    node.connect(output(pan));
    o.start(t);
    o.stop(t + end + 0.05);
    o.onended = () => g.disconnect();
    return o;
  }

  function burst({ t, peak, end, filter, pan = 0 }) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const g = ctx.createGain();
    envelope(g, t, peak, 0.002, end);
    s.connect(makeFilter(filter)).connect(g).connect(output(pan));
    s.start(t);
    s.stop(t + end + 0.05);
    s.onended = () => g.disconnect();
  }

  function makeFilter({ type, freq, q = 0.7 }) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // Each sound schedules itself at time t and returns its length in seconds.
  const SOUNDS = {
    step(t, { pan = 0 } = {}) {
      burst({ t, peak: 0.9, end: 0.05, filter: { type: 'bandpass', freq: 1900, q: 1.4 }, pan });
      osc({ freq: 240, glideTo: 170, t, peak: 0.5, attack: 0.002, end: 0.07, pan });
      return 0.1;
    },
    wall(t) {
      osc({ freq: 105, glideTo: 52, t, peak: 0.75, attack: 0.003, end: 0.2 });
      burst({ t, peak: 0.35, end: 0.09, filter: { type: 'lowpass', freq: 320 } });
      return 0.25;
    },
    fork(t) {
      [783.99, 1174.66].forEach((f, i) => {
        const at = t + i * 0.11;
        osc({ freq: f, t: at, peak: 0.22, attack: 0.003, end: 0.4 });
        osc({ freq: f * 4, t: at, peak: 0.03, attack: 0.002, end: 0.08 });
      });
      return 0.55;
    },
    soft(t, { pan = 0 } = {}) {
      const filter = { type: 'lowpass', freq: 1400 };
      osc({ freq: SOFT_ROOT, t, peak: 0.14, attack: 0.09, end: 0.85, pan, filter });
      osc({ freq: SOFT_ROOT * 1.5, t: t + 0.04, peak: 0.09, attack: 0.09, end: 0.8, pan, filter });
      return 0.9;
    },
    harsh(t, { pan = 0 } = {}) {
      // Two notes a semitone apart beat against each other; a fast tremolo
      // adds grit. Levels are set (by measurement) to sit just under `soft`.
      const filter = { type: 'bandpass', freq: 950, q: 0.6 };
      const end = 0.5;
      const trem = ctx.createOscillator();
      trem.frequency.value = 19;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = 0.3;
      const vca = ctx.createGain();
      vca.gain.value = 0.7;
      trem.connect(tremDepth).connect(vca.gain);
      vca.connect(output(pan));
      [[233.08, 'sawtooth'], [246.94, 'square']].forEach(([freq, type]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        const g = ctx.createGain();
        envelope(g, t, HARSH_PEAK, 0.012, end);
        o.connect(g).connect(makeFilter(filter)).connect(vca);
        o.start(t);
        o.stop(t + end + 0.05);
        o.onended = () => g.disconnect();
      });
      trem.start(t);
      trem.stop(t + end + 0.05);
      trem.onended = () => vca.disconnect();
      return 0.6;
    },
    exit(t) {
      const filter = { type: 'lowpass', freq: 1800 };
      [1, 1.25, 1.5, 2].forEach((ratio, i) => {
        osc({ freq: SOFT_ROOT * ratio, t: t + i * 0.13, peak: 0.12, attack: 0.04, end: 1.1 - i * 0.1, filter });
      });
      return 1.3;
    },
    up(t) {
      pluck(t, 1046.5, 1174.66, 0.3, 0);
      return 0.45;
    },
    down(t) {
      pluck(t, 261.63, 233.08, 0.3, 0);
      return 0.45;
    },
    left(t) {
      pluck(t, ROUTE_MID, null, 0.11, -0.75);
      pluck(t + 0.16, ROUTE_MID, null, 0.11, -0.75);
      return 0.45;
    },
    right(t) {
      pluck(t, ROUTE_MID, null, 0.42, 0.75, 0.05);
      return 0.5;
    },
    empty(t) {
      burst({ t, peak: 1, end: 0.025, filter: { type: 'lowpass', freq: 900 } });
      burst({ t: t + 0.09, peak: 1, end: 0.025, filter: { type: 'lowpass', freq: 900 } });
      return 0.2;
    },
  };

  function pluck(t, freq, glideTo, end, pan, attack = 0.004) {
    const filter = { type: 'lowpass', freq: 3200 };
    osc({ type: 'triangle', freq, glideTo, t, peak: 0.42, attack, end, pan, filter });
    osc({ freq: freq * 2, glideTo: glideTo && glideTo * 2, t, peak: 0.06, attack, end: end * 0.6, pan });
  }

  const wait = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  return {
    unlock() {
      return context().resume();
    },

    get running() {
      return Boolean(ctx) && ctx.state === 'running';
    },

    get speaking() {
      return Boolean(voice);
    },

    // bus: 'sounds' or 'voice'; v from 0 to 1.
    setLevel(bus, v) {
      levels[bus] = v;
      const node = bus === 'voice' ? voiceBus : sfxBus;
      if (node) node.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
    },

    setMono(on) {
      mono = on;
    },

    // Plays a named sound; resolves when it has finished.
    play(name, opts) {
      return wait(scheduleGroup((t) => SOUNDS[name](t, opts)));
    },

    // Route tones in order, e.g. ['up', 'up', 'left'], scheduled on the audio
    // clock so the rhythm stays even however busy the page is.
    sequence(dirs, gap = 0.4) {
      return wait(scheduleGroup((t0) => {
        let t = t0 + 0.04;
        for (const dir of dirs) t += SOUNDS[dir](t) + gap;
        return t - t0;
      }));
    },

    // Silences every cue and route still playing or scheduled.
    stopCues() {
      if (!ctx) return;
      for (const group of groups) {
        group.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        groups.delete(group);
        setTimeout(() => group.disconnect(), 100);
      }
    },

    // Decoded voice clips are AudioBuffers; only one plays at a time.
    async decode(arrayBuffer) {
      return context().decodeAudioData(arrayBuffer);
    },

    speak(buffer) {
      const c = context();
      this.hush();
      const src = c.createBufferSource();
      src.buffer = buffer;
      const fade = c.createGain();
      src.connect(fade).connect(voiceBus);
      const line = { src, fade };
      voice = line;
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          if (voice === line) voice = null;
          resolve();
        };
        // If the browser holds the audio clock still (sound blocked), onended
        // never fires. The timer keeps the game moving, and stops the line so
        // it can't play late when sound comes back.
        const timer = setTimeout(() => {
          stopVoice(line);
          done();
        }, (buffer.duration + 0.5) * 1000);
        src.onended = () => {
          fade.disconnect();
          done();
        };
        src.start();
      });
    },

    hush() {
      if (voice) {
        stopVoice(voice);
        voice = null;
      }
    },
  };
}
