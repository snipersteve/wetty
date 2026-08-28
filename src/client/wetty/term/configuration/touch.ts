import { applyCtrl } from '../../ctrl';
import { copySelected } from './clipboard';
import { debugLog } from './debug';
import type { Term } from '../../term';

// Primary pointer is a finger (phones/tablets) — touch-screen laptops keep
// their physical-keyboard behavior.
const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

/**
 Deliberately summon the soft keyboard. On coarse-pointer devices the
 helper textarea is kept at inputmode="none" AND unfocused, so that no
 browser-initiated focus (synthesized clicks, tap-target snapping) can
 ever raise the keyboard. Summoning flips inputmode to "text" and focuses
 from the clean unfocused state — mobile browsers only re-evaluate the
 keyboard on a fresh focus, not on a blur()/focus() dance inside one task.
 @param term - the wetty terminal to focus
 */
export function summonKeyboard(term: Term): void {
  const { textarea } = term;
  if (textarea && coarsePointer) {
    // Rare: a stray focus survived. Blur first (the blur listener re-arms
    // the dormant state), then set what the focus below should honor.
    // readOnly is the belt to inputmode's suspenders: Android never raises
    // the IME for a readonly textarea, however focus reached it.
    if (document.activeElement === textarea) textarea.blur();
    textarea.dataset.kbWanted = '1';
    textarea.dataset.kbWantedAt = String(Date.now());
    textarea.readOnly = false;
    textarea.inputMode = 'text';
  }
  term.focus();
}

/**
 Forward soft-keyboard text to the terminal. iOS keyboards emit keydown
 events with keyCode 229 for character keys, which xterm ignores; the
 characters only surface as `input` events on the helper textarea, which
 xterm never listens to. Forwarding them here is safe from double-sends:
 any key xterm does handle gets preventDefault'ed on keydown and therefore
 never mutates the textarea, so no `input` event fires for it. IME
 composition is left to xterm's own composition helper.
 @param term - the wetty terminal whose textarea to watch
 */
function setupSoftKeyboardInput(term: Term): void {
  const { textarea } = term;
  if (!textarea) return;

  let composing = false;
  let keydownIgnored = false;
  textarea.addEventListener('compositionstart', () => {
    composing = true;
  });
  textarea.addEventListener('compositionend', () => {
    // xterm's composition helper reads the textarea value on a timeout;
    // wait it out before resuming, then drop the leftover value so it
    // doesn't leak into later composition snapshots.
    setTimeout(() => {
      composing = false;
      textarea.value = '';
    }, 100);
  });
  textarea.addEventListener('keydown', (e: KeyboardEvent) => {
    // 229 in the deprecated keyCode is the only reliable marker for
    // soft-keyboard input that xterm will drop.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    keydownIgnored = e.keyCode === 229;
  });
  textarea.addEventListener('input', (e: Event) => {
    const ev = e as InputEvent;
    if (composing || ev.isComposing) return;
    // xterm's own `_inputEvent` already forwards events that never saw a
    // keydown; only pick up the ones it drops — soft keyboards (iOS) fire
    // keydown 229 before each character, which makes xterm skip them.
    if (!ev.composed || !keydownIgnored) return;
    keydownIgnored = false;
    if (ev.inputType === 'insertText' && ev.data !== null) {
      // Sticky Ctrl from the key bar: soft keyboards never produce a real
      // keydown, so the control-code translation happens here.
      term.input(applyCtrl(ev.data) ?? ev.data, true);
      textarea.value = '';
    } else if (
      ev.inputType === 'insertLineBreak' ||
      ev.inputType === 'insertParagraph'
    ) {
      term.input('\r', true);
      textarea.value = '';
    } else if (ev.inputType === 'deleteContentBackward') {
      term.input('\x7F', true);
      textarea.value = '';
    }
  });
}

/**
 Scroll the terminal by whole lines with the semantics native emulators
 use: wheel reports for mouse-tracking apps (tmux, herdr), arrow keys in
 the alternate buffer (vim, less), scrollback otherwise.
 @param term - the terminal to scroll
 @param screen - the .xterm-screen element (wheel dispatch target)
 @param lines - line count, positive scrolls towards newer content
 @param clientX - pointer x for the wheel report cell position
 @param clientY - pointer y for the wheel report cell position
 */
