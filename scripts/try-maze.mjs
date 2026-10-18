// Prints the numbers that matter for a maze drawing passed on stdin.
import { parseMaze } from '../js/maze.js';
const ascii = await new Promise((res) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => res(s)); });
const m = parseMaze(ascii);
let reachable = 0, forks = 0, deadEnds = 0;
for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
  if (m.distanceToExit(r, c) < Infinity) reachable++;
  if (m.degree(r, c) >= 3) forks++;
  if (m.degree(r, c) === 1 && !(r === m.start.r && c === m.start.c) && !(r === m.exit.r && c === m.exit.c)) deadEnds++;
}
const route = m.route();
console.log(`${m.cols}x${m.rows}  reachable ${reachable}/${m.rows * m.cols}  route ${route.length - 1} moves  forks ${forks}  dead ends ${deadEnds}`);
console.log('fork choices on route:', m.forkChoices().map((f) => `(${f.r},${f.c}) ${f.dir}`).join(', ') || 'none');
