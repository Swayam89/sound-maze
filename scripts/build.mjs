// Writes the four pages (English and Hindi, project page and game) from the
// files in content/. Run with: node scripts/build.mjs
// Fails loudly on a missing string instead of shipping a gap.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseMaze } from '../js/maze.js';
import { LEVELS } from '../js/levels.js';
import { drawMaze } from '../js/draw.js';

const root = new URL('../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

// ui-extra.json holds strings added after the main translation pass.
const ui = { ...(await readJson('content/ui.json')), ...(await readJson('content/ui-extra.json')) };
const voice = await readJson('content/voice.json');
const site = await readJson('content/site.json').catch(() => null);
const sources = await readJson('content/sources.json');

// Short content hashes on asset links, so a changed file is never served from cache.
const hashOf = async (path) => createHash('sha256').update(await readFile(new URL(path, root))).digest('hex').slice(0, 8);
const JS_MODULES = ['maze', 'levels', 'audio', 'draw', 'game', 'site'];
const v = { css: await hashOf('css/style.css') };
for (const name of JS_MODULES) v[name] = await hashOf(`js/${name}.js`);

// Modules import each other by plain path; the import map points every one of
// those paths at its hashed URL, so nested imports are cache-safe too.
const importMap = (base) => `<script type="importmap">${JSON.stringify({
  // Keys must look like paths (./ or ../), or they're treated as bare names.
  imports: Object.fromEntries(JS_MODULES.map((name) => [`${base || './'}js/${name}.js`, `${base || './'}js/${name}.js?v=${v[name]}`])),
})}</script>`;

const LANGS = ['en', 'hi'];
const other = (lang) => (lang === 'en' ? 'hi' : 'en');
const missing = [];

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function uiFor(lang) {
  const out = {};
  for (const [key, entry] of Object.entries(ui)) {
    if (!entry[lang]) missing.push(`ui.${key}.${lang}`);
    out[key] = entry[lang] ?? entry.en;
  }
  return out;
}

function voiceFor(lang) {
  const out = {};
  for (const [key, entry] of Object.entries(voice)) {
    if (!entry[lang]) missing.push(`voice.${key}.${lang}`);
    out[key] = entry[lang] ?? entry.en;
  }
  return out;
}

const fill = (text, vars, key = '?') => {
  if (typeof text !== 'string') throw new Error(`Missing string in content/ui.json: ${key}`);
  return text.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
};

// Paths: Hindi pages live under /hi/, the game under /play/.
function paths(lang, page) {
  const depth = (lang === 'hi' ? 1 : 0) + (page === 'play' ? 1 : 0);
  const base = '../'.repeat(depth);
  const langRoot = lang === 'hi' ? `${base}hi/` : base;
  const otherRoot = lang === 'hi' ? base : `${base}hi/`;
  return {
    base,
    home: langRoot || './',
    play: `${langRoot}play/`,
    otherHere: page === 'play' ? `${otherRoot}play/` : otherRoot || './',
  };
}

// Set SITE_URL (e.g. https://name.github.io/sound-maze/) when building for
// publishing; share cards need absolute URLs.
const LANGS_FOR_OG = ['en', 'hi'];
const SITE_URL = process.env.SITE_URL ? process.env.SITE_URL.replace(/\/?$/, '/') : '';
// The share image is the whole sketch; its alt text is the page's, minus the
// last sentence ("A full description follows"), which means nothing in a card.
const dropLastSentence = (text) => text.replace(/\s*[^.।]*[.।]\s*$/, '');
const ogAlt = Object.fromEntries(LANGS_FOR_OG.map((l) => [l, dropLastSentence(site?.[l]?.maze.sketch_alt ?? '')]));
const FONTS = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible+Next:wght@400;700;800&amp;family=Mukta:wght@400;600;800&amp;display=swap';

function head({ lang, title, description, base, path }) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="Parisha Jain">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${base}img/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="${FONTS}"></noscript>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:locale" content="${lang === 'hi' ? 'hi_IN' : 'en_IN'}">
<meta name="twitter:card" content="summary_large_image">${SITE_URL ? `
<meta property="og:url" content="${SITE_URL}${path}">
<meta property="og:image" content="${SITE_URL}img/og.png">
<meta property="og:image:alt" content="${esc(ogAlt[lang])}">` : ''}
<link rel="stylesheet" href="${base}css/style.css?v=${v.css}">
${importMap(base)}`;
}

const soundIds = ['step', 'wall', 'fork', 'soft', 'harsh', 'exit', 'up', 'down', 'left', 'right', 'empty'];

function soundList(t) {
  return `<ul class="sound-list">
${soundIds.map((id) => `  <li><button class="button button--small button--line" type="button" data-sound="${id}" aria-describedby="sound-${id}">${esc(t('sound_play'))}<span class="visually-hidden"> ${esc(t(`sound_${id}_name`))}</span></button>
    <span class="name">${esc(t(`sound_${id}_name`))}</span>
    <span class="meaning" id="sound-${id}">${esc(t(`sound_${id}_meaning`))}</span></li>`).join('\n')}
</ul>`;
}

// ---------- Game page ----------

function playPage(lang) {
  const t0 = uiFor(lang);
  const t = (key, vars = {}) => fill(t0[key], vars, key);
  const p = paths(lang, 'play');
  const strings = JSON.stringify({ ui: t0, voice: voiceFor(lang) }).replace(/</g, '\\u003c');

  return `${head({ lang, title: t('page_title'), description: t('intro'), base: p.base, path: `${lang === 'hi' ? 'hi/' : ''}play/` })}
<script type="module" src="${p.base}js/game.js?v=${v.game}"></script>
</head>
<body class="game">
<header class="site-header">
  <a class="site-name" href="${p.home}">${esc(t('back'))}</a>
  <a class="lang-switch" href="${p.otherHere}" lang="${other(lang)}" hreflang="${other(lang)}">${esc(t('lang_switch'))}</a>
</header>
<main id="main">
  <p class="notice" id="no-keyboard" hidden>${esc(t('keyboard_only'))} <a href="${p.home}">${esc(t('keyboard_only_link'))}</a></p>
  <p class="notice" id="voice-failed" hidden>${esc(t('load_error'))} <button class="button button--small button--line" id="voice-retry" type="button">${esc(t('retry'))}</button></p>
  <button class="button" id="audio-resume" type="button" hidden>${esc(t('audio_blocked'))}</button>

  <section class="menu" id="menu" aria-labelledby="menu-title">
    <div>
      <h1 id="menu-title" tabindex="-1">Sound Maze</h1>
      <p class="intro">${esc(t('intro'))}</p>
      <p>${esc(t('headphones'))}</p>
    </div>

    <section aria-labelledby="levels-heading">
      <h2 id="levels-heading">${esc(t('levels_heading'))}</h2>
      <ol class="levels">
${LEVELS.map((level, i) => `        <li><button class="level-button" type="button" data-level="${i}">
          <span class="n">${esc(t('status_level', { n: i + 1 }))}</span>
          <span class="name">${esc(t(`level_${i + 1}_name`))}</span>
          <span class="desc">${esc(t(`level_${i + 1}_desc`))}</span>
          <span class="go">${esc(t('level_play', { n: i + 1 }))}</span>
        </button></li>`).join('\n')}
      </ol>
    </section>

    <section aria-labelledby="controls-heading">
      <h2 id="controls-heading">${esc(t('controls_heading'))}</h2>
      <dl class="controls">
        <dt>${esc(t('key_move'))}</dt><dd>${esc(t('key_move_desc'))}</dd>
        <dt>${esc(t('key_listen'))}</dt><dd>${esc(t('key_listen_desc'))}</dd>
        <dt><kbd>${esc(t('key_repeat'))}</kbd></dt><dd>${esc(t('key_repeat_desc'))}</dd>
        <dt><kbd>${esc(t('key_help'))}</kbd></dt><dd>${esc(t('key_help_desc'))}</dd>
        <dt><kbd>${esc(t('key_pause'))}</kbd></dt><dd>${esc(t('key_pause_desc'))}</dd>
        <dt><kbd>${esc(t('key_skip'))}</kbd></dt><dd>${esc(t('key_skip_desc'))}</dd>
      </dl>
      <p class="sr-note">${esc(t('screen_reader_note'))}</p>
    </section>

    <section aria-labelledby="sounds-heading">
      <h2 id="sounds-heading">${esc(t('sounds_heading'))}</h2>
      <p>${esc(t('sounds_intro'))}</p>
      ${soundList(t)}
      <p><button class="button button--line" id="sound-check" type="button">${esc(t('sound_check'))}</button></p>
      <p id="sound-check-says" aria-live="polite"></p>
    </section>
  </section>

  <section class="stage" id="stage" hidden aria-labelledby="stage-title">
    <h1 class="visually-hidden" id="stage-title">Sound Maze</h1>
    <p class="paper-note">${esc(t('paper_note'))}</p>
    <div class="board" id="board" role="application" tabindex="0" aria-label="">
      <p class="caption" id="caption" aria-hidden="true"></p>
    </div>
    <p class="status"><span id="status-level"></span><span id="status-listens"></span><span id="status-steps"></span><span class="hint" id="status-hint"></span></p>
  </section>

  <section class="result" id="result" hidden aria-labelledby="result-title">
    <h1 id="result-title" tabindex="-1"></h1>
    <div class="result-grid">
      <div class="reveal-pair">
        <figure class="reveal">
          <div id="reveal"></div>
          <figcaption class="figure-note">${esc(t('reveal_caption'))}</figcaption>
        </figure>
        <figure id="reveal-sketch" hidden>
          <img src="${p.base}img/sketch-maze.png" width="900" height="900" alt="${esc(t('sketch_maze_alt'))}">
          <figcaption class="figure-note">${esc(t('reveal_sketch_caption'))}</figcaption>
        </figure>
      </div>
      <div class="result-side">
        <p class="score-line"><span>${esc(t('score_label'))}</span> <strong id="score"></strong></p>
        <p class="best" id="best"></p>
        <dl class="stats" id="stats"></dl>
        <p class="score-rule">${esc(t('score_rule'))}</p>
        <p class="caption caption--result" id="result-caption" aria-hidden="true"></p>
        <p id="all-done" hidden>${esc(t('all_done'))}</p>
        <div class="actions">
          <button class="button" id="next" type="button">${esc(t('next_level'))}</button>
          <button class="button button--line" id="again" type="button">${esc(t('play_again'))}</button>
          <button class="button button--line" id="result-to-levels" type="button">${esc(t('to_levels'))}</button>
        </div>
      </div>
    </div>
  </section>

  <dialog class="pause" id="pause" aria-labelledby="pause-heading">
    <h2 id="pause-heading">${esc(t('pause_heading'))}</h2>
    <div class="actions">
      <button class="button" id="resume" type="button">${esc(t('resume'))}</button>
      <button class="button button--line" id="restart" type="button">${esc(t('restart'))}</button>
      <button class="button button--line" id="skip-level" type="button">${esc(t('skip_level'))}</button>
      <button class="button button--line" id="pause-to-levels" type="button">${esc(t('to_levels'))}</button>
    </div>
    <fieldset>
      <label>${esc(t('volume_sounds'))}<input id="volume-sounds" type="range" min="0" max="100" value="80"></label>
      <label>${esc(t('volume_voice'))}<input id="volume-voice" type="range" min="0" max="100" value="90"></label>
      <label class="check"><input id="mono" type="checkbox"> ${esc(t('mono'))}</label>
    </fieldset>
  </dialog>

  <div id="live" class="visually-hidden" aria-live="polite"></div>
</main>
<script type="application/json" id="strings">${strings}</script>
</body>
</html>
`;
}

// ---------- Project page ----------

function projectPage(lang) {
  const s = site?.[lang];
  if (!s) {
    missing.push(`site.${lang} (project page not built)`);
    return null;
  }
  const t0 = uiFor(lang);
  const t = (key, vars = {}) => fill(t0[key], vars, key);
  const p = paths(lang, 'home');
  const paras = (list) => list.map((text) => `<p>${esc(text)}</p>`).join('\n');

  const parisha = LEVELS.find((l) => l.sketch);
  const maze = parseMaze(parisha.maze);
  const herDots = [
    ...parisha.sketch.green.map(([r, c]) => ({ r, c, kind: 'on' })),
    ...parisha.sketch.red.map(([r, c]) => ({ r, c, kind: 'off' })),
  ];
  const trace = drawMaze(maze, { marks: herDots, title: s.maze.trace_caption, id: 'trace' });

  return `${head({ lang, title: s.meta.title, description: s.meta.description, base: p.base, path: lang === 'hi' ? 'hi/' : '' })}
<script type="module" src="${p.base}js/site.js?v=${v.site}"></script>
</head>
<body>
<a class="skip-link" href="#main">${esc(s.skip_link)}</a>
<header class="site-header">
  <a class="site-name" href="${p.home}">Sound Maze</a>
  <nav class="site-nav" aria-label="${esc(s.nav_label)}">
    <ul>
      <li><a href="#idea">${esc(s.nav.idea)}</a></li>
      <li><a href="#research">${esc(s.nav.research)}</a></li>
      <li><a href="#sounds">${esc(s.nav.sounds)}</a></li>
      <li><a href="#maze">${esc(s.nav.maze)}</a></li>
      <li><a href="${p.play}">${esc(s.nav.play)}</a></li>
    </ul>
  </nav>
  <a class="lang-switch" href="${p.otherHere}" lang="${other(lang)}" hreflang="${other(lang)}">${esc(s.lang_switch)}</a>
</header>

<main id="main" class="page">
  <section class="hero" aria-labelledby="title">
    <div>
      <h1 id="title">${esc(s.hero.title)}</h1>
      <p class="lede">${esc(s.hero.lede)}</p>
      <p class="byline">${esc(s.hero.byline)}</p>
      <p class="actions">
        <a class="button" href="${p.play}">${esc(s.hero.play)}</a>
        <a class="button button--line" href="#sounds">${esc(s.hero.hear)}</a>
        <span class="play-note">${esc(s.hero.play_note)}</span>
      </p>
    </div>
    <figure class="sketch">
      <img src="${p.base}img/sketch.png" width="1600" height="1131" alt="${esc(s.maze.sketch_alt)}">
      <figcaption>${esc(s.maze.sketch_caption)}</figcaption>
    </figure>
  </section>

  <hr class="wall" style="--gap: 62%">

  <section class="section" id="idea" aria-labelledby="idea-heading">
    <h2 id="idea-heading">${esc(s.concept.heading)}</h2>
    <div class="prose">${paras(s.concept.paragraphs)}</div>
  </section>

  <section class="section" aria-labelledby="question-heading">
    <h2 id="question-heading">${esc(s.question.heading)}</h2>
    <p class="question-text">${esc(s.question.text)}</p>
    <div class="columns">
      <div class="prose">
        <h3 class="subheading">${esc(s.question.objectives_heading)}</h3>
        <ul class="plain-list">${s.question.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>
      <div class="prose">
        <h3 class="subheading">${esc(s.question.audience_heading)}</h3>
        ${paras(s.question.audience)}
      </div>
    </div>
  </section>

  <hr class="wall" style="--gap: 18%">

  <section class="section" id="research" aria-labelledby="people-heading">
    <h2 id="people-heading">${esc(s.people.heading)}</h2>
    <div class="prose"><p>${esc(s.people.intro)}</p></div>
    <ul class="people">
${s.people.profiles.map((person) => `      <li class="person"><h3>${esc(person.name)} <span class="age">${esc(person.age)}</span></h3><p>${esc(person.text)}</p></li>`).join('\n')}
    </ul>
  </section>

  <section class="section" aria-labelledby="interviews-heading">
    <h2 id="interviews-heading">${esc(s.interviews.heading)}</h2>
    <div class="prose"><p>${esc(s.interviews.intro)}</p>${s.footer.translation_note ? `<p>${esc(s.footer.translation_note)}</p>` : ''}</div>
${s.interviews.questions.map((q) => `    <section class="interview">
      <h3>${esc(q.q)}</h3>
      <ul class="answers">
${q.answers.map((a) => `        <li><blockquote><p>${esc(a.text)}</p></blockquote><p class="who">${esc(a.name)}</p></li>`).join('\n')}
      </ul>
    </section>`).join('\n')}
  </section>

  <section class="section" aria-labelledby="insights-heading">
    <h2 id="insights-heading">${esc(s.insights.heading)}</h2>
    <div class="prose">${paras(s.insights.paragraphs)}</div>
  </section>

  <section class="section" aria-labelledby="secondary-heading">
    <h2 id="secondary-heading">${esc(s.secondary.heading)}</h2>
    <div class="prose"><p>${esc(s.secondary.intro)}</p></div>
    <ol class="sources">
${sources.map((src) => `      <li><span${lang === 'en' ? '' : ' lang="en"'}><a href="${esc(src.url)}" hreflang="en">${esc(src.authors)} (${esc(src.year)}). ${esc(src.title)}</a>. <i>${esc(src.journal)}</i>.</span><span class="finding">${esc(lang === 'hi' ? src.finding_hi ?? src.finding_en : src.finding_en)}</span></li>`).join('\n')}
    </ol>
    <h3 class="subheading">${esc(s.secondary.takeaways_heading)}</h3>
    <div class="prose">${paras(s.secondary.takeaways)}</div>
  </section>

  <hr class="wall" style="--gap: 40%">

  <section class="section" aria-labelledby="form-heading">
    <h2 id="form-heading">${esc(s.form.heading)}</h2>
    <p class="form-statement">${esc(s.form.statement)}</p>
    <dl class="equations">
${s.form.features.map((f) => `      <dt>${esc(f.term)}</dt><dd class="equals" aria-hidden="true">=</dd><dd>${esc(f.meaning)}</dd>`).join('\n')}
    </dl>
  </section>

  <section class="section" aria-labelledby="decisions-heading">
    <h2 id="decisions-heading">${esc(s.decisions.heading)}</h2>
    <div class="prose"><p>${esc(s.decisions.intro)}</p></div>
    <ul class="decisions">
${s.decisions.items.map((d) => `      <li><p><span class="label">${esc(t('decision_from'))}</span>${esc(d.from)}</p><p><span class="label">${esc(t('decision_to'))}</span>${esc(d.to)}</p></li>`).join('\n')}
    </ul>
  </section>

  <hr class="wall" style="--gap: 80%">

  <section class="section" id="sounds" aria-labelledby="sounds-heading">
    <h2 id="sounds-heading">${esc(s.sound_key.heading)}</h2>
    <div class="columns">
      <figure class="her-key">
        <img src="${p.base}img/sketch-key.png" width="560" height="744" alt="${esc(s.sound_key.her_key)}">
      </figure>
      <div class="prose">
        <p>${esc(s.sound_key.intro)}</p>
        <p>${esc(s.sound_key.loudness_note)}</p>
      </div>
    </div>
    ${soundList(t)}
  </section>

  <section class="section" id="maze" aria-labelledby="maze-heading">
    <h2 id="maze-heading">${esc(s.maze.heading)}</h2>
    <div class="prose"><p>${esc(s.maze.intro)}</p></div>
    <div class="maze-pair">
      <figure>
        <img src="${p.base}img/sketch-maze.png" width="900" height="900" alt="${esc(t('sketch_maze_alt'))}">
        <figcaption class="figure-note">${esc(s.maze.sketch_caption)}</figcaption>
      </figure>
      <figure>
        ${trace}
        <figcaption class="figure-note">${esc(s.maze.trace_caption)}</figcaption>
      </figure>
    </div>
    <div class="prose">${paras(s.maze.trace_notes)}</div>
    <details>
      <summary>${esc(t('description_label'))}</summary>
      <p>${esc(s.maze.sketch_description)}</p>
    </details>
  </section>

  <hr class="wall" style="--gap: 30%">

  <section class="section play-section" aria-labelledby="play-heading">
    <h2 id="play-heading">${esc(s.play.heading)}</h2>
    <div class="prose"><p>${esc(s.play.text)}</p></div>
    <p><a class="button" href="${p.play}">${esc(s.play.button)}</a></p>
    <div class="prose access-note">
      <h3 class="subheading">${esc(t('access_heading'))}</h3>
      <p>${esc(t('access_note'))}</p>
    </div>
  </section>
</main>

<footer class="site-footer">
  <p class="made-by">${esc(s.footer.made_by)}</p>
  <p>${esc(t('typefaces'))}</p>
</footer>
</body>
</html>
`;
}

for (const lang of LANGS) {
  const dir = lang === 'hi' ? 'hi/' : '';
  await mkdir(new URL(`${dir}play/`, root), { recursive: true });
  const project = projectPage(lang);
  if (project) await writeFile(new URL(`${dir}index.html`, root), project);
  await writeFile(new URL(`${dir}play/index.html`, root), playPage(lang));
}

if (missing.length) {
  console.error(`Missing translations (English used instead):\n  ${missing.join('\n  ')}`);
  process.exitCode = 1;
}
console.log('Built index.html, play/index.html, hi/index.html, hi/play/index.html');
