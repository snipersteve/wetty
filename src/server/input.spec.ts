import 'mocha';
import { expect } from 'chai';
import sinon from 'sinon';
import { TerminalInputWriter } from './input.js';

const reply = (index: number): string =>
  `\x1b]4;${String(index)};rgb:d7d7/ffff/ffff\x1b\\`;

describe('TerminalInputWriter', () => {
  let clock: sinon.SinonFakeTimers;
  let writes: string[];
  let writer: TerminalInputWriter;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    writes = [];
    writer = new TerminalInputWriter((data) => {
      writes.push(data);
    });
  });

  afterEach(() => {
    writer.dispose();
    clock.restore();
  });

  it('forwards normal keys, IME, focus, mouse and paste immediately and unchanged', () => {
    const inputs = [
      '中文',
      '\r',
      '\x1b[I',
      '\x1b[<0;1;1M',
      '\x1b[200~d7/ffff/ffff\x1b[201~',
    ];
    inputs.forEach((data) => {
      writer.input(data);
    });
    expect(writes).to.deep.equal(inputs);
    expect(clock.countTimers()).to.equal(0);
  });

  it('paces 256 separate xterm replies without losing or splitting any', () => {
    const inputs = Array.from({ length: 256 }, (_, i) => reply(i));
    inputs.forEach((data) => {
      writer.input(data);
    });
    expect(writes).to.deep.equal([inputs[0]]);
    clock.tick(1);
    expect(writes).to.have.length(1);
    clock.runAll();
    expect(writes).to.deep.equal(inputs);
  });

  it('splits batched replies at sequence boundaries and keeps keyboard input ordered', () => {
    const data = `a${reply(0)}${reply(1)}b`;
    writer.input(data);
    writer.input('c');
    expect(writes).to.deep.equal(['a', reply(0)]);
    clock.runAll();
    expect(writes.join('')).to.equal(`${data}c`);
  });

  it('handles default colours and both OSC terminators', () => {
    const a = '\x1b]10;rgb:ffff/ffff/ffff\x07';
    const b = '\x1b]11;rgb:0000/0000/0000\x1b\\';
    const c = '\x1b]12;rgb:aaaa/bbbb/cccc\x07';
    writer.input(a + b + c);
    expect(writes).to.deep.equal([a]);
    clock.runAll();
    expect(writes).to.deep.equal([a, b, c]);
  });

  it('keeps a cooldown across separate socket messages even when the queue was empty', () => {
    writer.input(reply(1));
    clock.tick(1);
    writer.input(reply(2));
    expect(writes).to.have.length(1);
    clock.tick(1);
    expect(writes).to.have.length(2);
  });

  it('cancels queued writes on disconnect or PTY exit', () => {
    writer.input(reply(0) + reply(1));
    writer.dispose();
    writer.input('ignored');
    clock.runAll();
    expect(writes).to.deep.equal([reply(0)]);
    expect(clock.countTimers()).to.equal(0);
  });
});
