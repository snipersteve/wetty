/**
 Agent completion notifications in the browser, the web twin of the Android
 shell's NotifyService: an EventSource on the proxy's /events (same origin,
 cookie auth) receives each herdr "done / blocked" event.

 - Secure context (HTTPS or http://localhost) with permission granted: a
   silent system notification plus our own chime (web notifications cannot
   carry a custom sound, and the OS default depends on per-browser OS
   settings). Browsers expose the Notification API only there.
 - Otherwise (plain HTTP on a LAN IP): an in-page toast plus the chime.
 - Either way, while the page is not in front the tab title carries an
   unread count, cleared on return.

 Skipped inside the Android shell, which posts native notifications itself.
 */

interface NotifyEvent {
  id: number;
  title: string;
  body: string;
}

const baseTitle = document.title;
let unread = 0;

function inFront(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function updateTitle(): void {
  document.title = unread > 0 ? `(${String(unread)}) ${baseTitle}` : baseTitle;
}

function canSystemNotify(): boolean {
  return window.isSecureContext && 'Notification' in window;
}

/** Ask once, on the first user gesture (browsers ignore or bury non-gesture prompts). */
function armPermissionPrompt(): void {
  if (!canSystemNotify() || Notification.permission !== 'default') return;
  const ask = (): void => {
    window.removeEventListener('pointerdown', ask, true);
    window.removeEventListener('keydown', ask, true);
    void Notification.requestPermission();
  };
  window.addEventListener('pointerdown', ask, true);
  window.addEventListener('keydown', ask, true);
}

let audio: AudioContext | null = null;

/**
 Create/resume the AudioContext inside a user gesture (autoplay policy), so
 the chime can later play from a background tab.
 */
function armAudio(): void {
  const unlock = (): void => {
    try {
      audio ??= new AudioContext();
      void audio.resume();
    } catch {
      /* no audio */
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/**
 Two sine blips.
 @returns false when the browser blocks audio (no user gesture yet since the
   page loaded — autoplay policy), so the caller can say so
 */
function chime(): boolean {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    if (ctx.state !== 'running') return false;
    [0, 0.2].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1175;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
    return true;
  } catch {
    return false;
  }
}

let toastBox: HTMLElement | null = null;

/** Top-right card, stays ~6 s; click dismisses. */
function pageToast(ev: NotifyEvent, muted: boolean): void {
  if (toastBox === null) {
    toastBox = document.createElement('div');
    toastBox.style.cssText =
      'position:fixed;top:1em;right:4.5em;z-index:9999;display:flex;' +
      'flex-direction:column;gap:6px;max-width:min(360px,80vw);';
    document.body.appendChild(toastBox);
  }
  const card = document.createElement('div');
  card.style.cssText =
    'background:rgba(30,30,30,.95);color:#fff;border:1px solid rgba(255,255,255,.14);' +
    'border-left:3px solid #3b7ddd;border-radius:8px;padding:8px 12px;' +
    'font:13px/1.4 system-ui,-apple-system,sans-serif;cursor:pointer;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .3s;';
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.textContent = ev.title;
  card.appendChild(title);
  if (ev.body !== '') {
    const body = document.createElement('div');
    body.style.opacity = '0.75';
    body.textContent = ev.body;
    card.appendChild(body);
  }
  if (muted) {
    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.6;font-size:12px;margin-top:2px;';
    hint.textContent = '🔇 点一下页面即可启用提示音';
    card.appendChild(hint);
  }
  const remove = (): void => {
    card.style.opacity = '0';
    setTimeout(() => {
      card.remove();
    }, 300);
  };
  card.addEventListener('click', remove);
  toastBox.appendChild(card);
  setTimeout(remove, 6000);
}

function onNotify(ev: NotifyEvent): void {
  if (!inFront()) {
    unread += 1;
    updateTitle();
  }
  if (canSystemNotify() && Notification.permission === 'granted') {
    // tag = event id: several open tabs collapse into one notification.
    const n = new Notification(ev.title, {
      body: ev.body,
      tag: `herdr-${String(ev.id)}`,
      silent: true,
      icon: document.querySelector<HTMLLinkElement>('link[rel=icon]')?.href,
    });
    n.onclick = (): void => {
      window.focus();
      n.close();
    };
    if (!chime()) pageToast(ev, true);
    return;
  }
  pageToast(ev, !chime());
}

export function setupNotifications(): void {
  if (window.HerdrShell !== undefined || !('EventSource' in window)) return;
  armPermissionPrompt();
  armAudio();
  const clear = (): void => {
    if (!inFront() || unread === 0) return;
    unread = 0;
    updateTitle();
  };
  document.addEventListener('visibilitychange', clear);
  window.addEventListener('focus', clear);

  // EventSource reconnects on its own and resends Last-Event-ID, so the
  // proxy replays whatever was missed while the connection was down.
  // /events lives on wetty-proxy at the origin root, whatever wetty's base.
  const es = new EventSource('/events', { withCredentials: true });
  es.addEventListener('notify', (e: MessageEvent<string>) => {
    try {
      onNotify(JSON.parse(e.data) as NotifyEvent);
    } catch {
      /* malformed event */
    }
  });
}
