/**
 Sticky-Ctrl state shared by the on-screen key bar, the desktop pop-up
 grid, the soft-keyboard input path (touch.ts) and physical keyboards.
 Arm it once; the next printable character is sent as a control code.
 */
import type { Term } from './term';

export const CTRL_ENTER = '\x1b[13;5u';

let ctrlArmed = false;
const listeners = new Set<(armed: boolean) => void>();

export function isCtrlArmed(): boolean {
  return ctrlArmed;
}

export function setCtrl(armed: boolean): void {
  if (ctrlArmed === armed) return;
  ctrlArmed = armed;
  listeners.forEach((l) => {
    l(armed);
  });
}

export function toggleCtrl(): void {
  setCtrl(!ctrlArmed);
}

export function onCtrlChange(listener: (armed: boolean) => void): void {
  listeners.add(listener);
}

/**
 Translate a printable character into its control code when Ctrl is armed,
 disarming it in the process. Returns undefined when Ctrl is not armed or
 the character has no control code (the caller should send it as-is).
 @param ch - a single character
 */
export function applyCtrl(ch: string): string | undefined {
  if (!ctrlArmed || ch.length !== 1) return undefined;
  setCtrl(false);
  if (ch === ' ' || ch === '@') return '\x00';
  const code = ch.toUpperCase().charCodeAt(0);
  // A–Z [ \ ] ^ _ map onto 0x01–0x1F.
  if (code >= 0x41 && code <= 0x5f) return String.fromCharCode(code - 0x40);
  if (ch === '?') return '\x7f';
  return undefined;
}

/**
 Custom key handler for physical keyboards: preserve Ctrl+Enter as CSI-u
 (xterm's legacy path collapses it to CR). While Ctrl is armed, the next
 plain character is sent as its control code instead of reaching xterm.
 Soft keyboards (keyCode 229) never get here; the touch module handles
 them on the `input` event with applyCtrl().
 @param term - the wetty terminal
 @param e - the keyboard event xterm is about to process
 @returns false to swallow the event, true to let xterm handle it
 */
export function ctrlKeyHandler(
  term: Pick<Term, 'input'>,
  e: KeyboardEvent,
): boolean {
  if (e.type !== 'keydown' || e.isComposing) return true;
  if (
    e.key === 'Enter' &&
    (e.ctrlKey || ctrlArmed) &&
    !e.altKey &&
    !e.metaKey &&
    !e.shiftKey
  ) {
    e.preventDefault();
    setCtrl(false);
    term.input(CTRL_ENTER, true);
    return false;
  }
  if (!ctrlArmed) return true;
  if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return true;
  const seq = applyCtrl(e.key);
  if (seq === undefined) return true;
  e.preventDefault();
  term.input(seq, true);
  return false;
}
