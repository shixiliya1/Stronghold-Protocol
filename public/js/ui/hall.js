// 联机大厅 (shared/hall.js) — the lobby screen's Alliance Matchmaking panel and the 在线 N badge: room stats
// (总房间 / 进行中 / 可加入), 房间列表 (the joinable public co-op rooms, each with 加入), 房间偏好 (不限人数 / 2人 / … /
// MAX_SEATS人) and 最快匹配 (lobby.quick: the best open room of that preference, else a new public one).
// Shown only when the server supports it (welcome.features 'lobby' → store.features.lobby); the subscription
// (lobby.sub) is sent while the lobby screen is open and again after every reconnect.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { HALL_SIZES } from '../../../shared/hall.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, Panel } from './components.js';
import { net } from '../net.js';
import { useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { toastError } from './toasts.js';
import { t } from '../../../shared/i18n.js';

export const HALL_CSS_HREF = '/css/hall.css';
function ensureHallCss(doc = globalThis.document) {
  if (!doc?.head || doc.querySelector(`link[rel="stylesheet"][href$="${HALL_CSS_HREF}"]`)) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = HALL_CSS_HREF;
  doc.head.appendChild(link);
}

/** Label of a size preference. */
export const sizeLabel = (n) => (n ? t('{n}人', { n }) : t('不限人数'));

/** Subscribe while mounted (and online); `list` also asks for lobby.rooms. */
function useHallSub(list) {
  const enabled = useStore((s) => !!s.features?.lobby);
  const online = useStore((s) => s.connection.status === 'online');
  const me = useStore((s) => s.me.playerId);
  useEffect(() => {
    if (!enabled || !online) return undefined;
    net.send('lobby.sub', { on: true, list: !!list });
    return () => { try { net.send('lobby.sub', { on: false }); } catch { /* offline */ } };
  }, [enabled, online, me, list]);
  return enabled;
}

/** 在线 N — the players connected to this server. */
export function OnlineBadge() {
  const enabled = useStore((s) => !!s.features?.lobby);
  const online = useStore((s) => s.hall?.stats?.online ?? null);
  if (!enabled || online == null) return null;
  return html`<span class="online-badge" title=${t('当前连接到本服务器的玩家')}><i class="online-badge__dot" aria-hidden="true"></i>${t('在线 {n}', { n: online })}</span>`;
}

/** The 联机大厅 panel. @param {{ difficulty: string, disabled?: boolean }} props */
export function HallPanel({ difficulty, disabled = false }) {
  ensureHallCss();
  const [showList, setShowList] = useState(false);
  const enabled = useHallSub(showList);
  const stats = useStore((s) => s.hall?.stats || null, shallowEqual);
  const rooms = useStore((s) => s.hall?.rooms || null);
  const [pref, setPref] = useState(() => { const v = Number(loadPref('hall.size', 0)); return HALL_SIZES.includes(v) ? v : 0; });
  const [busy, setBusy] = useState(null);
  if (!enabled) return null;
  const go = async (kind, fn) => {
    if (busy) return;
    setBusy(kind);
    try { await fn(); } catch (e) { toastError(e); } finally { setBusy(null); }
  };
  const quick = () => go('quick', () => net.request('lobby.quick', { size: pref, difficulty }));
  const join = (code) => go(code, () => net.request('room.join', { code }));
  const list = (rooms || []).filter((r) => !pref || r.size === pref);
  return html`<${Panel} class="hall-panel" tone="mint">
    <div class="hall-head">
      <span class="hall-title"><${Icon} name="users" />${t('联机大厅')}<${MicroLabel}>ALLIANCE MATCHMAKING<//></span>
      <${OnlineBadge} />
    </div>
    <div class="hall-stats">
      <span><b class="num">${stats ? stats.rooms : '–'}</b>${t('总房间')}</span>
      <span><b class="num">${stats ? stats.inMatch : '–'}</b>${t('进行中')}</span>
      <span class="is-open"><b class="num">${stats ? stats.joinable : '–'}</b>${t('可加入')}</span>
    </div>
    <div class="hall-row">
      <label class="hall-pref">${t('房间偏好')}
        <select value=${String(pref)} onChange=${(e) => { const v = Number(e.currentTarget.value); setPref(v); savePref('hall.size', v); }}>
          ${HALL_SIZES.map((n) => html`<option key=${n} value=${String(n)}>${sizeLabel(n)}</option>`)}
        </select>
      </label>
      <${Button} variant="secondary" size="md" icon="search" class="hall-list-btn" onClick=${() => setShowList(!showList)}>${showList ? t('收起列表') : t('房间列表')}<//>
      <${Button} variant="primary" size="md" iconRight="chevrons" class="hall-quick" loading=${busy === 'quick'} disabled=${disabled} onClick=${quick}>${t('最快匹配')}<//>
    </div>
    ${showList ? html`<ul class="hall-list">
      ${rooms == null ? html`<li class="hall-empty">${t('正在获取…')}</li>`
        : !list.length ? html`<li class="hall-empty">${t('暂时没有可加入的房间，点「最快匹配」创建一个')}</li>`
        : list.map((r) => html`<li key=${r.code} class="hall-room">
          <span class="hall-room__who"><b>${r.host || t('博士')}</b><small class="num">${r.code}</small></span>
          <span class="hall-room__diff">${t(DIFFICULTY_NAMES[r.difficulty] || r.difficulty)}</span>
          <span class="hall-room__n num">${r.humans}/${r.size}</span>
          <${Button} variant="amber" size="sm" loading=${busy === r.code} disabled=${disabled} onClick=${() => join(r.code)}>${t('加入')}<//>
        </li>`)}
    </ul>` : null}
  <//>`;
}
