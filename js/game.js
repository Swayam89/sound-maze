import { parseMaze } from './maze.js';
import { LEVELS } from './levels.js';
import { createAudio } from './audio.js';
import { drawMaze } from './draw.js';

// Strings for this page's language are embedded by scripts/build.mjs.
const data = JSON.parse(document.getElementById('strings').textContent);
const lang = document.documentElement.lang;
const t = (key, vars = {}) => {
  if (!(key in data.ui)) throw new Error(`Missing string: ${key}`);
  return data.ui[key].replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
};

const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), stage: $('stage'), result: $('result') };
const board = $('board');
const captions = [$('caption'), $('result-caption')];
const live = $('live');
const pauseDialog = $('pause');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const audio = createAudio({ onStateChange: soundStateChanged });
const wait = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));

// Arrows by key; letters by physical position (e.code), so W/A/S/D, R and H
// still work when a Hindi keyboard layout is active.
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const LETTER_DIRS = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };

let state = 'menu'; // menu | intro | play | paused | result
let stateBeforePause = null;
let levelIndex = 0;
let maze = null;
let pos = null;
let run = null;
let heardWelcome = false;
let lastMoveAt = 0;
let routePlaying = null;

// ---------- Scripts ----------
// A script is a run of voice lines and sounds (an intro, a result readout).
// Each one gets its own token; starting another cancels the last, and a
// script only ever clears its own token.

let script = null;

function newScript() {
  stopScript();
  script = { cancelled: false };
  return script;
}

function endScript(token) {
  if (script === token) script = null;
}

function stopScript() {
  if (script) script.cancelled = true;
  script = null;
  audio.hush();
  audio.stopCues();
  routePlaying = null;
}

// ---------- Voice ----------

const VOICE_BASE = new URL(`../audio/${lang}/`, import.meta.url);
const clipFiles = new Map(); // id -> Promise<ArrayBuffer>
const clips = new Map(); // id -> Promise<AudioBuffer>
let voiceWorks = true;

