import { overlay } from './disconnect/elements';
import { verifyPrompt } from './disconnect/verify';

/**
 Show the disconnect overlay.
 @param reason - message to display
 @param reconnecting - true while an automatic reconnect is in progress:
   the manual button is kept as a fallback but the overlay reads as a
   transient state rather than a dead end.
 */
export function disconnect(reason?: string, reconnecting = false): void {
  if (overlay === null) return;
  overlay.style.display = 'block';
  overlay.classList.toggle('reconnecting', reconnecting);
  const msg = document.getElementById('msg');
  if (msg !== null) msg.textContent = reason ?? 'Session ended';
  window.removeEventListener('beforeunload', verifyPrompt, false);
}

export function updateDisconnectMessage(reason: string): void {
  if (overlay === null || overlay.style.display === 'none') return;
  const msg = document.getElementById('msg');
  if (msg !== null) msg.textContent = reason;
}
