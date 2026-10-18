# Sound Maze

A design project by Parisha Jain: a maze game played by sound and touch. This
repository holds the project site and the browser demo, the sound half of the
game, in English and Hindi.

- `index.html`, `hi/index.html`: the project page
- `play/`, `hi/play/`: the game

## Editing

The four HTML pages are generated. Change the text in `content/` and run:

```
node scripts/build.mjs
```

Set `SITE_URL` to the published address when building for release, so share
previews get absolute links:

```
SITE_URL=https://<user>.github.io/<repo>/ node scripts/build.mjs
```

| File | What it holds |
| --- | --- |
| `content/site.json` | Project page text, `en` and `hi` |
| `content/ui.json`, `content/ui-extra.json` | Game interface text |
| `content/voice.json` | Narrator lines; each key matches `audio/<lang>/<key>.mp3` |
| `content/sources.json` | The five papers cited in the research |
| `js/levels.js` | The four mazes, drawn as text |
| `js/audio.js` | The sound language, synthesised in the browser |

If a line in `content/voice.json` changes, its recording in `audio/en` or
`audio/hi` has to be made again to match.

To try it locally, serve the folder (the game uses JavaScript modules, which
don't load from `file://`):

```
python3 -m http.server 8000
```
