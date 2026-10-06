import type { Term } from '../../term';

/** Deliberate right swipe, measured in CSS pixels (independent of density). */
export function isSwitcherSwipe(
  dx: number,
  dy: number,
  elapsed: number,
): boolean {
  return dx >= 64 && dx > Math.abs(dy) * 1.5 && elapsed < 700;
}

/**
 * Click Herdr's existing mobile Switch button, not the desktop sidebar toggle.
 * Read the rendered cells so this is a no-op in the open switcher, overlays,
 * ordinary shells, and desktop layout. Herdr's header is at most two rows high;
 * its Switch button occupies the last ten columns.
 */
export function openMobileSwitcher(term: Term, screen: HTMLElement): boolean {
  if (
    term.modes.mouseTrackingMode === 'none' ||
    term.buffer.active.type !== 'alternate'
  ) {
    return false;
  }
  const buffer = term.buffer.active;
  const firstCol = Math.max(0, term.cols - 10);
  for (let row = 0; row < Math.min(2, term.rows); row += 1) {
    const line = buffer.getLine(buffer.viewportY + row);
    const label = line?.translateToString(true, firstCol, term.cols) ?? '';
    if (/^\s*│?\s*switch\s*$/.test(label)) {
      const rect = screen.getBoundingClientRect();
      const clientX =
        rect.left + ((firstCol + term.cols) / 2) * (rect.width / term.cols);
      const clientY = rect.top + (row + 0.5) * (rect.height / term.rows);
      for (const type of ['mousedown', 'mouseup']) {
        screen.dispatchEvent(
          new MouseEvent(type, {
            button: 0,
            buttons: type === 'mousedown' ? 1 : 0,
            clientX,
            clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return true;
    }
  }
  return false;
}
