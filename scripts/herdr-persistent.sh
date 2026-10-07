#!/bin/sh
# Reattach the same Herdr UI after a browser disconnect. Only the tmux client
# belongs to the SSH/WeTTY PTY; tmux's server owns Herdr and its Remote links.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export COLORTERM=truecolor
# launchd -> ssh may omit locale entirely. tmux otherwise replaces Chinese
# with underscores even though xterm.js supports UTF-8. Force both the pane
# locale and (with -u below) the attaching terminal's UTF-8 capability.
export LANG=en_US.UTF-8
export LC_CTYPE=en_US.UTF-8
# This socket is isolated from any desktop/user tmux sessions. Override only
# for integration tests. All WeTTY tabs intentionally mirror the same UI.
SOCKET=${WETTY_TMUX_SOCKET:-wetty-herdr}
# Do not use -D or -d: attaching must not kick another browser off the session.
exec /opt/homebrew/bin/tmux -u -L "$SOCKET" \
  -f "$ROOT/conf/herdr-persistent.tmux.conf" \
  new-session -A -s wetty -c "$HOME/Documents/obsidian" \
  "$HOME/.local/bin/herdr"
