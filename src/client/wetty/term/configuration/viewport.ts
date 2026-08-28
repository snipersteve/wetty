import type { Term } from '../../term';

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const mobileViewportExtraRows = 1;

function terminalRowHeight(term: Term): number {
  const { textarea } = term;
  const lineHeight = Number.parseFloat(
    textarea ? window.getComputedStyle(textarea).lineHeight : '',
  );
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;

  const fontSize =
    typeof term.options.fontSize === 'number' ? term.options.fontSize : 14;
  const multiplier =
    typeof term.options.lineHeight === 'number' ? term.options.lineHeight : 1.2;
  return fontSize * multiplier;
}

/**
 Use the visual viewport, not the layout viewport, when the mobile soft
 keyboard is open. Some phones keep the layout viewport tall and merely cover
 the bottom with the keyboard; FitAddon then keeps too many rows and the app's
 prompt/input line sits too low. Shrink the terminal to the visible viewport
 and reserve a few extra rows above the keyboard.
 @param term - the wetty terminal to resize with viewport changes
 */
export function setupMobileViewport(term: Term): void {
  const { visualViewport } = window;
  if (!coarsePointer || visualViewport == null) return;

  const root = document.documentElement;
  let frame = 0;
  let resizeTimer = 0;

  const apply = (): void => {
    frame = 0;
    const viewport = window.visualViewport;
    if (viewport == null) return;

    const layoutHeight = window.innerHeight;
    // Only an *overlaying* keyboard (iOS: layout viewport stays tall, the
    // visual viewport shrinks) needs the page cut down and a clearance row.
    // Where the layout viewport itself resizes (Android Chrome with
    // interactive-widget=resizes-content, WebView shells that pad for the
    // IME), the flex layout already fits; cutting a row there leaves a
    // black strip above the keyboard that outlives it.
    const overlayKeyboard = viewport.height < layoutHeight - 80;
    const keyboardOpen =
      overlayKeyboard ||
      (term.textarea?.dataset.kbWanted === '1' &&
        viewport.height < layoutHeight - 8);

    if (keyboardOpen) {
      const extra = Math.round(
        terminalRowHeight(term) * mobileViewportExtraRows,
      );
      const height = Math.max(160, Math.floor(viewport.height - extra));
      root.dataset.wettyMobileKeyboard = '1';
      root.style.setProperty(
        '--wetty-mobile-viewport-height',
        `${String(height)}px`,
      );
    } else {
      delete root.dataset.wettyMobileKeyboard;
      root.style.removeProperty('--wetty-mobile-viewport-height');
    }

    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      term.resizeTerm();
    }, 80);
  };

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(apply);
  };

  visualViewport.addEventListener('resize', schedule);
  visualViewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  term.textarea?.addEventListener('focus', schedule);
  term.textarea?.addEventListener('blur', schedule);
  schedule();
}
