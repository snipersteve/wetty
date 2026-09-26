import type { Term } from '../../term';

// ASCII punctuation (and anything non-alphanumeric an IME might hand back as
// a single key). Letters, digits and space keep xterm's normal path.
const PUNCT = /^[^\p{L}\p{N}\s]$/u;

let pending = false;

/**
 Let physical-keyboard punctuation reach the IME. xterm handles a plain
 "," on keydown and cancels it, so a Chinese IME never gets to turn it into
 "，" — everything typed on desktop came out half-width. For punctuation
 keys we instead let the browser's default action run (xterm neither sends
 nor cancels), and forward whatever the IME inserts from the `input` event.
 Without an IME the browser inserts the plain character, so nothing changes.
 Soft keyboards (keyCode 229) and IME composition keep their own paths.
 @param e - keydown / keypress / keyup seen by xterm's custom key handler
 @returns false to keep xterm's hands off the event
 */
export function imePunctuationKeyHandler(e: KeyboardEvent): boolean {
  if (e.type === 'keyup') return true;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- 229 = IME/soft keyboard
  if (e.isComposing || e.keyCode === 229) return true;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (e.key.length !== 1 || !PUNCT.test(e.key)) return true;
  if (e.type === 'keydown') pending = true;
  return false;
}

/**
 Forward the character the browser/IME inserted for a punctuation key that
 imePunctuationKeyHandler let through.
 @param term - the wetty terminal
 */
export function setupImePunctuation(term: Term): void {
  const { textarea } = term;
  if (!textarea || textarea.dataset.imePunct === '1') return;
  textarea.dataset.imePunct = '1';
  textarea.addEventListener('input', (e: Event) => {
    const ev = e as InputEvent;
    if (!pending || ev.isComposing) return;
    pending = false;
    if (ev.inputType !== 'insertText' || ev.data === null) return;
    window.wetty_term?.input(ev.data, true);
    textarea.value = '';
  });
}