function fetchClip(id) {
  if (!clipFiles.has(id)) {
    const file = fetch(new URL(`${id}.mp3`, VOICE_BASE)).then((res) => {
      if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    file.catch(() => clipFiles.delete(id));
    clipFiles.set(id, file);
  }
  return clipFiles.get(id);
}

function clip(id) {
  if (!clips.has(id)) {
    // decodeAudioData takes ownership of the buffer it's given, so decode a copy.
    const decoded = fetchClip(id).then((file) => audio.decode(file.slice(0)));
    decoded.catch(() => clips.delete(id));
    clips.set(id, decoded);
  }
  return clips.get(id);
}

// Fetch every line now so the first level doesn't wait; numbers load when needed.
Object.keys(data.voice).forEach((id) => fetchClip(id).catch(() => {}));

function showCaption(text) {
  for (const el of captions) el.textContent = text;
}

function announce(text) {
  live.textContent = '';
  // A fresh text node after a tick makes screen readers announce repeats too.
  setTimeout(() => { live.textContent = text; }, 30);
}

// Speaks a line. If the clip can't be had, or the browser is blocking sound,
// the text goes to the screen reader as well, and stays on screen for about
// the time it takes to read.
async function say(id, token = null) {
  const isNumber = id.startsWith('num_');
  const text = isNumber ? id.slice(4) : data.voice[id];
  if (!isNumber) showCaption(text);
  let buffer = null;
  try {
    buffer = await clip(id);
  } catch (err) {
    if (voiceWorks) console.warn('Voice clip unavailable, using text instead.', err);
    voiceWorks = false;
    $('voice-failed').hidden = false;
  }
  if (token && token.cancelled) return;
  if (!buffer || !audio.running) announce(text);
  if (buffer) await audio.speak(buffer);
  else await wait(Math.min(5, 0.8 + text.length * 0.05));
}

// Every wall bump gets a spoken line, rotating so it doesn't sound like one
// recording on repeat. A bump while any line is still playing gets only the
// thud, so lines never stack up or cut each other off.
const WALL_LINES = ['wall_1', 'wall_2', 'wall_3'];
let wallLine = 0;
let wallTalking = false;

function sayWall() {
  if (wallTalking || audio.speaking) return;
  wallTalking = true;
  const id = WALL_LINES[wallLine++ % WALL_LINES.length];
  // Let the thud land first, then speak.
  setTimeout(() => {
    if (state !== 'play') {
      wallTalking = false;
      return;
    }
    say(id).finally(() => { wallTalking = false; });
  }, 150);
}

// Runs a script (see levels.js for the format). Returns false if cancelled.
async function runScript(steps, token) {
  const thisRun = run;
  for (const step of steps) {
    if (token.cancelled) return false;
    if (step === '@route') {
      await playRoute();
      if (token.cancelled) return false;
      thisRun.routeHeard = true;
    } else if (step.startsWith('#')) {
      await audio.play(step.slice(1));
    } else {
      await say(step, token);
    }
    if (token.cancelled) return false;
    await wait(0.2);
  }
  return !token.cancelled;
}

// ---------- Screens ----------

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  document.body.dataset.screen = name;
}

function primaryResultAction() {
  return levelIndex < LEVELS.length - 1 ? $('next') : $('result-to-levels');
}

// Where focus belongs on the screen showing now.
function focusCurrent() {
  if (state === 'intro' || state === 'play') board.focus();
  else if (state === 'result') primaryResultAction().focus();
  else $('menu-title').focus();
}

function updateStatus() {
  const level = LEVELS[levelIndex];
  $('status-level').textContent = t('status_level', { n: levelIndex + 1 });
  $('status-listens').hidden = level.listens === 0;
  $('status-listens').textContent = t('status_listens', { n: level.listens - run.listensUsed });
  $('status-steps').textContent = t('status_steps', { n: run.steps });
  $('status-hint').textContent = state === 'intro' ? t('status_skip') : t('status_hint');
}

// ---------- Levels ----------

function routeDirs() {
  return maze.forkChoices().slice(0, LEVELS[levelIndex].sequence).map((f) => f.dir);
}

function playRoute() {
  const playing = audio.sequence(routeDirs());
  routePlaying = playing;
  playing.then(() => {
    if (routePlaying === playing) routePlaying = null;
  });
  return playing;
}

async function startLevel(i) {
  if (!LEVELS[i]) {
    toMenu();
    return;
  }
  const token = newScript();
  levelIndex = i;
  const level = LEVELS[i];
  maze = parseMaze(level.maze);
  pos = { r: maze.start.r, c: maze.start.c };
  run = {
    steps: 0, walls: 0, listensUsed: 0, replays: 0,
    path: [{ ...pos }], started: 0, pausedFor: 0, pausedAt: 0,
    routeHeard: false, skipped: false, lastCue: null, toldEmpty: false,
  };
  state = 'intro';
  show('stage');
  showCaption('');
  // Kept short: a screen reader reads it as focus lands, before the narrator.
  board.setAttribute('aria-label', t('status_level', { n: i + 1 }));
  updateStatus();
  board.focus();

  const steps = heardWelcome ? level.intro : ['welcome', ...level.intro];
  heardWelcome = true;
  await wait(0.8);
  if (await runScript(steps, token)) beginPlay(token);
}

function beginPlay(token) {
  endScript(token);
  state = 'play';
  if (run.skipped) showCaption('');
  if (!run.started) run.started = performance.now();
  updateStatus();
}

// Enter during the intro skips the teaching but still gives the route once;
// a second Enter skips that too.
function skipIntro() {
  const secondSkip = run.skipped;
  run.skipped = true;
  continueIntro(!secondSkip);
}

async function continueIntro(giveRoute) {
  const token = newScript();
  if (giveRoute && LEVELS[levelIndex].sequence > 0 && !run.routeHeard) {
    if (!(await runScript(['route_here', '@route', 'go'], token))) return;
  }
  beginPlay(token);
}

function panFor(c) {
  return maze.cols > 1 ? (c / (maze.cols - 1) - 0.5) * 1.2 : 0;
}

function step(dir) {
  const now = performance.now();
  if (now - lastMoveAt < 110) return;
  lastMoveAt = now;

  if (!maze.canMove(pos.r, pos.c, dir)) {
    run.walls++;
    run.lastCue = { name: 'wall' };
    audio.play('wall');
    sayWall();
    return;
  }
  pos = maze.move(pos.r, pos.c, dir);
  run.steps++;
  run.path.push({ ...pos });
  run.lastCue = { name: 'step', opts: { pan: panFor(pos.c) } };
  audio.play('step', run.lastCue.opts);
  updateStatus();

  if (pos.r === maze.exit.r && pos.c === maze.exit.c) {
    finish();
  } else if (maze.degree(pos.r, pos.c) >= 3) {
    run.lastCue = { name: 'fork' };
    setTimeout(() => { if (state === 'play') audio.play('fork'); }, 120);
  }
}

function listen(dir) {
  const level = LEVELS[levelIndex];
  const kind = maze.listen(pos.r, pos.c, dir);
  if (kind === 'wall') {
    run.lastCue = { name: 'wall' };
    audio.play('wall');
    sayWall();
    return;
  }
  if (run.listensUsed >= level.listens) {
    audio.play('empty');
    if (level.listens > 0 && !run.toldEmpty) {
      run.toldEmpty = true;
      setTimeout(() => say('no_listens'), 250);
    }
    return;
  }
  run.listensUsed++;
  const pan = dir === 'left' ? -0.7 : dir === 'right' ? 0.7 : 0;
  run.lastCue = { name: kind === 'right' ? 'soft' : 'harsh', opts: { pan } };
  audio.play(run.lastCue.name, run.lastCue.opts);
  updateStatus();
}

function repeat() {
  if (LEVELS[levelIndex].sequence > 0) {
    if (routePlaying) return;
    if (run.routeHeard) run.replays++;
    run.routeHeard = true;
    playRoute();
  } else if (run.lastCue) {
    audio.play(run.lastCue.name, run.lastCue.opts);
  }
}

// ---------- Result ----------

function score(shortest) {
  const extra = Math.max(0, run.steps - shortest);
  return Math.max(0, 100 - Math.min(40, extra) - 4 * run.listensUsed - 2 * run.replays);
}

function formatTime(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? t('minutes_seconds', { m, s }) : t('seconds', { s });
}

async function finish() {
  state = 'result';
  const token = newScript();
  const elapsed = performance.now() - run.started - run.pausedFor;
  const route = maze.route();
  const shortest = route.length - 1;
  const points = score(shortest);
  const level = LEVELS[levelIndex];
  const last = levelIndex === LEVELS.length - 1;

  // The way out is announced on the blank page; then the maze is revealed.
  await audio.play('exit');
  if (token.cancelled) return;
  await say('out', token);
  if (token.cancelled) return;

  // Footprints: each square once, in the order first visited.
  const onRoute = new Set(route.map(({ r, c }) => `${r},${c}`));
  const seen = new Set();
  const marks = [];
  for (const { r, c } of run.path) {
    const k = `${r},${c}`;
    if (seen.has(k)) continue;
    seen.add(k);
    marks.push({ r, c, kind: onRoute.has(k) ? 'on' : 'off' });
  }

  $('result-title').textContent = t('result_heading', { n: levelIndex + 1 });
  $('reveal').innerHTML = drawMaze(maze, {
    marks,
    title: t('reveal_caption'),
    animate: !reducedMotion.matches,
    id: 'reveal-maze',
  });
  $('reveal-sketch').hidden = !level.sketch;

  const stats = {
    stat_steps: run.steps,
    stat_shortest: shortest,
    stat_listens: level.listens ? `${run.listensUsed} / ${level.listens}` : null,
    stat_replays: level.sequence ? run.replays : null,
    stat_walls: run.walls,
    stat_time: formatTime(elapsed),
  };
  $('stats').replaceChildren(...Object.entries(stats).filter(([, v]) => v !== null).map(([key, value]) => {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = t(key);
    dd.textContent = value;
    div.append(dt, dd);
    return div;
  }));
  $('score').textContent = points;
  // Suddha asked for competition; without a server, the honest version is a
  // best score kept on this device, so people sharing a laptop can compare.
  const best = Math.max(points, loadSetting(`best-${level.id}`, 0));
  saveSetting(`best-${level.id}`, best);
  $('best').textContent = t('best_on_device', { n: best });
  $('next').hidden = last;
  $('all-done').hidden = !last;

  show('result');
  showCaption('');
  // Focus goes to the button the narrator tells you to press, so Enter works
  // in every screen reader mode. A pause lets the screen reader speak first.
  primaryResultAction().focus();
  await wait(1.2);
  for (const id of ['score', `num_${points}`, last ? 'all_done' : 'next']) {
    if (token.cancelled) return;
    await say(id, token);
  }
  endScript(token);
}

// ---------- Pause ----------

function openPause() {
  if (state !== 'intro' && state !== 'play') return;
  stateBeforePause = state;
  stopScript();
  state = 'paused';
  if (run.started) run.pausedAt = performance.now();
  pauseDialog.showModal();
}

function closePause() {
  if (state !== 'paused') return;
  if (pauseDialog.open) pauseDialog.close();
  if (run.pausedAt) {
    run.pausedFor += performance.now() - run.pausedAt;
    run.pausedAt = 0;
  }
  board.focus();
  // A paused intro doesn't restart: play goes on, with the route given first
  // if the player hasn't heard it yet.
  if (stateBeforePause === 'intro') {
    state = 'intro';
    continueIntro(true);
  } else {
    state = 'play';
  }
}

// Resume runs straight from the button and from Escape, not from the dialog's
// close event, which browsers may deliver late.
pauseDialog.addEventListener('cancel', (e) => {
  e.preventDefault();
  closePause();
});
pauseDialog.addEventListener('close', closePause);

$('resume').addEventListener('click', closePause);
$('restart').addEventListener('click', () => {
  state = 'menu';
  pauseDialog.close();
  startLevel(levelIndex);
});
$('skip-level').addEventListener('click', () => {
  state = 'menu';
  pauseDialog.close();
  if (levelIndex < LEVELS.length - 1) startLevel(levelIndex + 1);
  else toMenu();
});
$('pause-to-levels').addEventListener('click', () => {
  state = 'menu';
  pauseDialog.close();
  toMenu();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) openPause();
});