function scrollTermLines(
  term: Term,
  screen: HTMLElement,
  lines: number,
  clientX: number,
  clientY: number,
): void {
  if (term.modes.mouseTrackingMode !== 'none') {
    // The app owns the mouse: hand xterm wheel events so it encodes proper
    // wheel reports (position included, for panes), one per line. Note
    // apps may scroll several lines per report (tmux defaults to 5).
    for (let i = 0; i < Math.abs(lines); i += 1) {
      screen.dispatchEvent(
        new WheelEvent('wheel', {
          // One line per event in DOM_DELTA_LINE mode: xterm damps and
          // quantizes small DOM_DELTA_PIXEL deltas (trackpad smoothing),
          // which would swallow most of the gesture.
          deltaY: Math.sign(lines),
          deltaMode: WheelEvent.DOM_DELTA_LINE,
          clientX,
          clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  } else if (term.buffer.active.type === 'alternate') {
    // No scrollback in the alternate buffer — send arrow keys instead,
    // like native terminal emulators do.
    const app = term.modes.applicationCursorKeysMode;
    let seq: string;
    if (lines > 0) {
      seq = app ? '\x1bOB' : '\x1b[B';
    } else {
      seq = app ? '\x1bOA' : '\x1b[A';
    }
    term.input(seq.repeat(Math.abs(lines)), true);
  } else {
    term.scrollLines(lines);
  }
}

/**
 Trackpads emit streams of small DOM_DELTA_PIXEL wheel events, and xterm
 damps deltas under 50px to 30% ("trackpad smoothing"). Combined with
 one-line-per-report apps (herdr) that makes two-finger scrolling crawl.
 Intercept pixel wheels for the mouse-tracking and alternate-buffer cases
 and emit whole lines ourselves; the normal buffer keeps xterm's native
 smooth scrolling.
 @param term - the wetty terminal
 @param screen - the .xterm-screen element to intercept wheels on
 */
function setupTrackpadWheel(term: Term, screen: HTMLElement): void {
  let remainder = 0;
  screen.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // LINE/PAGE deltas (wheel mice on some platforms, our own synthetic
      // events) already scroll acceptably through xterm.
      if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return;
      const mouseApp = term.modes.mouseTrackingMode !== 'none';
      if (!mouseApp && term.buffer.active.type !== 'alternate') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const cellHeight = screen.clientHeight / term.rows;
      // Wheel mice send large discrete ticks (~100-120px); classic
      // terminals scroll about 3 lines per tick, so scale ticks down.
      // Trackpads stream small deltas; slightly under finger distance
      // feels right.
      const scaled =
        Math.abs(e.deltaY) >= 50 ? e.deltaY * 0.45 : e.deltaY * 0.75;
      const delta = scaled + remainder;
      const lines = Math.trunc(delta / cellHeight);
      remainder = delta - lines * cellHeight;
      if (lines !== 0) {
        scrollTermLines(term, screen, lines, e.clientX, e.clientY);
      }
    },
    { capture: true, passive: false },
  );
}

/**
 Transient bottom-center toast confirming a long-press copy.
 */
function showCopyToast(): void {
  const el = document.createElement('div');
  el.textContent = '已复制 · Copied';
  el.style.cssText =
    'position:fixed;left:50%;bottom:15%;transform:translateX(-50%);' +
    'background:rgba(0,0,0,.75);color:#fff;padding:6px 14px;' +
    'border-radius:14px;font:13px sans-serif;z-index:9998;' +
    'pointer-events:none;transition:opacity .3s;';
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
  }, 900);
  setTimeout(() => {
    el.remove();
  }, 1300);
}

/**
 xterm.js has no built-in touch support: on phones a swipe pans nothing and
 taps don't reliably summon the soft keyboard. Translate touch gestures
 ourselves, mirroring what desktop terminals do with the mouse wheel:
 - app enabled mouse tracking (tmux & co): synthesize wheel events so xterm
   emits wheel reports and the app scrolls its own buffer;
 - alternate buffer without mouse tracking (vim, less): send arrow keys,
   since the alternate buffer has no scrollback;
 - otherwise: scroll the scrollback buffer directly.
 Taps: a single tap is a plain click (delivered to mouse-aware apps, never
 summons the soft keyboard); a double tap focuses the terminal to open it.
 @param term - the wetty terminal to attach touch handlers to
 */
