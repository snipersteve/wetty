/**
 Persistent on-screen key bar for phones, in the spirit of Termux's
 extra-keys row. Two rows: terminal essentials (Esc, Tab, Ctrl, arrows,
 keyboard toggle) and multiplexer shortcuts (herdr's prefix chords, ^C,
 Enter, Shift+Tab). Sticky-Ctrl state lives in ctrl.ts.

 Buttons never take focus (pointerdown is prevented), so tapping them does
 not dismiss the soft keyboard; arrows repeat on long press.
 */
import { onCtrlChange, setCtrl, toggleCtrl } from './ctrl';
import { showToast, summonKeyboard } from './term/configuration/touch';
import type { Term } from './term';

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const STORAGE_KEY = 'wettyKeybar';

// ─── key definitions ─────────────────────────────────────────────────────────

/** herdr / tmux prefix: Ctrl+B */
const PREFIX = '\x02';

type Seq = string | ((term: Term) => string);

interface KeyDef {
  label: string;
  seq?: Seq;
  action?: 'ctrl' | 'keyboard' | 'paste';
  repeat?: boolean;
  title?: string;
}

const cursor =
  (plain: string, app: string): Seq =>
  (term) =>
    term.modes.applicationCursorKeysMode ? app : plain;

const ROWS: KeyDef[][] = [
  [
    { label: 'Esc', seq: '\x1b' },
    { label: 'Tab', seq: '\t' },
    { label: 'Ctrl', action: 'ctrl' },
    { label: '◀', seq: cursor('\x1b[D', '\x1bOD'), repeat: true },
    { label: '▲', seq: cursor('\x1b[A', '\x1bOA'), repeat: true },
    { label: '▼', seq: cursor('\x1b[B', '\x1bOB'), repeat: true },
    { label: '▶', seq: cursor('\x1b[C', '\x1bOC'), repeat: true },
    { label: '⌨', action: 'keyboard', title: '软键盘' },
  ],
  [
    { label: '^C', seq: '\x03' },
    { label: '⇧Tab', seq: '\x1b[Z' },
    { label: '粘贴', action: 'paste', title: '粘贴剪贴板' },
    // herdr's mobile single-column layout has no sidebar; the goto picker
    // (prefix+g) is the way to jump between workspaces/tabs/agents.
    { label: 'Goto', seq: `${PREFIX}g`, title: 'herdr: goto picker' },
    { label: '◀Tab', seq: `${PREFIX}p`, title: 'herdr: previous tab' },
    { label: 'Tab▶', seq: `${PREFIX}n`, title: 'herdr: next tab' },
    { label: '+Tab', seq: `${PREFIX}c`, title: 'herdr: new tab' },
    // Enter last, bottom-right: the thumb's home position.
    { label: '⏎', seq: '\r' },
  ],
];

// ─── DOM ─────────────────────────────────────────────────────────────────────

let bar: HTMLElement | null = null;

function haptic(): void {
  try {
    if ('vibrate' in navigator) navigator.vibrate(8);
  } catch {
    /* unsupported */
  }
}

function applyVisibility(visible: boolean): void {
  const root = document.documentElement;
  if (visible) {
    root.dataset.wettyKeybar = '1';
  } else {
    delete root.dataset.wettyKeybar;
  }
  try {
    localStorage.setItem(STORAGE_KEY, visible ? '1' : '0');
  } catch {
    /* private mode */
  }
  // Layout changed under the terminal: refit on the next frame.
  requestAnimationFrame(() => {
    window.wetty_term?.resizeTerm();
  });
}

export function isKeybarVisible(): boolean {
  return document.documentElement.dataset.wettyKeybar === '1';
}

export function toggleKeybar(): void {
  applyVisibility(!isKeybarVisible());
}

function toggleSoftKeyboard(term: Term): void {
  const { textarea } = term;
  if (textarea && document.activeElement === textarea) {
    // blur re-arms the dormant state (see touch.ts) and closes the IME.
    textarea.blur();
  } else {
    summonKeyboard(term);
  }
}

declare global {
  interface Window {
    /** Injected by the Android shell (addJavascriptInterface). */
    HerdrShell?: { readClipboard?: () => string };
  }
}

/**
 Paste the system clipboard into the terminal. Plain-HTTP pages cannot read
 the clipboard through the Web API (secure context only), so the Android
 shell exposes a native bridge; browsers on HTTPS fall back to the async
 clipboard API. xterm's paste() handles bracketed-paste mode and CRLF.
 @param term - the wetty terminal
 */
async function pasteFromClipboard(term: Term): Promise<void> {
  let text = '';
  try {
    const bridge = window.HerdrShell;
    if (bridge?.readClipboard) {
      text = bridge.readClipboard();
    } else if ('clipboard' in navigator) {
      text = await navigator.clipboard.readText();
    }
  } catch {
    text = '';
  }
  if (text === '') {
    showToast('剪贴板为空或不可读');
    return;
  }
  setCtrl(false);
  term.paste(text);
}

function makeButton(term: Term, def: KeyDef): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.tabIndex = -1;
  btn.textContent = def.label;
  if (def.title !== undefined) btn.title = def.title;

  const fire = (): void => {
    if (def.action === 'ctrl') {
      toggleCtrl();
      return;
    }
    if (def.action === 'keyboard') {
      toggleSoftKeyboard(term);
      return;
    }
    if (def.action === 'paste') {
      void pasteFromClipboard(term);
      return;
    }
    if (def.seq === undefined) return;
    const seq = typeof def.seq === 'function' ? def.seq(term) : def.seq;
    setCtrl(false);
    term.input(seq, true);
  };

  let repeatTimer = 0;
  let repeated = false;
  const stopRepeat = (): void => {
    if (repeatTimer !== 0) {
      clearTimeout(repeatTimer);
      repeatTimer = 0;
    }
  };

  btn.addEventListener('pointerdown', (e) => {
    // Keep focus where it is (the terminal textarea) so the soft keyboard
    // stays up, and suppress compatibility mouse events.
    e.preventDefault();
    haptic();
    repeated = false;
    if (def.repeat !== true) return;
    stopRepeat();
    const tick = (): void => {
      repeated = true;
      fire();
      repeatTimer = window.setTimeout(tick, 70);
    };
    repeatTimer = window.setTimeout(tick, 380);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    btn.addEventListener(ev, stopRepeat);
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (repeated) {
      repeated = false;
      return;
    }
    fire();
  });

  if (def.action === 'ctrl') {
    onCtrlChange((armed) => {
      btn.classList.toggle('active', armed);
    });
  }
  return btn;
}

/**
 Build the key bar on finger-first devices. Desktop keeps the classic
 pop-up grid (see term.ts).
 @param term - the wetty terminal the keys type into
 */
export function setupKeybar(term: Term): void {
  if (!coarsePointer) return;
  bar ??= document.getElementById('keybar');
  if (bar === null) return;
  bar.innerHTML = '';
  for (const row of ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    for (const def of row) rowEl.appendChild(makeButton(term, def));
    bar.appendChild(rowEl);
  }
  // Always on: the header toggle is hidden on phones, so a persisted
  // hidden state would have no way back.
  applyVisibility(true);
}
