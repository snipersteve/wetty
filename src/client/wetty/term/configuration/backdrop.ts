/**
 Paint the slack around the character grid in the app's own background.

 A terminal is an integer number of cells; whatever is left of the
 container's width/height shows the page background — a visible strip on
 the right (and below) whenever a full-screen app (herdr, vim, …) paints
 its own background color. Instead of guessing the color, sample it from
 the cells along the right and bottom edges after each render and apply it
 to the container and xterm's theme background. Follows theme changes in
 the app for free.
 */
import { debugLog } from './debug';
import type { Term } from '../../term';

// xterm's default 16-color palette (matches DEFAULT_ANSI_COLORS in xterm).
const ANSI16 = [
  '#2e3436',
  '#cc0000',
  '#4e9a06',
  '#c4a000',
  '#3465a4',
  '#75507b',
  '#06989a',
  '#d3d7cf',
  '#555753',
  '#ef2929',
  '#8ae234',
  '#fce94f',
  '#729fcf',
  '#ad7fa8',
  '#34e2e2',
  '#eeeeec',
];

function paletteToCss(index: number): string | undefined {
  if (index < 16) return ANSI16[index];
  if (index < 232) {
    const i = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(i / 36)];
    const g = steps[Math.floor((i % 36) / 6)];
    const b = steps[i % 6];
    return `rgb(${String(r)},${String(g)},${String(b)})`;
  }
  if (index < 256) {
    const v = 8 + (index - 232) * 10;
    return `rgb(${String(v)},${String(v)},${String(v)})`;
  }
  return undefined;
}

/**
 Background color of one cell as CSS, or undefined for the default
 (theme) background.
 @param term - terminal to read from
 @param row - viewport-relative row
 @param col - column
 */
function cellBg(term: Term, row: number, col: number): string | undefined {
  const buf = term.buffer.active;
  const cell = buf.getLine(buf.viewportY + row)?.getCell(col);
  if (cell === undefined) return undefined;
  if (cell.isBgRGB()) {
    return `#${cell.getBgColor().toString(16).padStart(6, '0')}`;
  }
  if (cell.isBgPalette()) return paletteToCss(cell.getBgColor());
  return undefined;
}

/**
 Keep the container's background in step with the edge cells of the grid.
 @param term - the wetty terminal
 @param container - the element hosting the terminal (its slack shows)
 */
export function setupBackdrop(term: Term, container: HTMLElement): void {
  let current = '';
  let pending = 0;

  const sample = (): void => {
    pending = 0;
    if (term.cols < 2 || term.rows < 2) return;
    const lastCol = term.cols - 1;
    const lastRow = term.rows - 1;
    // Right edge (top / middle / bottom) plus the bottom edge (left /
    // middle): the majority color wins, so a status bar or a selection
    // touching one corner does not flip the whole page.
    const votes = new Map<string, number>();
    for (const [row, col] of [
      [0, lastCol],
      [Math.floor(lastRow / 2), lastCol],
      [lastRow, lastCol],
      [lastRow, 0],
      [lastRow, Math.floor(lastCol / 2)],
    ]) {
      const c = cellBg(term, row, col) ?? '';
      votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    let best = '';
    let bestVotes = 0;
    votes.forEach((n, c) => {
      if (n > bestVotes) {
        best = c;
        bestVotes = n;
      }
    });
    if (best === current) return;
    current = best;
    debugLog(`backdrop ${best || 'default'}`);
    container.style.backgroundColor = best;
    document.body.style.backgroundColor = best;
    // The default-bg color is what xterm paints under the grid and in the
    // viewport slack; keep it in sync so the seam disappears entirely.
    const theme = term.options.theme ?? {};
    term.options.theme = { ...theme, background: best || undefined };
    // Belt and braces: xterm's scroll layer carries its own inline
    // background; set it directly in case the theme update lags a frame.
    for (const sel of ['.xterm-scrollable-element', '.xterm-viewport']) {
      const el = term.element?.querySelector<HTMLElement>(sel);
      if (el) el.style.backgroundColor = best;
    }
  };

  term.onRender(() => {
    // Coalesce: onRender fires per frame; sampling once per animation frame
    // is plenty and keeps theme swaps (a full restyle) off the hot path.
    if (pending !== 0) return;
    pending = requestAnimationFrame(sample);
  });
}
