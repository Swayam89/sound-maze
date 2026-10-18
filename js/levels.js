// The four levels. Every maze starts bottom left and exits top right, like
// Parisha's drawing, so players can rely on that from the first level.
//
// intro:    what plays before the level, in order. Plain ids are voice lines
//           (content/voice.json), "#name" is a sound, "@route" plays the route.
// listens:  how many times the player may listen down a path (Shift + arrow)
// sequence: how many fork choices the route tones give away

export const LEVELS = [
  {
    id: 'steps',
    intro: ['l1_title', 'teach_step', '#step', 'teach_wall', '#wall', 'teach_exit', '#exit', 'l1_go'],
    listens: 0,
    sequence: 0,
    maze: `
+--+--+--+--+
|           E
+  +--+--+--+
|           |
+--+--+--+  +
S           |
+--+--+--+--+`,
  },
  {
    id: 'listen',
    intro: ['l2_title', 'teach_fork', '#fork', 'teach_listen', 'teach_soft', '#soft', 'teach_harsh', '#harsh', 'l2_go'],
    listens: 4,
    sequence: 0,
    maze: `
+--+--+--+--+--+
|              E
+  +--+--+  +--+
|     |     |  |
+--+--+  +--+  +
S              |
+--+--+--+--+--+`,
  },
  {
    id: 'remember',
    intro: ['l3_title', 'teach_dirs', 'dir_up', '#up', 'dir_down', '#down', 'dir_left', '#left', 'dir_right', '#right',
      'teach_route', 'route_here', '@route', 'go'],
    listens: 2,
    sequence: 3,
    maze: `
+--+--+--+--+--+--+
|                 E
+  +  +--+--+--+--+
|  |  |           |
+  +  +--+--+--+  +
|  |              |
+  +--+--+  +--+--+
|        |  |     |
+--+--+--+  +--+  +
S                 |
+--+--+--+--+--+--+`,
  },
  {
    // Traced from Parisha's hand-drawn sketch on a 10 x 10 grid.
    id: 'parisha',
    intro: ['l4_title', 'l4_intro', 'route_here', '@route', 'go'],
    listens: 4,
    sequence: 3,
    maze: `
+--+--+--+--+--+--+--+--+--+--+
|        |     |     |        E
+--+  +  +--+  +  +  +--+--+  +
|  |  |     |     |           |
+  +  +--+  +  +--+--+--+  +--+
|  |     |     |     |     |  |
+  +--+  +--+--+  +--+--+--+  +
|     |        |  |     |     |
+  +--+--+  +--+  +  +  +--+  +
|  |        |     |  |        |
+  +  +--+--+  +--+  +  +  +--+
|  |     |  |        |  |  |  |
+  +--+  +  +--+  +--+  +  +  +
|        |              |  |  |
+--+--+  +  +--+  +--+--+  +  +
|        |  |  |  |           |
+  +--+  +  +  +  +  +  +--+--+
|  |        |        |  |     |
+  +--+--+  +  +--+  +--+  +  +
S                 |        |  |
+--+--+--+--+--+--+--+--+--+--+`,
    // Where her red and green dots fall on the traced grid, as [row, col].
    sketch: {
      green: [[9, 0], [5, 1], [2, 1], [7, 1], [0, 2], [3, 2], [5, 2], [1, 3], [4, 3], [2, 4], [3, 4], [0, 5], [1, 6], [0, 9]],
      red: [[1, 0], [6, 0], [8, 1], [3, 1], [5, 3], [5, 4], [4, 4], [7, 4], [2, 5], [9, 5], [4, 5], [3, 6], [5, 6], [2, 7], [8, 7],
        [3, 7], [6, 7], [3, 8], [9, 8], [5, 9], [1, 9], [2, 9], [9, 9], [7, 9], [4, 9]],
    },
  },
];
