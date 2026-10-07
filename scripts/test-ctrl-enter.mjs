// Real PTY -> isolated tmux -> raw reader. Never writes to the user's pane.
// Run: node scripts/test-ctrl-enter.mjs
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import pty from 'node-pty';

const root = new URL('../', import.meta.url);
const directory = mkdtempSync(`${tmpdir()}/wetty-ctrl-enter-`);
const python = execFileSync('/usr/bin/which', ['python3'], {
  encoding: 'utf8',
}).trim();
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const report = '\x1b[13;5u';
async function probe(label, config, input, expected, hotMode) {
  const name = `wetty-ctrl-enter-${process.pid}-${label}`;
  const output = `${directory}/${label}.json`;
  const conf = `${directory}/${label}.conf`;
  writeFileSync(conf, config);
  const code = `import os,tty,json,select,time
from pathlib import Path
tty.setraw(0)
os.write(1,b'KEY_PROBE_READY')
data=b''; end=time.monotonic()+2
while time.monotonic()<end:
 if select.select([0],[],[],.03)[0]:
  data+=os.read(0,4096)
  if not select.select([0],[],[],.1)[0]: break
Path(${JSON.stringify(output)}).write_text(json.dumps(data.hex()))
`;
  const term = pty.spawn(
    '/opt/homebrew/bin/tmux',
    [
      '-L',
      name,
      '-f',
      conf,
      'new-session',
      `${quote(python)} -c ${quote(code)}`,
    ],
    {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: { ...process.env, TERM: 'xterm-256color' },
    },
  );
  let buffer = '';
  let sent = false;
  term.onData((data) => {
    buffer += data;
    if (!sent && buffer.includes('KEY_PROBE_READY')) {
      sent = true;
      if (hotMode) {
        execFileSync('/opt/homebrew/bin/tmux', [
          '-L',
          name,
          'set-option',
          '-s',
          'extended-keys',
          'always',
        ]);
        if (hotMode === 'activate') {
          const tty = execFileSync(
            '/opt/homebrew/bin/tmux',
            ['-L', name, 'display-message', '-p', '#{pane_tty}'],
            { encoding: 'utf8' },
          ).trim();
          // Write terminal output, NOT keyboard input: update the existing
          // pane's emulation mode without restarting its child process.
          const fd = openSync(tty, 'w');
          try {
            writeSync(fd, '\x1b[>4;2m');
          } finally {
            closeSync(fd);
          }
        }
      }
      setTimeout(() => {
        term.write(input);
      }, 30);
    }
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Key probe timed out')),
        5000,
      );
      term.onExit(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const hex = JSON.parse(readFileSync(output, 'utf8'));
    console.log(`${label}: ${hex}`);
    assert.equal(hex, Buffer.from(expected).toString('hex'));
  } finally {
    try {
      term.kill();
    } catch {}
    try {
      execFileSync('/opt/homebrew/bin/tmux', ['-L', name, 'kill-server'], {
        stdio: 'ignore',
      });
    } catch {}
  }
}
try {
  const config = readFileSync(
    new URL('conf/herdr-persistent.tmux.conf', root),
    'utf8',
  );
  await probe(
    'disabled',
    `${config}\nset -s extended-keys off\n`,
    report,
    '\r',
  );
  const fixed = `${config}\nset -s extended-keys always\nset -s extended-keys-format csi-u\n`;
  await probe('enabled', fixed, report, report);
  await probe('plain-enter', fixed, '\r', '\r');
  await probe('ctrl-c', fixed, '\x03', '\x03');
  const legacy = `${config}\nset -s extended-keys off\n`;
  await probe('hot-option-only', legacy, report, '\r', 'option-only');
  await probe('hot-activated', legacy, report, report, 'activate');
  console.log(
    'PASS: Ctrl+Enter survives tmux; plain Enter and Ctrl+C unchanged',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
