import { isDev } from '../../shared/env.js';
import type { Request, Response, RequestHandler } from 'express';

const jsFiles = isDev ? ['dev.js', 'wetty.js'] : ['wetty.js'];

const render = (title: string, base: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content">
    <meta name="theme-color" content="#1e1e1e">
    <link rel="icon" type="image/x-icon" href="${base}/client/favicon.ico">
    <link rel="manifest" href="${base}/client/manifest.json">
    <title>${title}</title>
    <link rel="stylesheet" href="${base}/client/wetty.css" />
  </head>
  <body>
    <div id="overlay">
      <!-- Herdr's ram (herdr.dev/assets/logo.svg): the whole overlay is one
           button. Breathing = auto-reconnect in progress; still with a ↻
           badge = session ended, tap to reconnect. -->
      <button type="button" class="ram" title="重新连接 · reconnect" aria-label="重新连接 · reconnect"
              onclick="window.wettyReconnect ? window.wettyReconnect() : location.reload();">
        <svg viewBox="100 135 412 377" aria-hidden="true">
          <g fill="currentColor" transform="translate(0 512) scale(.1 -.1)">
            <path d="M2794 3710 c-129 -33 -299 -135 -359 -214 -21 -28 -26 -42 -21 -63 9 -38 154 -178 199 -192 32 -11 41 -9 104 23 171 86 354 70 475 -43 150 -138 150 -379 0 -511 -107 -95 -278 -94 -386 2 l-46 40 -11 -29 c-16 -40 -14 -122 4 -164 60 -144 264 -222 452 -174 360 92 559 494 430 868 -36 103 -81 173 -175 267 -71 72 -100 93 -180 132 -52 26 -127 54 -167 62 -96 21 -230 20 -319 -4z M2183 3695 c-116 -32 -221 -108 -273 -199 -17 -28 -30 -54 -30 -58 0 -4 20 1 45 12 66 28 220 68 294 76 64 7 65 7 137 83 40 41 71 77 69 79 -2 2 -21 8 -42 13 -55 12 -140 10 -200 -6z M2212 3388 c-159 -22 -390 -122 -559 -241 -299 -210 -585 -600 -609 -828 -12 -118 40 -251 125 -318 96 -76 178 -98 426 -116 110 -8 224 -21 254 -29 125 -34 230 -115 272 -211 11 -24 24 -81 30 -127 20 -170 65 -271 166 -374 34 -35 63 -65 63 -67 0 -1 -10 -27 -22 -57 -29 -76 -37 -259 -14 -350 42 -170 158 -318 311 -397 44 -23 98 -46 120 -52 22 -6 45 -14 51 -18 5 -5 15 -48 22 -96 6 -48 14 -92 17 -97 4 -6 415 -10 1131 -10 l1124 0 0 1584 0 1585 -55 -19 c-84 -29 -143 -68 -232 -154 l-83 -78 -54 49 c-111 102 -233 151 -391 160 -113 6 -199 -10 -298 -54 l-60 -27 -26 34 c-37 51 -120 134 -127 128 -3 -4 0 -34 7 -67 17 -89 7 -268 -21 -356 -103 -328 -377 -545 -688 -545 -161 0 -273 41 -373 137 -37 35 -66 75 -85 116 -79 173 -8 407 124 407 44 0 68 -14 117 -66 74 -78 167 -82 238 -9 60 62 72 147 33 231 -42 90 -120 130 -238 122 -50 -4 -85 -14 -131 -37 -89 -45 -122 -52 -176 -40 -92 20 -262 163 -302 253 -11 25 -21 45 -22 45 -1 -1 -30 -6 -65 -11z m-256 -505 c115 -88 129 -102 132 -131 2 -18 -2 -40 -9 -49 -7 -8 -69 -55 -138 -105 -103 -73 -130 -88 -151 -83 -35 8 -51 34 -48 74 3 31 12 42 83 92 44 31 80 61 82 66 1 4 -30 31 -69 58 -39 28 -77 56 -85 63 -18 19 -16 72 4 94 32 35 63 23 199 -79z m528 -88 c23 -24 28 -52 14 -82 l-13 -28 -141 -3 c-130 -2 -142 -1 -158 17 -23 26 -24 66 -1 91 16 18 32 20 151 20 105 0 136 -3 148 -15z"/>
          </g>
        </svg>
        <span class="badge" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/></svg>
        </span>
      </button>
    </div>
    <div id="functions">
      <a class="toggler"
         href="#"
         alt="Toggle keyboard"
         onclick="window.toggleFunctions()"
       ><i class="fas fa-keyboard"></i></a>
      <div class="onscreen-buttons">
        <a href="#" onclick="window.pressESC()"><div>Esc</div></a>
        <a href="#" onclick="window.pressTAB()"><div>Tab</div></a>
        <a id="onscreen-ctrl" href="#" onclick="window.toggleCTRL()"><div>Ctrl</div></a>
        <a href="#" onclick="window.pressLEFT()"><div>&#9664;</div></a>
        <a href="#" onclick="window.pressUP()"><div>&#9650;</div></a>
        <a href="#" onclick="window.pressRIGHT()"><div>&#9654;</div></a>
        <a href="#" style="visibility:hidden"><div></div></a>
        <a href="#" onclick="window.pressDOWN()"><div>&#9660;</div></a>
        <a href="#" style="visibility:hidden"><div></div></a>
      </div>
    </div>
    <div id="options">
      <a class="toggler"
         href="#"
         alt="Toggle options"
       ><i class="fas fa-cogs"></i></a>
      <iframe class="editor" src="${base}/client/xterm_config/index.html"></iframe>
    </div>
    <div id="terminal"></div>
    <div id="keybar"></div>
    ${jsFiles
      .map(
        (file) =>
          `    <script type="module" src="${base}/client/${file}"></script>`,
      )
      .join('\n')}
  </body>
</html>`;

export const html =
  (base: string, title: string): RequestHandler =>
  (_req: Request, res: Response): void => {
    res.send(render(title, base));
  };
