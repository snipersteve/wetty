import { ctrlKeyHandler } from '../ctrl';
import { editor } from '../disconnect/elements';
import { setupKeybar } from '../keybar';
import { setupBackdrop } from './configuration/backdrop';
import { copySelected, copyShortcut } from './configuration/clipboard';
import { onInput } from './configuration/editor';
import {
  imePunctuationKeyHandler,
  setupImePunctuation,
} from './configuration/ime';
import { setupTouch } from './configuration/touch';
import { setupMobileViewport } from './configuration/viewport';
import { defaultFontFamily, legacyFontFamilies, loadOptions } from './load';
import type { Options } from './options';
import type { Term } from '../term';

let uiWired = false;

export function configureTerm(term: Term): void {
  const options = loadOptions();
  try {
    term.options = options.xterm;
  } catch {
    /* Do nothing */
  }
  const { fontFamily } = options.xterm;
  if (
    typeof fontFamily !== 'string' ||
    fontFamily === '' ||
    legacyFontFamilies.includes(fontFamily)
  ) {
    // Saved options from before the bundled fonts (or the symbol
    // fallbacks) existed.
    term.options.fontFamily = defaultFontFamily;
  }
  if (options.xterm.macOptionClickForcesSelection === undefined) {
    // Saved options from before this default existed miss the flag; without
    // it, macOS users cannot select (and thus copy) inside mouse-aware apps.
    term.options.macOptionClickForcesSelection = true;
  }

  const toggle = document.querySelector('#options .toggler');
  const optionsElem = document.getElementById('options');
  if (editor == null || toggle == null || optionsElem == null) {
    throw new Error("Couldn't initialize configuration menu");
  }

  const editorElem = editor;

  function sendOptionsToEditor() {
    editorElem.contentWindow?.postMessage(
      { type: 'wetty:load', config: loadOptions() },
      '*',
    );
  }

  function editorOnLoad() {
    sendOptionsToEditor();
  }
  if (
    (
      editorElem.contentDocument ??
      editorElem.contentWindow?.document ?? {
        readyState: '',
      }
    ).readyState === 'complete'
  ) {
    editorOnLoad();
  }
  editorElem.addEventListener('load', editorOnLoad);

  interface WettyMessage {
    type: string;
    config?: Options;
  }

  // DOM-level wiring must happen once: configureTerm runs again on every
  // socket reconnect, and duplicated click handlers would toggle the
  // options panel twice (i.e. not at all). Handlers resolve the live
  // terminal through window.wetty_term.
  if (!uiWired) {
    uiWired = true;
    window.addEventListener('message', (e: MessageEvent<unknown>) => {
      const data = e.data as WettyMessage | null;
      const live = window.wetty_term;
      if (data?.type === 'wetty:save' && data.config !== undefined) {
        if (live) onInput(live, data.config);
      } else if (data?.type === 'wetty:close') {
        optionsElem.classList.toggle('opened');
      }
    });

    toggle.addEventListener('click', (e) => {
      sendOptionsToEditor();
      optionsElem.classList.toggle('opened');
      if (optionsElem.classList.contains('opened')) {
        document
          .querySelector('div#functions > div.onscreen-buttons')
          ?.classList.remove('active');
      }
      e.preventDefault();
    });

    document.addEventListener(
      'mouseup',
      () => {
        const live = window.wetty_term;
        if (live?.hasSelection()) copySelected(live.getSelection());
      },
      false,
    );
  }

  term.attachCustomKeyEventHandler(
    (e) =>
      ctrlKeyHandler(term, e) &&
      copyShortcut(term, e) &&
      imePunctuationKeyHandler(e),
  );
  setupImePunctuation(term);
  setupTouch(term);
  setupMobileViewport(term);
  setupKeybar(term);
  if (term.element?.parentElement) {
    setupBackdrop(term, term.element.parentElement);
  }
}
