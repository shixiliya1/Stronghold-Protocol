// Room text chat (shared/chat.js) — the 聊天 button next to 交流 in a match, and in the room screen: recent lines float
// as bubbles for a few seconds, the button opens the log + a text input (Enter sends, ≤ CHAT_MAX_LEN characters).
// Shown only when the server relays chat (`welcome.features` includes 'chat' → store.features.chat); a server without it
// never sees room.chat. Text is rendered as text nodes only (htm/preact escapes) — never as HTML.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { CHAT_MAX_LEN, cleanChat } from '../../../shared/chat.js';
import { html } from './components.js';
import { net, errorText } from '../net.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** How long a new line floats as a bubble while the log is closed. */
export const CHAT_BUBBLE_MS = 8000;
/** Lines kept in the store (main.js). */
export const CHAT_KEEP = 60;
export const CHAT_CSS_HREF = '/css/chat.css';

function ensureChatCss(doc = globalThis.document) {
  if (!doc?.head || doc.querySelector(`link[rel="stylesheet"][href$="${CHAT_CSS_HREF}"]`)) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = CHAT_CSS_HREF;
  doc.head.appendChild(link);
}

/** Characters (code points) of a string. */
const cpLen = (s) => [...String(s || '')].length;

/** Lines that still float as bubbles at `now`. */
export function bubbleLines(lines, now, ms = CHAT_BUBBLE_MS, max = 4) {
  return (lines || []).filter((l) => now - l.at < ms).slice(-max);
}

/**
 * @param {{ placement?: 'game'|'room', disabled?: boolean, readOnly?: boolean }} props
 *   readOnly: a viewer who may read but not write (none today; spectators may chat)
 */
export function ChatBox({ placement = 'game', disabled = false, readOnly = false }) {
  const enabled = useStore((s) => !!s.features?.chat);
  const lines = useStore((s) => s.chat);
  const myId = useStore((s) => s.me.playerId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { ensureChatCss(); }, []);
  // re-render while bubbles are visible so they expire
  useEffect(() => {
    if (open || !lines.length) return undefined;
    const left = CHAT_BUBBLE_MS - (Date.now() - lines[lines.length - 1].at);
    if (left <= 0) return undefined;
    const h = setTimeout(() => tick((n) => n + 1), left + 50);
    return () => clearTimeout(h);
  }, [lines, open]);
  useEffect(() => { if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [open, lines]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  const [unread, setUnread] = useState(0);
  const seen = useRef(lines.length ? lines[lines.length - 1].seq : 0);
  useEffect(() => {
    const last = lines.length ? lines[lines.length - 1].seq : 0;
    if (open) { seen.current = last; setUnread(0); return; }
    setUnread(lines.filter((l) => l.seq > seen.current && l.playerId !== myId).length);
  }, [lines, open]);
  if (!enabled) return null;

  const send = async (e) => {
    e?.preventDefault?.();
    const clean = cleanChat(text);
    if (!clean || busy || disabled) return;
    setBusy(true);
    setErr('');
    try {
      await net.request('room.chat', { text: clean });
      setText('');
    } catch (ex) {
      setErr(ex?.code === 'RATE' ? t('发送太快了，请稍等') : (ex?.message || errorText(ex?.code)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };
  const line = (l) => html`<div key=${l.seq} class=${'chat__line' + (l.playerId === myId ? ' is-me' : '') + (l.spectator ? ' is-spec' : '')}>
    <b class="chat__who">${l.name || '?'}</b><span class="chat__text">${l.text}</span></div>`;
  const bubbles = open ? [] : bubbleLines(lines, Date.now());
  return html`<div class=${'chat chat--' + placement + (open ? ' is-open' : '')}>
    ${bubbles.length ? html`<div class="chat__bubbles" aria-live="polite">${bubbles.map(line)}</div>` : null}
    ${open ? html`<div class="chat__panel" role="dialog" aria-label=${t('聊天')}>
      <div class="chat__log" ref=${logRef}>${lines.length ? lines.map(line) : html`<div class="chat__empty">${t('还没有消息')}</div>`}</div>
      ${readOnly ? null : html`<form class="chat__form" onSubmit=${send}>
        <input ref=${inputRef} class="chat__input" type="text" enterkeyhint="send" autocomplete="off" maxlength=${CHAT_MAX_LEN * 2}
          placeholder=${t('输入消息，回车发送')} value=${text} disabled=${disabled}
          onInput=${(e) => { setText(e.currentTarget.value); setErr(''); }}
          onKeyDown=${(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }} />
        <span class=${'chat__count' + (cpLen(text) > CHAT_MAX_LEN ? ' is-over' : '')}>${cpLen(text)}/${CHAT_MAX_LEN}</span>
        <button type="submit" class="chat__send" disabled=${disabled || busy || !cleanChat(text)}>${t('发送')}</button>
      </form>`}
      ${err ? html`<div class="chat__err" role="alert">${err}</div>` : null}
    </div>` : null}
    <button type="button" class=${'chat__btn' + (open ? ' is-on' : '')} aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <span class="chat__label">${t('聊天')}</span>${unread ? html`<span class="chat__badge">${unread > 9 ? '9+' : unread}</span>` : null}
    </button>
  </div>`;
}
