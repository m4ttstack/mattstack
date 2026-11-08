// Every mattstack app's mark: a glyph on a 32-unit grid, centred on 16,16
// inside a 14-unit box, on a tile in a light step of the app's hue. Closed
// shapes are filled and every line takes one 2-unit round stroke, so the
// set reads as one family at 16px and at 512px.

export const APP_NAMES = [
  'chat',
  'console',
  'boxscore',
  'board',
  'deck',
] as const;
export type AppName = (typeof APP_NAMES)[number];

export interface AppMarkSpec {
  /** The hue as the palette menu names it (MattstackShell's `hue`); deck
      has no shell, so no palette hue. */
  hue?: 'pink' | 'purple' | 'blue' | 'cyan' | 'green' | 'orange';
  /** The hue's light-scheme fill, which the static icon files mix from. */
  fill: string;
  /** Closed shapes, filled and stroked. */
  shapes: string[];
  /** Open lines, stroked. */
  lines: string[];
}

export const MARK_INK = '#1d1830';
export const MARK_STROKE = 2;
const TILE_RADIUS = 7.2;
const TILE_MIX = 0.55;

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

const rounded = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
  `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}` +
  `v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

export const APP_MARKS: Record<AppName, AppMarkSpec> = {
  chat: {
    hue: 'pink',
    fill: '#e93d82',
    shapes: [
      'M11.5 9h9a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 1-3.5 3.5H16l-4.5 3.5V20A3.5 3.5 0 0 1 8 16.5v-4A3.5 3.5 0 0 1 11.5 9z',
    ],
    lines: [],
  },
  console: {
    hue: 'blue',
    fill: '#3e63dd',
    shapes: [],
    lines: ['M10 11l5 5-5 5M17 21h5'],
  },
  boxscore: {
    hue: 'green',
    fill: '#0d9b8a',
    // Each bar's stroke adds a unit either side, so the cores stay narrow
    // to keep a clear gap between bars at 16px.
    shapes: [
      rounded(9.5, 18, 1.5, 4, 0.75),
      rounded(15.25, 14, 1.5, 8, 0.75),
      rounded(21, 10, 1.5, 12, 0.75),
    ],
    lines: [],
  },
  board: {
    hue: 'purple',
    fill: '#8e4ec6',
    shapes: [circle(11, 22, 1.75), circle(21, 22, 1.75), circle(21, 10, 1.75)],
    lines: ['M21 11.75v8.5M11 20.25V17a3 3 0 0 1 3-3h7'],
  },
  deck: {
    fill: '#2c3242',
    shapes: [
      rounded(9.5, 9.5, 4.5, 4.5, 1),
      rounded(18, 9.5, 4.5, 4.5, 1),
      rounded(9.5, 18, 4.5, 4.5, 1),
      rounded(18, 18, 4.5, 4.5, 1),
    ],
    lines: [],
  },
};

/** The tile colour a static icon file uses: the hue mixed with white. */
export function markTile(app: AppName): string {
  const n = Number.parseInt(APP_MARKS[app].fill.slice(1), 16);
  const mix = (c: number) => Math.round(c * TILE_MIX + 255 * (1 - TILE_MIX));
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The glyph's paths, shared by the SVG file and the React mark. */
export function markPaths(app: AppName): { shapes: string; lines: string } {
  const { shapes, lines } = APP_MARKS[app];
  return { shapes: shapes.join(''), lines: lines.join('') };
}

/** The app's icon as a standalone SVG document: favicons, deck's served
    icons, the viewer's tabs and mattstack.dev all read this. */
export function appIconSvg(app: AppName): string {
  const { shapes, lines } = markPaths(app);
  const stroke = `stroke="${MARK_INK}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">',
    `  <rect width="32" height="32" rx="${TILE_RADIUS}" fill="${markTile(app)}"/>`,
    shapes ? `  <path d="${shapes}" fill="${MARK_INK}" ${stroke}/>` : null,
    lines ? `  <path d="${lines}" fill="none" ${stroke}/>` : null,
    '</svg>',
    '',
  ]
    .filter(line => line !== null)
    .join('\n');
}
