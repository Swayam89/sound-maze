// Maze model. Mazes are drawn as ASCII so they can be read and checked by eye:
//
//   +--+--+      "+" corners, "--" a wall along the top/bottom of a cell,
//   S  |  |      "|" a wall at the side of a cell, spaces are openings.
//   +  +  +      "S" and "E" on the outer edge mark the way in and the way out.
//   |     E
//   +--+--+
//
// Each cell is 3 characters wide and 2 lines tall.

export const DIRECTIONS = ['up', 'right', 'down', 'left'];

const STEP = {
  up: [-1, 0],
  right: [0, 1],
  down: [1, 0],
  left: [0, -1],
};

export function parseMaze(ascii) {
  const lines = ascii.replace(/^\n+|\s+$/g, '').split('\n').map((l) => l.trimEnd());
  const rows = (lines.length - 1) / 2;
  const cols = (lines[0].length - 1) / 3;
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new Error(`Maze drawing has an odd shape: ${lines.length} lines, ${lines[0].length} columns`);
  }
  const width = cols * 3 + 1;
  const grid = lines.map((l) => l.padEnd(width, ' '));

  let start = null;
  let exit = null;

  // Character(s) on the edge between a cell and its neighbour in `dir`.
  const edge = (r, c, dir) => {
    switch (dir) {
      case 'up': return grid[2 * r].slice(3 * c + 1, 3 * c + 3);
      case 'down': return grid[2 * r + 2].slice(3 * c + 1, 3 * c + 3);
      case 'left': return grid[2 * r + 1][3 * c];
      case 'right': return grid[2 * r + 1][3 * c + 3];
      default: throw new Error(`Unknown direction ${dir}`);
    }
  };

  const walls = [];
  for (let r = 0; r < rows; r++) {
    walls.push([]);
    for (let c = 0; c < cols; c++) {
      const cell = {};
      for (const dir of DIRECTIONS) {
        const e = edge(r, c, dir);
        cell[dir] = e.includes('-') || e.includes('|');
        const onBoundary = (dir === 'up' && r === 0) || (dir === 'down' && r === rows - 1)
          || (dir === 'left' && c === 0) || (dir === 'right' && c === cols - 1);
        if (onBoundary) {
          if (e.includes('S')) start = { r, c, side: dir };
          else if (e.includes('E')) exit = { r, c, side: dir };
          else cell[dir] = true;
        }
      }
      walls[r].push(cell);
    }
  }
  if (!start || !exit) throw new Error('Maze needs an S and an E on its outer edge');
  return createMaze({ rows, cols, walls, start, exit });
}

function createMaze({ rows, cols, walls, start, exit }) {
  const inside = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
  const key = (r, c) => r * cols + c;

  const canMove = (r, c, dir) => {
    if (walls[r][c][dir]) return false;
    const [dr, dc] = STEP[dir];
    return inside(r + dr, c + dc);
  };

  const neighbours = (r, c) => DIRECTIONS
    .filter((dir) => canMove(r, c, dir))
    .map((dir) => ({ dir, r: r + STEP[dir][0], c: c + STEP[dir][1] }));

  const degree = (r, c) => neighbours(r, c).length;

  // Steps from every cell to the exit cell (BFS from the exit).
  const distance = Array(rows * cols).fill(Infinity);
  distance[key(exit.r, exit.c)] = 0;
  const queue = [[exit.r, exit.c]];
  while (queue.length) {
    const [r, c] = queue.shift();
    for (const n of neighbours(r, c)) {
      if (distance[key(n.r, n.c)] === Infinity) {
        distance[key(n.r, n.c)] = distance[key(r, c)] + 1;
        queue.push([n.r, n.c]);
      }
    }
  }
  const distanceToExit = (r, c) => distance[key(r, c)];

  // What listening down a direction tells you: "wall", or whether that way
  // brings you closer to the exit ("right") or not ("wrong").
  const listen = (r, c, dir) => {
    if (!canMove(r, c, dir)) return 'wall';
    const [dr, dc] = STEP[dir];
    return distanceToExit(r + dr, c + dc) < distanceToExit(r, c) ? 'right' : 'wrong';
  };

  // Shortest route from the start cell to the exit cell, as a list of cells.
  const route = () => {
    const path = [{ r: start.r, c: start.c }];
    let { r, c } = start;
    while (!(r === exit.r && c === exit.c)) {
      const next = neighbours(r, c).find((n) => distanceToExit(n.r, n.c) === distanceToExit(r, c) - 1);
      if (!next) throw new Error('Exit cannot be reached from the start');
      ({ r, c } = next);
      path.push({ r, c });
    }
    return path;
  };

  // The direction taken at each fork (3+ ways open) along the shortest route.
  const forkChoices = () => {
    const path = route();
    const choices = [];
    for (let i = 0; i < path.length - 1; i++) {
      const { r, c } = path[i];
      if (degree(r, c) >= 3) {
        const next = path[i + 1];
        const dir = DIRECTIONS.find((d) => STEP[d][0] === next.r - r && STEP[d][1] === next.c - c);
        choices.push({ r, c, dir });
      }
    }
    return choices;
  };

  return {
    rows, cols, walls, start, exit,
    inside, canMove, neighbours, degree, distanceToExit, listen, route, forkChoices,
    move(r, c, dir) {
      const [dr, dc] = STEP[dir];
      return { r: r + dr, c: c + dc };
    },
  };
}