export function setupTouch(term: Term): void {
  const screen = term.element?.querySelector('.xterm-screen');
  if (!(screen instanceof HTMLElement)) return;

  setupSoftKeyboardInput(term);
  setupTrackpadWheel(term, screen);
  const debug = debugLog;

  // No browser context menu over the terminal: on Android it interrupts
  // long-press selection, on desktop it covers the right-click
  // interactions of mouse-aware apps (herdr gets the click as a button-2
  // report instead). Paste still works via Ctrl+Shift+V / ⌘V.
  screen.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  const { textarea } = term;
  if (textarea && coarsePointer) {
    // Default state on finger-first devices: readonly, inputmode="none",
    // unfocused. Only summonKeyboard() (double tap / on-screen keyboard
    // button) lifts it.
    const arm = (): void => {
      delete textarea.dataset.kbWanted;
      textarea.inputMode = 'none';
      textarea.readOnly = true;
    };
    arm();
    // Take over the focus method: Android re-evaluates the IME on focus()
    // calls that produce NO focus event (element already focused), which
    // is invisible to every listener. Swallow all programmatic focus —
    // from xterm's internals and wetty alike — unless deliberately
    // summoned via summonKeyboard().
    const nativeFocus = textarea.focus.bind(textarea);
    textarea.focus = (options?: FocusOptions): void => {
      if (textarea.dataset.kbWanted === '1') {
        nativeFocus(options);
      } else {
        debug('focus swallowed');
      }
    };
    textarea.addEventListener('blur', () => {
      arm();
      debug('blur: re-armed');
    });
    textarea.addEventListener('focus', () => {
      if (textarea.dataset.kbWanted !== '1') {
        // Stray native focus (tap-target snapping) while dormant: drop it
        // so a later summon starts from a clean unfocused state.
        setTimeout(() => {
          if (
            textarea.dataset.kbWanted !== '1' &&
            document.activeElement === textarea
          ) {
            debug('stray focus: blurred');
            textarea.blur();
          }
        }, 0);
      }
    });
    // Android's back button hides the IME without blurring the textarea,
    // leaving it armed — the next tap would then re-raise the keyboard.
    // A large visual-viewport growth means the keyboard closed: re-arm.
    // Ignore growth during the first moments after a summon: the opening
    // animation makes the viewport oscillate (iOS reports intermediate
    // heights) and must not be mistaken for a dismissal.
    let lastViewportHeight = window.visualViewport?.height ?? 0;
    window.visualViewport?.addEventListener('resize', () => {
      const height = window.visualViewport?.height ?? 0;
      if (
        height - lastViewportHeight > 150 &&
        textarea.dataset.kbWanted === '1' &&
        Date.now() - Number(textarea.dataset.kbWantedAt ?? 0) > 1500
      ) {
        debug('keyboard dismissed: re-arm');
        arm();
        if (document.activeElement === textarea) textarea.blur();
      }
      lastViewportHeight = height;
    });
  }

  let touchId: number | undefined;
  let startY = 0;
  let startTime = 0;
  let lastY = 0;
  let scrolling = false;
  let lastTapAt = 0;
  // Long-press selection: word-select under the finger, drag to extend,
  // release to copy. This replaces the native selection action bar, which
  // never appears for xterm's custom-drawn selection.
  let selecting = false;
  let selectAnchor: { col: number; row: number } | undefined;
  let longPressTimer = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;

  const cellFromPoint = (
    x: number,
    y: number,
  ): { col: number; row: number } => {
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    const clamp = (v: number, max: number): number =>
      Math.min(max, Math.max(0, v));
    return {
      col: clamp(Math.floor((x - rect.left) / cellW), term.cols - 1),
      row:
        term.buffer.active.viewportY +
        clamp(Math.floor((y - rect.top) / cellH), term.rows - 1),
    };
  };

  const extendSelection = (to: { col: number; row: number }): void => {
    if (selectAnchor === undefined) return;
    let start = selectAnchor;
    let end = to;
    const pos = (c: { col: number; row: number }): number =>
      c.row * term.cols + c.col;
    if (pos(end) < pos(start)) [start, end] = [end, start];
    term.select(start.col, start.row, pos(end) - pos(start) + 1);
  };

  const beginSelection = (): void => {
    const cell = cellFromPoint(lastTouchX, lastTouchY);
    const line =
      term.buffer.active.getLine(cell.row)?.translateToString(false) ?? '';
    let s = cell.col;
    let e = cell.col;
    if ((line[cell.col] ?? ' ') !== ' ') {
      while (s > 0 && line[s - 1] !== ' ') s -= 1;
      while (e < line.length - 1 && line[e + 1] !== ' ') e += 1;
    }
    selectAnchor = { col: s, row: cell.row };
    term.select(s, cell.row, e - s + 1);
    selecting = true;
    debug('long-press: selection mode');
  };

  const cancelLongPress = (): void => {
    if (longPressTimer !== 0) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
  };

  // Two-finger long-press = right-click for mouse-aware apps (herdr menus
  // and the like); the browser context menu is suppressed anyway.
  let twoFingerTimer = 0;
  let twoFingerMid: { x: number; y: number } | undefined;

  const cancelTwoFinger = (): void => {
    if (twoFingerTimer !== 0) {
      clearTimeout(twoFingerTimer);
      twoFingerTimer = 0;
    }
  };

  const beginTwoFinger = (a: Touch, b: Touch): void => {
    twoFingerMid = {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    };
    twoFingerTimer = window.setTimeout(() => {
      twoFingerTimer = 0;
      if (term.modes.mouseTrackingMode === 'none' || !twoFingerMid) return;
      debug('two-finger long-press: right-click');
      for (const [type, buttons] of [
        ['mousedown', 2],
        ['mouseup', 0],
      ] as const) {
        screen.dispatchEvent(
          new MouseEvent(type, {
            button: 2,
            buttons,
            clientX: twoFingerMid.x,
            clientY: twoFingerMid.y,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }, 500);
  };
  // Flick state: velocity in px/ms (positive = finger moving up), sampled
  // as an exponential moving average over the drag.
  let velocity = 0;
  let rawLastY = 0;
  let lastMoveAt = 0;
  let momentumFrame = 0;

  const cancelMomentum = (): void => {
    if (momentumFrame !== 0) {
      cancelAnimationFrame(momentumFrame);
      momentumFrame = 0;
    }
  };

  // Keep gliding after a flick, decaying exponentially like native apps.
  const startMomentum = (clientX: number, clientY: number): void => {
    let v = velocity;
    let acc = 0;
    let lastFrameAt = performance.now();
    const step = (now: number): void => {
      const dt = now - lastFrameAt;
      lastFrameAt = now;
      v *= Math.exp(-0.002 * dt);
      acc += v * dt;
      const cellHeight = screen.clientHeight / term.rows;
      const lines = Math.trunc(acc / cellHeight);
      if (lines !== 0) {
        acc -= lines * cellHeight;
        scrollTermLines(term, screen, lines, clientX, clientY);
      }
      momentumFrame = Math.abs(v) > 0.05 ? requestAnimationFrame(step) : 0;
    };
    momentumFrame = requestAnimationFrame(step);
  };

  screen.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      cancelMomentum();
      cancelLongPress();
      cancelTwoFinger();
      selecting = false;
      if (term.hasSelection()) term.clearSelection();
      if (e.touches.length !== 1) {
        touchId = undefined;
        if (e.touches.length === 2) {
          beginTwoFinger(e.touches[0], e.touches[1]);
        }
        return;
      }
      const touch = e.touches[0];
      touchId = touch.identifier;
      startY = touch.clientY;
      lastY = touch.clientY;
      rawLastY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      startTime = Date.now();
      lastMoveAt = performance.now();
      velocity = 0;
      scrolling = false;
      longPressTimer = window.setTimeout(() => {
        longPressTimer = 0;
        if (touchId !== undefined && !scrolling) beginSelection();
      }, 500);
    },
    { passive: true },
  );

  screen.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (twoFingerTimer !== 0 && twoFingerMid && e.touches.length === 2) {
        // Holding still keeps the pending right-click; drifting fingers
        // mean a pinch or two-finger scroll, so call it off.
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (Math.hypot(midX - twoFingerMid.x, midY - twoFingerMid.y) > 15) {
          cancelTwoFinger();
        }
        return;
      }
      const touch = Array.from(e.touches).find((t) => t.identifier === touchId);
      if (touch === undefined) return;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      if (selecting) {
        // Dragging while in selection mode extends the selection instead
        // of scrolling.
        e.preventDefault();
        extendSelection(cellFromPoint(touch.clientX, touch.clientY));
        return;
      }
      const cellHeight = screen.clientHeight / term.rows;
      if (!scrolling && Math.abs(touch.clientY - startY) > cellHeight) {
        scrolling = true;
        cancelLongPress();
      }
      if (!scrolling) return;
      // Keep the browser from panning/refreshing the page while we scroll
      // the terminal (requires the listener to be non-passive).
      e.preventDefault();
      const now = performance.now();
      const dt = now - lastMoveAt;
      if (dt > 0) {
        velocity = 0.8 * ((rawLastY - touch.clientY) / dt) + 0.2 * velocity;
        lastMoveAt = now;
      }
      rawLastY = touch.clientY;
      const lines = Math.trunc((lastY - touch.clientY) / cellHeight);
      if (lines === 0) return;
      lastY -= lines * cellHeight;
      scrollTermLines(term, screen, lines, touch.clientX, touch.clientY);
    },
    { passive: false },
  );

  screen.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      // Any finger lifting below two ends a pending two-finger right-click.
      if (e.touches.length < 2) cancelTwoFinger();
      if (touchId === undefined || e.touches.length > 0) return;
      const touch = Array.from(e.changedTouches).find(
        (t) => t.identifier === touchId,
      );
      touchId = undefined;
      cancelLongPress();
      cancelTwoFinger();
      if (selecting) {
        // Release ends selection mode: the selected text goes straight to
        // the clipboard (we are inside a user gesture here, so the
        // execCommand fallback works even over plain HTTP).
        selecting = false;
        e.preventDefault();
        const text = term.getSelection();
        if (text !== '') {
          copySelected(text);
          showCopyToast();
        }
        return;
      }
      if (scrolling || touch === undefined || Date.now() - startTime >= 500) {
        let reason = 'long';
        if (scrolling) reason = 'scroll';
        else if (touch === undefined) reason = 'id';
        debug(`tap-reject ${reason}`);
        // A flick released with speed keeps gliding.
        if (scrolling && touch !== undefined && Math.abs(velocity) > 0.25) {
          startMomentum(touch.clientX, touch.clientY);
        }
        return;
      }
      debug(
        `tap mode=${term.modes.mouseTrackingMode}` +
          ` cancelable=${String(e.cancelable)}` +
          ` focused=${String(document.activeElement === term.textarea)}` +
          ` wanted=${String(term.textarea?.dataset.kbWanted === '1')}`,
      );
      // Single taps never summon the soft keyboard — only a double tap or
      // the on-screen keyboard button does, in every context. Suppress the
      // browser's synthesized click (it would focus the terminal).
      e.preventDefault();
      debug(`prevented=${String(e.defaultPrevented)}`);
      const now = Date.now();
      if (now - lastTapAt < 350) {
        lastTapAt = 0;
        debug('double-tap: summon keyboard');
        summonKeyboard(term);
        return;
      }
      lastTapAt = now;
      if (term.modes.mouseTrackingMode !== 'none') {
        // Mouse-aware apps (tmux, herdr…) get the tap as a plain click:
        // hand xterm the mouse events so it emits the click report.
        for (const type of ['mousedown', 'mouseup']) {
          screen.dispatchEvent(
            new MouseEvent(type, {
              button: 0,
              buttons: type === 'mousedown' ? 1 : 0,
              clientX: touch.clientX,
              clientY: touch.clientY,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      }
    },
    { passive: false },
  );
}