// ---------- Settings (kept on this device) ----------

function loadSetting(key, fallback) {
  try {
    const v = localStorage.getItem(`sound-maze-${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(`sound-maze-${key}`, JSON.stringify(value));
  } catch {
    // Storage blocked: the setting lasts until the page closes.
  }
}

for (const bus of ['sounds', 'voice']) {
  const input = $(`volume-${bus}`);
  input.value = loadSetting(`volume-${bus}`, Number(input.value));
  audio.setLevel(bus, input.value / 100);
  input.addEventListener('input', () => {
    audio.setLevel(bus, input.value / 100);
    saveSetting(`volume-${bus}`, Number(input.value));
  });
}
const monoInput = $('mono');
monoInput.checked = loadSetting('mono', false);
audio.setMono(monoInput.checked);
monoInput.addEventListener('change', () => {
  audio.setMono(monoInput.checked);
  saveSetting('mono', monoInput.checked);
});

// ---------- Input ----------

board.addEventListener('keydown', (e) => {
  const dir = ARROWS[e.key] || LETTER_DIRS[e.code];
  const isRepeat = e.code === 'KeyR';
  const isHelp = e.code === 'KeyH';
  if (e.key === 'Escape') {
    e.preventDefault();
    openPause();
    return;
  }
  if (dir || isRepeat || isHelp || e.key === 'Enter') e.preventDefault();
  // A held key may keep walking, but must not burn listens, replays or help.
  if (e.repeat && (e.shiftKey || isRepeat || isHelp || e.key === 'Enter')) return;
  if (state === 'intro') {
    if (e.key === 'Enter') skipIntro();
    return;
  }
  if (state !== 'play') return;
  if (dir) {
    if (e.shiftKey) listen(dir);
    else step(dir);
  } else if (isRepeat) {
    repeat();
  } else if (isHelp) {
    say('help');
  }
});

// Clicking anywhere on the play area gives the keys back to the maze.
screens.stage.addEventListener('click', () => {
  if (state === 'intro' || state === 'play') board.focus();
});

// On the result screen, Enter, Space or Escape cut the readout short. Enter
// with focus lost (after a click on the drawing) still takes the next step.
document.addEventListener('keydown', (e) => {
  if (state !== 'result') return;
  if (['Enter', ' ', 'Escape'].includes(e.key) && script) stopScript();
  const lost = e.target === document.body || e.target === $('result-title');
  if (e.key === 'Enter' && lost) {
    e.preventDefault();
    primaryResultAction().click();
  }
});

function toMenu() {
  stopScript();
  state = 'menu';
  show('menu');
  $('menu-title').focus();
}

function soundStateChanged(soundState) {
  const button = $('audio-resume');
  if (soundState === 'running') {
    if (button.contains(document.activeElement)) focusCurrent();
    button.hidden = true;
  } else if (state !== 'menu' && button.hidden) {
    button.hidden = false;
    announce(t('audio_blocked'));
  }
}

// Must run inside a click or key handler. Never waits: if the browser keeps
// sound blocked, the game still starts and offers a button to turn it on.
function unlockAudio() {
  audio.unlock();
  setTimeout(() => {
    if (!audio.running) soundStateChanged('suspended');
  }, 1000);
}

document.querySelectorAll('[data-level]').forEach((button) => {
  button.addEventListener('click', () => {
    unlockAudio();
    startLevel(Number(button.dataset.level));
  });
});

document.querySelectorAll('[data-sound]').forEach((button) => {
  button.addEventListener('click', () => {
    unlockAudio();
    audio.play(button.dataset.sound);
  });
});

// Each sentence gets time to be read out before its step plays, so screen
// reader users don't hear the right-hand step while "left" is still being read.
$('sound-check').addEventListener('click', async () => {
  unlockAudio();
  const out = $('sound-check-says');
  out.textContent = t('sound_check_left');
  await wait(1.8);
  await audio.play('step', { pan: -1 });
  await wait(0.6);
  out.textContent = t('sound_check_right');
  await wait(1.8);
  await audio.play('step', { pan: 1 });
});

$('next').addEventListener('click', () => startLevel(levelIndex + 1));
$('again').addEventListener('click', () => startLevel(levelIndex));
$('result-to-levels').addEventListener('click', toMenu);
$('audio-resume').addEventListener('click', () => {
  focusCurrent();
  unlockAudio();
});
$('voice-retry').addEventListener('click', () => {
  voiceWorks = true;
  clipFiles.clear();
  clips.clear();
  focusCurrent();
  $('voice-failed').hidden = true;
  Object.keys(data.voice).forEach((id) => fetchClip(id).catch(() => {}));
});

// Phones and tablets without a keyboard get told up front.
if (matchMedia('(hover: none) and (pointer: coarse)').matches) $('no-keyboard').hidden = false;

show('menu');
