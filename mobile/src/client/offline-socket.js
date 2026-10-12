// In-memory WebSocket pair for 离线单人 (classic script, loaded by boot.js before the game modules): the page's socket
// to the offline URL talks to the in-page server of client/offline-server.js (loaded as a module, see boot.js).
(function () {
'use strict';
/** A ws-library-shaped server end (EventEmitter subset) wired to a browser-WebSocket-shaped client end. */
class ServerEnd {
  constructor(client) { this.client = client; this.readyState = 1; this.bufferedAmount = 0; this.h = {}; }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this.h[ev] || []) fn(...a); }
  send(data, cb) { if (this.readyState !== 1) return; queueMicrotask(() => this.client._recv(data)); cb && queueMicrotask(() => cb()); }
  ping() { queueMicrotask(() => this.emit('pong')); }
  close(code = 1000, reason = '') { if (this.readyState > 1) return; this.readyState = 2; queueMicrotask(() => { this.readyState = 3; this.emit('close', code, reason); this.client._closed(code, reason); }); }
  terminate() { this.close(1006, ''); }
}

/** Browser WebSocket stand-in for OFFLINE_WS_URL. */
class OfflineSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url, baseUrl) {
    super();
    this.url = url; this.readyState = 0; this.protocol = ''; this.extensions = ''; this.bufferedAmount = 0; this.binaryType = 'blob';
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.server = new ServerEnd(this);
    window.__spOffline.then((m) => m.startOfflineServer(baseUrl)).then(({ network }) => {
      if (this.readyState !== 0) return;
      network.handleConnection(this.server, { headers: {}, socket: { remoteAddress: '127.0.0.1' } });
      this.readyState = 1;
      this._fire('open', new Event('open'));
    }, (e) => { console.error('[offline] server failed', e); this._fire('error', new Event('error')); this._closed(1011, 'offline server failed'); });
  }
  _fire(type, ev) { const f = this['on' + type]; if (typeof f === 'function') f.call(this, ev); this.dispatchEvent(ev); }
  _recv(data) { if (this.readyState === 1) this._fire('message', new MessageEvent('message', { data })); }
  _closed(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._fire('close', new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
  }
  send(data) {
    if (this.readyState !== 1) return;
    const s = typeof data === 'string' ? data : String(data);
    queueMicrotask(() => { if (this.server.readyState === 1) this.server.emit('message', s, false); });
  }
  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    queueMicrotask(() => { this.server.readyState = 3; this.server.emit('close', code, reason); this._closed(code, reason); });
  }
}

window.SPOffline = { OfflineSocket };
})();
