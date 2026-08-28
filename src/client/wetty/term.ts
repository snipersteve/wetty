import { ClipboardAddon } from '@xterm/addon-clipboard';
import { FitAddon } from '@xterm/addon-fit';
import { ImageAddon } from '@xterm/addon-image';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';

import { onCtrlChange, setCtrl, toggleCtrl } from './ctrl';
import { terminal as termElement } from './disconnect/elements';
import { toggleKeybar } from './keybar';
import { configureTerm } from './term/configuration';
import {
  copySelected,
  deferCopy,
  hasClipboardApi,
} from './term/configuration/clipboard';
import { debugLog } from './term/configuration/debug';
import { summonKeyboard } from './term/configuration/touch';
import { loadOptions } from './term/load';
import type { Options } from './term/options';
import type { Socket } from 'socket.io-client';

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
const isMobile =
  /iPhone|iPad|iPod|Android|webOS|BlackBerry|Opera Mini|IEMobile/i.test(
    navigator.userAgent,
  );

// FitAddon reads the same private field; no public API exposes cell size.
interface XtermCoreAccess {
  _core: {
    _renderService: {
      dimensions: { css: { cell: { width: number; height: number } } };
    };
  };
}

export class Term extends Terminal {
  socket: Socket;
  fitAddon: FitAddon;
  loadOptions: () => Options;

  constructor(socket: Socket) {
    super({ allowProposedApi: true });
    this.socket = socket;
    this.fitAddon = new FitAddon();
    this.loadAddon(this.fitAddon);
    this.loadAddon(new WebLinksAddon());
    this.loadAddon(new ImageAddon());
    this.loadAddon(
      new ClipboardAddon(undefined, {
        // OSC 52 writes (how tmux/herdr copy their internal selections)
        // land in the system clipboard via the same insecure-context-safe
        // path as select-to-copy. Reads are refused so terminal programs
        // cannot snoop the clipboard.
        readText: () => '',
        writeText: (_selection, text) => {
          debugLog(`osc52 len=${String(text.length)}`);
          // An empty payload means the addon rejected the base64 — don't
          // clobber the clipboard with nothing.
          if (text === '') return;
          copySelected(text);
          // This write runs outside any user gesture; macOS Chrome claims
          // success but silently drops it on insecure origins. Park the
          // text so the next click/keystroke rewrites it inside a gesture.
          if (!hasClipboardApi()) deferCopy(text);
        },
      }),
    );
    this.loadOptions = loadOptions;
    if (!isMobile) {
      try {
        this.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available — DOM renderer will be used
      }
    }
  }

  resizeTerm(): void {
    this.refresh(0, this.rows - 1);
    if (this.shouldFitTerm) this.fit();
    this.socket.emit('resize', { cols: this.cols, rows: this.rows });
  }

  /**
   * Fit the grid to the container. FitAddon reserves 14px on the right for
   * a scrollbar (xterm's DEFAULT_SCROLL_BAR_WIDTH); on xterm 6 that bar is
   * an overlay shown only while scrolling, so on phones the reserve is just
   * a permanent empty strip. Compute cols/rows from the full container
   * there; desktop keeps FitAddon's behavior.
   */
  private fit(): void {
    const parent = this.element?.parentElement;
    // eslint-disable-next-line no-underscore-dangle -- same private field FitAddon reads
    const { cell } = (this as unknown as XtermCoreAccess)._core._renderService
      .dimensions.css;
    if (!coarsePointer || !parent || cell.width === 0 || cell.height === 0) {
      this.fitAddon.fit();
      return;
    }
    const cols = Math.max(2, Math.floor(parent.clientWidth / cell.width));
    const rows = Math.max(1, Math.floor(parent.clientHeight / cell.height));
    if (cols !== this.cols || rows !== this.rows) this.resize(cols, rows);
  }

  get shouldFitTerm(): boolean {
    return this.loadOptions().wettyFitTerminal;
  }
}

const ctrlButton = document.getElementById('onscreen-ctrl');
onCtrlChange((armed) => {
  ctrlButton?.classList.toggle('active', armed);
});

/**
 * Arm/disarm sticky Ctrl (state lives in ctrl.ts and is shared with the
 * phone key bar). The next character — from a physical keyboard or a soft
 * keyboard — is sent as its control code.
 */
const toggleCTRL = (): void => {
  toggleCtrl();
  window.wetty_term?.focus();
};

/**
 * Build a handler that types a fixed sequence into the terminal, cancelling
 * a pending sticky Ctrl. Cursor keys honour application cursor mode.
 * @param seq - the bytes to send, or a resolver taking the live terminal
 */
const press = (seq: string | ((term: Term) => string)) => (): void => {
  setCtrl(false);
  const term = window.wetty_term;
  if (!term) return;
  term.input(typeof seq === 'function' ? seq(term) : seq, true);
  term.focus();
};
const cursorKey =
  (plain: string, app: string) =>
  (term: Term): string =>
    term.modes.applicationCursorKeysMode ? app : plain;

const pressESC = press('\x1B');
const pressTAB = press('\x09');
const pressUP = press(cursorKey('\x1B[A', '\x1BOA'));
const pressDOWN = press(cursorKey('\x1B[B', '\x1BOB'));
const pressLEFT = press(cursorKey('\x1B[D', '\x1BOD'));
const pressRIGHT = press(cursorKey('\x1B[C', '\x1BOC'));

/**
 * Toggles the visibility of the onscreen buttons by adding or removing
 * the 'active' class to the element with the ID 'onscreen-buttons'.
 */
const toggleFunctions = (): void => {
  if (coarsePointer) {
    // Phones have the persistent key bar instead of the pop-up grid; the
    // header icon shows/hides it (the bar's own ⌨ key summons the IME).
    toggleKeybar();
    return;
  }
  const element = document.querySelector(
    'div#functions > div.onscreen-buttons',
  );
  if (element?.classList.contains('active')) {
    element.classList.remove('active');
  } else {
    element?.classList.add('active');
    document.getElementById('options')?.classList.remove('opened');
    // On phones this button is a way to summon the soft keyboard (taps
    // never do — the textarea sits at inputmode="none" until summoned).
    if (window.wetty_term) summonKeyboard(window.wetty_term);
  }
};

declare global {
  interface Window {
    wetty_term?: Term;
    clipboardData: DataTransfer;
    toggleFunctions?: () => void;
    toggleCTRL?: () => void;
    pressESC?: () => void;
    pressUP?: () => void;
    pressDOWN?: () => void;
    pressTAB?: () => void;
    pressLEFT?: () => void;
    pressRIGHT?: () => void;
  }
}

export function terminal(socket: Socket): Term | undefined {
  const term = new Term(socket);
  if (termElement === null) return undefined;
  termElement.innerHTML = '';
  term.open(termElement);
  configureTerm(term);
  window.onresize = function onResize() {
    term.resizeTerm();
  };
  window.wetty_term = term;
  window.toggleFunctions = toggleFunctions;
  window.toggleCTRL = toggleCTRL;
  window.pressESC = pressESC;
  window.pressUP = pressUP;
  window.pressDOWN = pressDOWN;
  window.pressTAB = pressTAB;
  window.pressLEFT = pressLEFT;
  window.pressRIGHT = pressRIGHT;
  return term;
}
