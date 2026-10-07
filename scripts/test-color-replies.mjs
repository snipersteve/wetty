// macOS regression: real node-pty -> SSH -> isolated tmux -> raw reader.
// Run: node --import tsx scripts/test-color-replies.mjs [--unpaced]
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import pty from 'node-pty';
import { TerminalInputWriter } from '../src/server/input.ts';

const directory = mkdtempSync(`${tmpdir()}/wetty-colors-`);
const result = `${directory}/result.json`;
const name = `wetty-colors-${process.pid}`;
const python = execFileSync('/usr/bin/which', ['python3'], {
  encoding: 'utf8',
}).trim();
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const script = `import os,tty,time,select,json,re
from pathlib import Path
tty.setraw(0)
time.sleep(0.6)
query='\\x1b]10;?\\x1b\\\\\\x1b]11;?\\x1b\\\\'+''.join(f'\\x1b]4;{i};?\\x1b\\\\' for i in range(256))
rounds=[]
for _ in range(3):
 os.write(1,query.encode())
 data=b''; end=time.monotonic()+1.8
 while time.monotonic()<end:
  if select.select([0],[],[],.03)[0]: data+=os.read(0,4096)
 pattern=rb'\\x1b\\](?:4;\\d+|10|11);rgb:[0-9a-f/]+(?:\\x1b\\\\|\\x07)'
 rounds.append({'replies':len(re.findall(pattern,data)), 'leftovers':repr(re.sub(pattern,b'',data)), 'bytes':len(data)})
Path(${JSON.stringify(result)}).write_text(json.dumps(rounds))
`;
const command = `/opt/homebrew/bin/tmux -L ${name} -f /dev/null new-session ${quote(`${quote(python)} -c ${quote(script)}`)}`;
const term = pty.spawn(
  '/usr/bin/ssh',
  [
    '-tt',
    '-o',
    'BatchMode=yes',
    '-i',
    `${process.env.HOME}/.ssh/id_ed25519`,
    `${process.env.USER}@localhost`,
    command,
  ],
  {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    env: { ...process.env, TERM: 'xterm-256color' },
  },
);
const writer = new TerminalInputWriter((data) => term.write(data));
const send = (data) =>
  process.argv.includes('--unpaced') ? term.write(data) : writer.input(data);
let buffer = '';
let diagnostic = '';
term.onData((data) => {
  diagnostic = (diagnostic + data).slice(-1000);
  buffer += data;
  const query = /\x1b\](4;\d+|10|11);\?(?:\x1b\\|\x07)|\x1b\[(>|\?)?c/g;
  let end = 0;
  for (const match of buffer.matchAll(query)) {
    if (match[1]) {
      let rgb = match[1] === '11' ? [0, 0, 0] : [255, 255, 255];
      if (match[1].startsWith('4;')) {
        const i = Number(match[1].slice(2));
        const cube = [0, 95, 135, 175, 215, 255];
        if (i >= 232) rgb = Array(3).fill(8 + 10 * (i - 232));
        else if (i >= 16)
          rgb = [
            cube[Math.floor((i - 16) / 36)],
            cube[Math.floor((i - 16) / 6) % 6],
            cube[(i - 16) % 6],
          ];
        else rgb = [128, 128, 128];
      }
      const color = rgb
        .map((c) => c.toString(16).padStart(2, '0').repeat(2))
        .join('/');
      send(`\x1b]${match[1]};rgb:${color}\x1b\\`);
    } else {
      send(match[2] === '>' ? '\x1b[>0;276;0c' : '\x1b[?1;2c');
    }
    end = match.index + match[0].length;
  }
  buffer = buffer.slice(end).slice(-100);
});
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout: ${JSON.stringify(diagnostic)}`)),
      12000,
    );
    term.onExit(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  assert.ok(
    existsSync(result),
    `Reader did not finish: ${JSON.stringify(diagnostic)}`,
  );
  const rounds = JSON.parse(readFileSync(result, 'utf8'));
  console.log(
    JSON.stringify(
      { paced: !process.argv.includes('--unpaced'), rounds },
      null,
      2,
    ),
  );
  for (const round of rounds) {
    assert.equal(round.replies, 258);
    assert.equal(round.leftovers, "b''");
  }
  console.log(
    'PASS: 3 palette refreshes; 774 complete replies; no leaked text',
  );
} finally {
  writer.dispose();
  try {
    term.kill();
  } catch {}
  try {
    execFileSync('/opt/homebrew/bin/tmux', ['-L', name, 'kill-server'], {
      stdio: 'ignore',
    });
  } catch {}
  rmSync(directory, { recursive: true, force: true });
}
