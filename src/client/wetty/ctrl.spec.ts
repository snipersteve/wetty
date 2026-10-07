import 'mocha';
import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { CTRL_ENTER, ctrlKeyHandler, isCtrlArmed, setCtrl } from './ctrl';

describe('Ctrl+Enter keyboard encoding', () => {
  const dom = new JSDOM();
  let writes: string[];
  const term = {
    input: (data: string): void => {
      writes.push(data);
    },
  };
  const key = (init: KeyboardEventInit = {}, type = 'keydown'): KeyboardEvent =>
    new dom.window.KeyboardEvent(type, {
      key: 'Enter',
      cancelable: true,
      ...init,
    });

  beforeEach(() => {
    writes = [];
    setCtrl(false);
  });

  after(() => {
    dom.window.close();
  });

  it('sends the same CSI-u sequence as the mobile key bar and prevents default', () => {
    const event = key({ ctrlKey: true });
    expect(ctrlKeyHandler(term, event)).to.equal(false);
    expect(event.defaultPrevented).to.equal(true);
    expect(writes).to.deep.equal([CTRL_ENTER]);
  });

  it('supports sticky Ctrl and disarms it after Enter', () => {
    setCtrl(true);
    expect(ctrlKeyHandler(term, key())).to.equal(false);
    expect(writes).to.deep.equal([CTRL_ENTER]);
    expect(isCtrlArmed()).to.equal(false);
  });

  it('leaves plain Enter, Shift+Enter and other modified combinations to xterm', () => {
    for (const init of [
      {},
      { shiftKey: true },
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, metaKey: true },
      { ctrlKey: true, shiftKey: true },
    ]) {
      expect(ctrlKeyHandler(term, key(init))).to.equal(true);
    }
    expect(writes).to.deep.equal([]);
  });

  it('does not duplicate keyup or interfere with IME composition', () => {
    expect(ctrlKeyHandler(term, key({ ctrlKey: true }, 'keyup'))).to.equal(
      true,
    );
    expect(
      ctrlKeyHandler(term, key({ ctrlKey: true, isComposing: true })),
    ).to.equal(true);
    expect(writes).to.deep.equal([]);
  });

  it('keeps sticky Ctrl+C working', () => {
    setCtrl(true);
    expect(ctrlKeyHandler(term, key({ key: 'c' }))).to.equal(false);
    expect(writes).to.deep.equal(['\x03']);
    expect(isCtrlArmed()).to.equal(false);
  });
});
