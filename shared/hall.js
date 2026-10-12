// shared/hall.js — 联机大厅 (Alliance Matchmaking lobby panel) shared between the server (server/lobby.js) and the client
// (public/js/ui/hall.js). (i18n-ignore-file: no player-facing text here.)
//
// Capability: a server that supports it lists HALL_FEATURE in welcome.features; clients show the panel / the 在线 badge
// only then (an older server never sees the lobby.* messages; an older client never subscribes, so it gets none).
//
//   C2S lobby.sub { on, list }      subscribe to lobby.stats (and, list = true, lobby.rooms); on = false unsubscribes
//   C2S lobby.quick { size, difficulty }   最快匹配: join the best open public co-op room of that size preference
//                                   (0 = 不限人数), else create one (public, that size) — answers like room.join
//   C2S room.setPublic { on }       host, before the match: list the co-op room in the 联机大厅 (strangers may join)
//   S2C lobby.stats { online, rooms, inMatch, joinable }   throttled (at most every HALL_TICK_MS, only on change)
//   S2C lobby.rooms { rooms: [{ code, host, humans, size, difficulty }] }   the joinable public rooms (≤ HALL_LIST_MAX)
import { MAX_SEATS } from './constants.js';

export const HALL_FEATURE = 'lobby';
export const HALL_TICK_MS = 2000;
export const HALL_LIST_MAX = 50;
/** Room-size preferences: 0 = any, else a co-op room of exactly that many players (2 … MAX_SEATS). */
export const HALL_SIZES = Object.freeze([0, ...Array.from({ length: MAX_SEATS - 1 }, (_, i) => i + 2)]);

/** @param {any} welcome */
export function serverHasHall(welcome) {
  return !!welcome && Array.isArray(welcome.features) && welcome.features.includes(HALL_FEATURE);
}

/**
 * Best room for 最快匹配 among `rooms` ({ code, humans, size, createdAt }, already joinable): the fullest first (a match
 * starts soonest), then the oldest. size 0 = any size.
 * @template {{ humans: number, size: number, createdAt?: number }} R
 * @param {R[]} rooms @param {number} size @returns {R | null}
 */
export function pickRoom(rooms, size) {
  const ok = rooms.filter((r) => r.humans < r.size && (!size || r.size === size));
  ok.sort((a, b) => (b.humans - a.humans) || ((a.createdAt || 0) - (b.createdAt || 0)));
  return ok[0] || null;
}
