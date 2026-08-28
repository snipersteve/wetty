import type { Options } from './options';

/**
 Bundled webfont first, then the bundled symbol fallbacks, then system
 monospace (see assets/scss/fonts.scss).
 */
export const defaultFontFamily =
  "'JetBrains Mono', 'Noto Sans Symbols 2', 'Noto Sans Symbols', 'Noto Sans Math', Menlo, 'SF Mono', 'Roboto Mono', 'Droid Sans Mono', monospace";

/** Faces the client waits for before opening xterm (WebGL caches glyphs). */
export const bundledFonts: [family: string, sample: string][] = [
  ['JetBrains Mono', 'M'],
  ['Noto Sans Symbols 2', '\u23F5'],
  ['Noto Sans Symbols', '\u23BF'],
  ['Noto Sans Math', '\u21BB'],
];

/**
 Earlier defaults, so a saved options blob that merely echoes an old
 default is upgraded instead of pinning the user to it forever.
 */
export const legacyFontFamilies = [
  "'JetBrains Mono', Menlo, 'SF Mono', 'Roboto Mono', 'Droid Sans Mono', monospace",
];

export const defaultOptions: Options = {
  // macOptionClickForcesSelection: on macOS, ⌥-drag is the only way to make
  // a local selection (and copy) while an app owns the mouse (tmux, herdr…).
  xterm: {
    fontSize: 14,
    fontFamily: defaultFontFamily,
    macOptionClickForcesSelection: true,
  },
  wettyVoid: 0,
  wettyFitTerminal: true,
};

export function loadOptions(): Options {
  try {
    const raw = localStorage.options as string | undefined;
    let options: Options =
      raw === undefined ? defaultOptions : (JSON.parse(raw) as Options);
    if (!('xterm' in options)) {
      const { xterm } = options;
      options = defaultOptions;
      options.xterm = xterm;
    }
    return options;
  } catch {
    return defaultOptions;
  }
}
