// Draws a maze as SVG markup in the weight of Parisha's marker: thick walls
// with round ends. Marks sit in cells: "on" is a green dot (on the route),
// "off" is a red cross (off it). Shape and colour both carry the meaning.
// Returns a string so the build script can bake drawings into the page and
// the game can draw its reveal with the same code.

const CELL = 40;

const escape = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// Joins neighbouring wall edges into long strokes, the way a hand draws them.
function wallRuns(maze) {
  const runs = [];
  for (let j = 0; j <= maze.rows; j++) {
    let from = null;
    for (let c = 0; c <= maze.cols; c++) {
      const wall = c < maze.cols && (j < maze.rows ? maze.walls[j][c].up : maze.walls[j - 1][c].down);
      if (wall && from === null) from = c;
      if (!wall && from !== null) {
        runs.push([from, j, c, j]);
        from = null;
      }
    }
  }
  for (let i = 0; i <= maze.cols; i++) {
    let from = null;
    for (let r = 0; r <= maze.rows; r++) {
      const wall = r < maze.rows && (i < maze.cols ? maze.walls[r][i].left : maze.walls[r][i - 1].right);
      if (wall && from === null) from = r;
      if (!wall && from !== null) {
        runs.push([i, from, i, r]);
        from = null;
      }
    }
  }
  return runs;
}

export function drawMaze(maze, { marks = [], title = '', animate = false, id = '' } = {}) {
  const pad = CELL * 0.5;
  const w = maze.cols * CELL + pad * 2;
  const h = maze.rows * CELL + pad * 2;
  const x = (c) => pad + c * CELL;
  const y = (r) => pad + r * CELL;
  const order = (i) => (animate ? ` style="--i:${i}"` : '');

  const walls = wallRuns(maze).map(([c1, r1, c2, r2], i) =>
    `<line x1="${x(c1)}" y1="${y(r1)}" x2="${x(c2)}" y2="${y(r2)}" pathLength="1"${order(i)}/>`);

  const s = CELL * 0.13;
  const dots = marks.map((m, i) => {
    const cx = x(m.c) + CELL / 2;
    const cy = y(m.r) + CELL / 2;
    if (m.kind === 'on') return `<circle class="mark-on" cx="${cx}" cy="${cy}" r="${CELL * 0.15}"${order(i)}/>`;
    return `<g class="mark-off" stroke-width="${CELL * 0.07}"${order(i)}>`
      + `<line x1="${cx - s}" y1="${cy - s}" x2="${cx + s}" y2="${cy + s}"/>`
      + `<line x1="${cx - s}" y1="${cy + s}" x2="${cx + s}" y2="${cy - s}"/></g>`;
  });

  const titleId = id ? `${id}-title` : '';
  return `<svg class="maze${animate ? ' is-drawing' : ''}" viewBox="0 0 ${w} ${h}" role="img"`
    + (title && titleId ? ` aria-labelledby="${titleId}"` : '') + `>`
    + (title ? `<title${titleId ? ` id="${titleId}"` : ''}>${escape(title)}</title>` : '')
    + `<g class="maze-walls" stroke-width="${CELL * 0.15}">${walls.join('')}</g>`
    + `<g class="maze-marks">${dots.join('')}</g></svg>`;
}
