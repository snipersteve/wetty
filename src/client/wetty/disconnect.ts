import { overlay } from './disconnect/elements';
import { verifyPrompt } from './disconnect/verify';

function setReason(reason: string): void {
  const ram = overlay?.querySelector<HTMLButtonElement>('.ram');
  if (!ram) return;
  ram.title = reason;
  ram.setAttribute('aria-label', reason);
}

/**
 Show the disconnect overlay: Herdr's ram, breathing while an automatic
 reconnect runs, still once the session has ended. Tapping it reconnects.
 @param reason - state text, exposed as the button's title / aria-label
 @param reconnecting - true while an automatic reconnect is in progress
 */
export function disconnect(reason?: string, reconnecting = false): void {
  if (overlay === null) return;
  overlay.style.display = 'block';
  overlay.classList.toggle('reconnecting', reconnecting);
  setReason(reason ?? 'Session ended');
  window.removeEventListener('beforeunload', verifyPrompt, false);
}

export function updateDisconnectMessage(reason: string): void {
  if (overlay === null || overlay.style.display === 'none') return;
  setReason(reason);
}
