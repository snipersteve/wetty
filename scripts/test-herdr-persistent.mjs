// Live integration test: isolated WeTTY port + isolated tmux server, real SSH
// to localhost and real Herdr. Never kills the production tmux/server/session.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

const root = fileURLToPath(new URL('..', import.meta.url));
const name = `wetty-herdr-test-${process.pid}`;
const port = Number(process.env.TEST_PORT || 43920);
const url = `http://127.0.0.1:${port}`;
const tmux = (...args) => execFileSync('/opt/homebrew/bin/tmux', ['-L', name, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}
let logs = '';
let server;
const clients = [];
function start() {
  server = spawn(process.execPath, ['build/main.js', '--host', '127.0.0.1', '--port', String(port), '--ssh-user', process.env.USER, '--ssh-key', `${process.env.HOME}/.ssh/id_ed25519`, '--ssh-auth', 'publickey', '--command', `env WETTY_TMUX_SOCKET=${name} '${root}scripts/herdr-persistent.sh'`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', b => { logs += b; });
  server.stderr.on('data', b => { logs += b; });
}
async function ready() {
  await until(async () => (await fetch(`${url}/`)).ok, 'WeTTY ready');
}
async function connect() {
  const socket = io(url, { path: '/socket.io', reconnection: false, autoConnect: false, extraHeaders: { referer: `${url}/` } });
  clients.push(socket);
  let bytes = 0;
  socket.on('data', data => { bytes += data.length; socket.emit('commit', data.length); });
  socket.on('connect', () => socket.emit('resize', { cols: 100, rows: 35 }));
  socket.connect();
  await until(() => socket.connected && bytes > 0, 'terminal data');
  await until(() => tmux('list-panes', '-t', 'wetty', '-F', '#{pane_current_command}') === 'herdr', 'Herdr running');
  assert.ok(tmux('list-clients', '-F', '#{client_utf8}').split('\n').every(flag => flag === '1'), 'all terminal clients must enable UTF-8');
  return socket;
}
const panePid = () => tmux('list-panes', '-t', 'wetty', '-F', '#{pane_pid}');
const remotePids = pid => execFileSync('/bin/ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' }).split('\n')
  .map(line => line.trim().split(/\s+/))
  .filter(parts => parts[1] === pid && parts.join(' ').includes('remote-client-bridge'))
  .map(parts => parts[0]).sort();
try {
  start();
  await ready();
  let first = await connect();
  const pid = panePid();
  await sleep(2500);
  assert.ok(tmux('capture-pane', '-p', '-t', 'wetty').trim(), 'screen rendered');
  // Endpoint activation is asynchronous and may start after the local UI.
  const remote = await until(() => { const ids = remotePids(pid); return ids.length ? ids : null; }, 'optional Remote SSH', 15000).catch(() => []);
  await sleep(3000);
  first.disconnect();
  await until(() => tmux('list-clients') === '', 'SSH/tmux client gone');
  await sleep(20000);
  assert.equal(panePid(), pid, 'Herdr survives no clients');
  if (remote.length) assert.deepEqual(remotePids(pid), remote, 'Remote SSH survives no clients');
  console.log(`PASS disconnect > heartbeat timeout: Herdr PID ${pid} alive`);
  console.log(remote.length ? `PASS Remote SSH processes preserved: ${remote.join(', ')}` : 'SKIP Remote SSH check: no enabled remote connected');
  const second = await connect();
  assert.equal(panePid(), pid, 'reconnect uses same Herdr');
  const third = await connect();
  assert.equal(tmux('list-clients').split('\n').length, 2, 'two clients coexist');
  third.disconnect();
  await until(() => tmux('list-clients').split('\n').filter(Boolean).length === 1, 'one client remains');
  assert.equal(panePid(), pid);
  assert.ok(second.connected);
  console.log('PASS reconnect and simultaneous clients preserve same Herdr');
  // Service restart should also leave the independently owned terminal alive.
  second.disconnect();
  await until(() => tmux('list-clients') === '', 'detached before restart');
  const stopped = new Promise(r => server.once('exit', r));
  server.kill('SIGTERM');
  await stopped;
  start();
  await ready();
  await connect();
  assert.equal(panePid(), pid);
  if (remote.length) assert.deepEqual(remotePids(pid), remote, 'Remote SSH survives service restart');
  console.log('PASS WeTTY restart preserves same Herdr and Remote SSH');
} catch (e) {
  console.error(logs.slice(-6000));
  throw e;
} finally {
  for (const c of clients) c.disconnect();
  await sleep(500);
  server?.kill('SIGTERM');
  try { tmux('kill-server'); } catch {}
}
