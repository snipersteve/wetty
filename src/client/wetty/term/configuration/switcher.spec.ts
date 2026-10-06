import { expect } from 'chai';
import 'mocha';
import { JSDOM } from 'jsdom';
import { isSwitcherSwipe, openMobileSwitcher } from './switcher';
import type { Term } from '../../term';

describe('mobile Switch gesture', () => {
  it('accepts deliberate right swipes only', () => {
    expect(isSwitcherSwipe(64, 10, 300)).to.equal(true);
    for (const [dx, dy, ms] of [
      [63, 0, 300],
      [-100, 0, 300],
      [100, 80, 300],
      [100, 0, 700],
    ]) {
      expect(isSwitcherSwipe(dx, dy, ms)).to.equal(false);
    }
  });

  it('clicks the existing Switch header and does nothing when it is absent', () => {
    const { window } = new JSDOM('<div id="screen"></div>');
    const originalMouseEvent = globalThis.MouseEvent;
    globalThis.MouseEvent = window.MouseEvent;
    try {
      const screen = window.document.getElementById('screen');
      if (!screen) throw new Error('missing test screen');
      screen.getBoundingClientRect = () =>
        ({ left: 10, top: 20, width: 400, height: 600 }) as DOMRect;
      let header = `${' '.repeat(30)}│ switch  `;
      const buffer = {
        type: 'alternate',
        viewportY: 0,
        getLine: (row: number) => ({
          translateToString: (_trim: boolean, start: number, end: number) =>
            row === 1 ? header.slice(start, end) : '',
        }),
      };
      const modes = { mouseTrackingMode: 'sgr' };
      const term = {
        cols: 40,
        rows: 30,
        modes,
        buffer: { active: buffer },
      } as unknown as Term;
      const events: MouseEvent[] = [];
      screen.addEventListener('mousedown', (e) => events.push(e));
      screen.addEventListener('mouseup', (e) => events.push(e));
      expect(openMobileSwitcher(term, screen)).to.equal(true);
      expect(
        events.map((e) => [e.type, e.button, e.buttons, e.clientX, e.clientY]),
      ).to.deep.equal([
        ['mousedown', 0, 1, 360, 50],
        ['mouseup', 0, 0, 360, 50],
      ]);
      header = `${' '.repeat(30)}│ close   `;
      expect(openMobileSwitcher(term, screen)).to.equal(false);
      header = `${' '.repeat(30)}│ switch  `;
      buffer.type = 'normal';
      expect(openMobileSwitcher(term, screen)).to.equal(false);
      buffer.type = 'alternate';
      modes.mouseTrackingMode = 'none';
      expect(openMobileSwitcher(term, screen)).to.equal(false);
      expect(events).to.have.length(2);
    } finally {
      globalThis.MouseEvent = originalMouseEvent;
    }
  });
});
