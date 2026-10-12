// (i18n-ignore-file: the profanity word list is data, not UI text — docs/I18N.md)
// Room text chat (a remake feature on top of the official 交流 emotes): room.chat { text } → the room's members get
// room.chat { playerId, name, text, at, spectator? }. Both sides import these rules; the server's copy is the one that
// counts (shared so the client's input can trim / count the same way and tests can pin them).
//
//   * at most CHAT_MAX_LEN characters (code points) after cleaning; an empty result is refused
//   * control / format characters (C0, C1, DEL, bidi overrides, zero-width …) removed, whitespace runs → one space
//   * a basic profanity filter: listed words become ＊＊ (the rest of the message stays)
//   * no markup: the text is plain text end to end (the client renders it as a text node, never as HTML)
//   * the server rate-limits per player: CHAT_RATE.count messages per CHAT_RATE.windowMs (room.chat → error RATE)
//   * capability: `welcome.features` includes 'chat' on servers that relay it; clients hide the input otherwise

/** Longest message (characters / code points, after cleaning). */
export const CHAT_MAX_LEN = 100;
/** Raw input the protocol accepts before cleaning (UTF-16 units). */
export const CHAT_RAW_MAX = 400;
/** Per-player rate limit: `count` messages per `windowMs`. */
export const CHAT_RATE = Object.freeze({ count: 3, windowMs: 5000 });
/** The `welcome.features` flag of servers that relay room chat. */
export const CHAT_FEATURE = 'chat';

// Cc (C0, DEL, C1) and Cf (soft hyphen, ZW*, bidi marks/overrides/isolates, BOM, …); line / paragraph separators
const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

// A short list of common insults (zh / en). Matching is case-insensitive and ignores spaces / punctuation inserted
// between the letters of a Latin word only when written as one token; this is a courtesy filter, not moderation.
const BAD_WORDS = [
  '傻逼', '煞笔', '傻b', 'sb', '操你妈', '草你妈', '肏', '你妈死了', '尼玛死', '狗日的', '贱人', '婊子', '去死', '脑残', '弱智', '滚你妈',
  'fuck', 'fucking', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'nigger', 'faggot', 'retard', 'motherfucker',
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LATIN = BAD_WORDS.filter((w) => /^[a-z]+$/.test(w)).sort((a, b) => b.length - a.length);
const OTHER = BAD_WORDS.filter((w) => !/^[a-z]+$/.test(w)).sort((a, b) => b.length - a.length);
const LATIN_RE = new RegExp(`(^|[^a-z])(${LATIN.map(escapeRe).join('|')})(?![a-z])`, 'gi'); // no lookbehind (Safari < 16.4)
const OTHER_RE = new RegExp(OTHER.map(escapeRe).join('|'), 'gi');

/** Replace listed words with ＊ (one per character). @param {string} s */
export function filterProfanity(s) {
  const star = (m) => '＊'.repeat([...m].length);
  return String(s).replace(OTHER_RE, star).replace(LATIN_RE, (m, pre, w) => pre + star(w));
}

/**
 * Clean a chat message: '' when nothing printable is left (the server refuses it).
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanChat(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.slice(0, CHAT_RAW_MAX).replace(/[\t\r\n]+/g, ' ').replace(CONTROL, '').replace(/\s+/gu, ' ').trim();
  const cps = [...s];
  if (cps.length > CHAT_MAX_LEN) s = cps.slice(0, CHAT_MAX_LEN).join('').trim();
  return filterProfanity(s);
}

/** Does this server relay room chat? @param {any} welcome the `welcome` message */
export function serverHasChat(welcome) {
  return !!welcome && Array.isArray(welcome.features) && welcome.features.includes(CHAT_FEATURE);
}

/** Sliding-window limiter state for one player: an array of send times. Returns true (and records) when allowed. */
export function chatAllowed(times, now, rate = CHAT_RATE) {
  while (times.length && now - times[0] >= rate.windowMs) times.shift();
  if (times.length >= rate.count) return false;
  times.push(now);
  return true;
}
