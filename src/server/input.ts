// A palette query can generate 256 OSC replies in one xterm write. Sending
// that burst straight through SSH/tmux on macOS can lose bytes at PTY queue
// boundaries, leaving RGB tails to be interpreted as keystrokes. Pace complete
// colour replies, not arbitrary byte chunks; never drop replies or reorder keys.
// xterm's onData emits complete replies (Socket.IO preserves message boundaries).
// eslint-disable-next-line no-control-regex
const colorReply = /\x1b\](?:4;\d+|10|11|12);rgb:[\da-fA-F/]+(?:\x1b\\|\x07)/g;

export class TerminalInputWriter {
  private queue: { data: string; paced: boolean }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly write: (data: string) => void) {}

  input(data: string): void {
    if (this.disposed || data === '') return;
    let offset = 0;
    for (const match of data.matchAll(colorReply)) {
      if (match.index > offset) {
        this.queue.push({
          data: data.slice(offset, match.index),
          paced: false,
        });
      }
      this.queue.push({ data: match[0], paced: true });
      offset = match.index + match[0].length;
    }
    if (offset < data.length) {
      this.queue.push({ data: data.slice(offset), paced: false });
    }
    if (this.timer === undefined) this.drain();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }

  private drain(): void {
    this.timer = undefined;
    while (!this.disposed && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      this.write(item.data);
      if (item.paced) {
        // Also keep the cooldown after the last reply: subsequent onData
        // messages in the same burst must not bypass the rate limit.
        this.timer = setTimeout(() => {
          this.drain();
        }, 2);
        return;
      }
    }
  }
}
