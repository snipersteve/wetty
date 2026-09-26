/**
 Persistent on-screen key bar, in the spirit of Termux's extra-keys row.
 Phones always show it; desktop browsers get only a floating upload
 button in the bottom-right corner. Two rows: terminal essentials (Esc, Tab, Ctrl+Enter, arrows,
 keyboard toggle) and multiplexer shortcuts (herdr's prefix chords, ^C,
 Enter, voice input, paste, upload). Sticky-Ctrl state lives in ctrl.ts.

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
  action?: 'ctrl' | 'keyboard' | 'paste' | 'upload' | 'voice';
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
    // Ctrl+Enter as a Kitty keyboard report: herdr's client parses it and
    // re-encodes for the pane (Claude Code enables the protocol, so it gets
    // the same report and reads it as "send now"; legacy apps get a plain
    // Enter). Sticky Ctrl (ctrl.ts) stays for the desktop grid and hardware
    // keyboards; it just has no button any more.
    { label: 'Ctrl⏎', seq: '\x1b[13;5u', title: 'Ctrl+Enter' },
    { label: '◀', seq: cursor('\x1b[D', '\x1bOD'), repeat: true },
    { label: '▲', seq: cursor('\x1b[A', '\x1bOA'), repeat: true },
    { label: '▼', seq: cursor('\x1b[B', '\x1bOB'), repeat: true },
    { label: '▶', seq: cursor('\x1b[C', '\x1bOC'), repeat: true },
    { label: '⌨', action: 'keyboard', title: '软键盘' },
  ],
  [
    { label: 'CtrlC', seq: '\x03', title: 'Ctrl+C' },
    { label: '粘贴', action: 'paste', title: '粘贴剪贴板' },
    { label: '上传', action: 'upload', title: '上传文件并粘贴路径' },
    { label: '◀Tab', seq: `${PREFIX}p`, title: 'herdr: previous tab' },
    { label: 'Tab▶', seq: `${PREFIX}n`, title: 'herdr: next tab' },
    { label: '+Tab', seq: `${PREFIX}c`, title: 'herdr: new tab' },
    {
      label: '语音',
      action: 'voice',
      title: '语音输入：点一下开始，再点一下结束',
    },
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
    HerdrShell?: {
      readClipboard?: () => string;
      /** Start or stop recording; returns the new state. */
      voiceToggle?: () => 'recording' | 'stopped' | 'denied' | 'busy';
    };
    /** Called by the Android shell with recording / recognition progress. */
    wettyVoice?: (state: string, payload?: string) => void;
  }
}

// ─── voice input ─────────────────────────────────────────────────────────────

let voiceButton: HTMLButtonElement | null = null;
let voiceTerm: Term | null = null;

/**
 Entry point for the Android shell. States: recording, uploading,
 result (payload = JSON {text, raw, polished}), error (payload = message),
 idle.
 @param state - progress state
 @param payload - text or JSON depending on state
 */
function onVoice(state: string, payload?: string): void {
  voiceButton?.classList.toggle('rec', state === 'recording');
  voiceButton?.classList.toggle('busy', state === 'uploading');
  if (state === 'recording') {
    showToast('录音中…再点一下结束');
  } else if (state === 'uploading') {
    showToast('识别中…');
  } else if (state === 'error') {
    showToast(payload ?? '语音识别失败');
  } else if (state === 'result' && voiceTerm !== null) {
    let text = '';
    try {
      text = (JSON.parse(payload ?? '{}') as { text?: string }).text ?? '';
    } catch {
      text = payload ?? '';
    }
    if (text === '') {
      showToast('没有识别到内容');
      return;
    }
    setCtrl(false);
    // Pasted, not sent: read it over, then hit ⏎ yourself.
    voiceTerm.paste(text);
  }
}
window.wettyVoice = onVoice;

function toggleVoice(term: Term): void {
  voiceTerm = term;
  const bridge = window.HerdrShell;
  if (bridge?.voiceToggle === undefined) {
    showToast('语音输入需要安卓壳 1.11 以上');
    return;
  }
  const state = bridge.voiceToggle();
  if (state === 'denied') showToast('请允许麦克风权限后重试');
  else if (state === 'busy') showToast('上一段还在识别中');
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
    // Desktop on plain HTTP: no clipboard API outside a secure context, but
    // the physical keyboard's paste goes through xterm untouched.
    showToast(
      coarsePointer || window.isSecureContext
        ? '剪贴板为空或不可读'
        : '请用 ⌘V / Ctrl+Shift+V 粘贴',
    );
    return;
  }
  setCtrl(false);
  term.paste(text);
}

let picker: HTMLInputElement | null = null;

/**
 Pick files from the phone, POST each to the proxy's /upload (same origin,
 cookie auth), then paste the saved Mac paths into the terminal so a CLI
 agent can read them. The proxy keeps original names but maps whitespace
 to _, so the space-joined paste stays unambiguous.
 @param term - the wetty terminal
 */
function uploadFiles(term: Term): void {
  if (picker === null) {
    picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.style.display = 'none';
    document.body.appendChild(picker);
  }
  const input = picker;
  input.value = '';
  input.onchange = async (): Promise<void> => {
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    const total = String(files.length);
    showToast(`上传中… 0/${total}`);
    const paths: string[] = [];
    for (const file of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch('/upload', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name),
          },
          body: file,
        });
        // eslint-disable-next-line no-await-in-loop
        const data = (await res.json()) as { path?: string };
        if (res.ok && data.path !== undefined) paths.push(data.path);
      } catch {
        /* counted as failed below */
      }
      showToast(`上传中… ${String(paths.length)}/${total}`);
    }
    if (paths.length === 0) {
      showToast('上传失败');
      return;
    }
    showToast(
      paths.length === files.length
        ? `已上传 ${total} 个`
        : `上传 ${String(paths.length)}/${total}，部分失败`,
    );
    setCtrl(false);
    term.paste(`${paths.join(' ')} `);
  };
  input.click();
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
    if (def.action === 'upload') {
      uploadFiles(term);
      return;
    }
    if (def.action === 'voice') {
      toggleVoice(term);
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

  if (def.action === 'voice') voiceButton = btn;
  if (def.action === 'ctrl') {
    onCtrlChange((armed) => {
      btn.classList.toggle('active', armed);
    });
  }
  return btn;
}

/**
 Build the key bar. Phones get the full two rows; desktop only a floating
 upload button (a physical keyboard has every other key).
 @param term - the wetty terminal the keys type into
 */
export function setupKeybar(term: Term): void {
  bar ??= document.getElementById('keybar');
  if (bar === null) return;
  bar.innerHTML = '';
  // Desktop: the physical keyboard covers every key, so only upload is
  // left, as a floating button in the bottom-right corner.
  const rows = coarsePointer
    ? ROWS
    : [ROWS.flat().filter((def) => def.action === 'upload')];
  bar.classList.toggle('floating', !coarsePointer);
  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'row';
    row.forEach((def) => rowEl.appendChild(makeButton(term, def)));
    bar.appendChild(rowEl);
  }
  // Always on: the header icons are hidden everywhere, so a persisted
  // hidden state would have no way back.
  applyVisibility(true);
}
