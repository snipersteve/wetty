import { dom, library } from '@fortawesome/fontawesome-svg-core';
import { faCogs, faKeyboard } from '@fortawesome/free-solid-svg-icons';

import '../assets/scss/styles.scss';

import { disconnect, updateDisconnectMessage } from './wetty/disconnect';
import { overlay } from './wetty/disconnect/elements';
import { verifyPrompt } from './wetty/disconnect/verify';
import { FileDownloader } from './wetty/download';
import { FlowControlClient } from './wetty/flowcontrol';
import { mobileKeyboard } from './wetty/mobile';
import { socket } from './wetty/socket';
import { terminal, Term } from './wetty/term';

if ('serviceWorker' in navigator) {
  const scripts = Array.from(document.getElementsByTagName('script'));
  const own = scripts.find((s) => s.src.endsWith('/wetty.js'));
  if (own) {
    const base = own.src.replace(/\/client\/wetty\.js$/, '');
    void navigator.serviceWorker.register(`${base}/sw.js`, {
      scope: `${base}/`,
    });
  }
}

// Setup for fontawesome
library.add(faCogs);
library.add(faKeyboard);
dom.watch();

function onResize(term: Term): () => void {
  return function resize() {
    term.resizeTerm();
  };
}

let resizeListener: (() => void) | undefined;

/**
 Force a fresh session: drop the current socket (the server kills the PTY
 on disconnect) and connect again, which spawns a new one. Used by the
 overlay button after a logout and to short-circuit socket.io's backoff.
 */
function reconnect(): void {
  socket.disconnect();
  socket.connect();
}

socket.on('connect', () => {
  // A reconnect re-enters here: tear down the previous terminal and its
  // socket listeners, otherwise every reconnect stacks another `data`
  // handler writing into a dead terminal.
  window.wetty_term?.dispose();
  socket.off('data').off('login').off('logout').off('error');
  if (resizeListener !== undefined) {
    window.removeEventListener('resize', resizeListener, false);
  }

  const term = terminal(socket);
  if (term === undefined) return;

  if (overlay !== null) overlay.style.display = 'none';
  window.addEventListener('beforeunload', verifyPrompt, false);
  resizeListener = onResize(term);
  window.addEventListener('resize', resizeListener, false);

  term.resizeTerm();
  term.focus();
  mobileKeyboard();
  const fileDownloader = new FileDownloader();
  const fcClient = new FlowControlClient();

  term.onData((data: string) => {
    socket.emit('input', data);
  });
  term.onResize((size: { cols: number; rows: number }) => {
    socket.emit('resize', size);
  });
  socket
    .on('data', (data: string) => {
      const remainingData = fileDownloader.buffer(data);
      const downloadLength = data.length - remainingData.length;
      if (downloadLength && fcClient.needsCommit(downloadLength)) {
        socket.emit('commit', fcClient.ackBytes);
      }
      if (remainingData) {
        if (fcClient.needsCommit(remainingData.length)) {
          term.write(remainingData, () =>
            socket.emit('commit', fcClient.ackBytes),
          );
        } else {
          term.write(remainingData);
        }
      }
    })
    .on('login', () => {
      term.writeln('');
      term.resizeTerm();
    })
    // The remote command exited (e.g. herdr detached with prefix+q). The
    // socket is still up; a new session needs a fresh connection.
    .on('logout', () => {
      disconnect('会话已结束 · Session ended');
    })
    .on('error', (err: string | null) => {
      if (err) disconnect(err);
    });
});

// Transport lost: socket.io retries on its own (see socket.ts); show the
// overlay as a transient state and keep the message honest about attempts.
socket.on('disconnect', (reason) => {
  if (reason === 'io client disconnect') return; // our own reconnect()
  disconnect('连接已断开，正在重连…', true);
});
socket.io.on('reconnect_attempt', (attempt: number) => {
  updateDisconnectMessage(`正在重连 (${String(attempt)})…`);
});

// Coming back to the foreground or regaining network is the moment to
// reconnect immediately instead of waiting out the backoff timer.
const wake = (): void => {
  if (socket.connected) {
    window.wetty_term?.resizeTerm();
  } else {
    socket.connect();
  }
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wake();
});
window.addEventListener('online', wake);
window.addEventListener('pageshow', wake);

declare global {
  interface Window {
    wettyReconnect?: () => void;
  }
}
window.wettyReconnect = reconnect;

// xterm measures cell size once at open; if the webfont arrives later the
// grid is computed against the fallback font and stays wrong. Connect only
// once the font is in (bounded — a missing font must not block the
// terminal), so the first frames land in a correctly sized terminal.
const fontsReady: Promise<unknown> =
  'fonts' in document
    ? Promise.race([
        document.fonts.load('14px "JetBrains Mono"'),
        new Promise((resolve) => {
          setTimeout(resolve, 2500);
        }),
      ]).catch(() => undefined)
    : Promise.resolve();
void fontsReady.then(() => {
  socket.connect();
});
