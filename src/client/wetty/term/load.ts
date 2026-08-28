import type { Options } from './options';

/** Bundled webfont first (see assets/scss/fonts.scss), then system monospace. */
export const defaultFontFamily =
  "'JetBrains Mono', Menlo, 'SF Mono', 'Roboto Mono', 'Droid Sans Mono', monospace";

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
