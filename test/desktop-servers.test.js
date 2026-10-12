// The desktop client's server picker and updater helpers (electron/servers.js, electron/update-check.js; pure, no Electron).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, httpBase, normalizeSettings, probeServer, toWsUrl } from '../electron/servers.js';
import { compareSemver, newestDesktopRelease, parseSemver } from '../electron/update-check.js';

test('toWsUrl accepts wss/ws/http(s)/bare addresses and always targets /ws', () => {
  assert.equal(toWsUrl('wss://stronghold-xili.japaneast.cloudapp.azure.com/ws'), 'wss://stronghold-xili.japaneast.cloudapp.azure.com/ws');
  assert.equal(toWsUrl('https://stronghold-xili.japaneast.cloudapp.azure.com'), 'wss://stronghold-xili.japaneast.cloudapp.azure.com/ws');
  assert.equal(toWsUrl('https://example.com/some/page?x=1#y'), 'wss://example.com/ws');
  assert.equal(toWsUrl('http://192.168.1.23:3000'), 'ws://192.168.1.23:3000/ws');
  assert.equal(toWsUrl(' ws://192.168.1.23:3000/ws '), 'ws://192.168.1.23:3000/ws');
  assert.equal(toWsUrl('ws://192.168.1.23:3000'), 'ws://192.168.1.23:3000/ws');
  assert.equal(toWsUrl('192.168.1.23:3000'), 'ws://192.168.1.23:3000/ws');
  assert.equal(toWsUrl('http://[fe80::1]:3000'), 'ws://[fe80::1]:3000/ws');
  for (const bad of ['', '   ', 'ftp://h/x', 'javascript:alert(1)', 'file:///c:/x', 'http://user:pw@h/', 'http://']) assert.equal(toWsUrl(bad), null, bad);
});

test('httpBase maps the socket URL to the web root', () => {
  assert.equal(httpBase('wss://h.example/ws'), 'https://h.example/');
  assert.equal(httpBase('ws://10.0.0.2:3000/ws'), 'http://10.0.0.2:3000/');
});

test('compareVersions: protocol mismatch is an error, app mismatch a warning', () => {
  const local = { app: '0.2.4', protocol: 1 };
  assert.equal(compareVersions({ app: '0.2.4', protocol: 1 }, local).level, 'ok');
  assert.equal(compareVersions({ app: '0.2.3', protocol: 1 }, local).level, 'warn');
  assert.equal(compareVersions({ app: '0.2.4', protocol: 2 }, local).level, 'error');
  assert.equal(compareVersions({}, local).level, 'warn');
});

test('probeServer reads /healthz (latency + versions)', async () => {
  let t = 0;
  const fetch = async (url) => { assert.equal(url, 'https://h.example/healthz'); t += 42; return { ok: true, json: async () => ({ ok: true, version: 1, app: '0.2.3' }) }; };
  const r = await probeServer('https://h.example', { fetch, now: () => t, local: { app: '0.2.4', protocol: 1 } });
  assert.deepEqual([r.ok, r.via, r.latencyMs, r.app, r.protocol, r.check.level], [true, 'healthz', 42, '0.2.3', 1, 'warn']);
});

test('probeServer falls back to a ws handshake (welcome.version) and reports failures', async () => {
  const fetch = async () => { throw new Error('no http'); };
  class WS { constructor(u) { this.u = u; setTimeout(() => this.onopen(), 1); } send(m) { assert.equal(JSON.parse(m).t, 'hello'); setTimeout(() => this.onmessage({ data: JSON.stringify({ t: 'welcome', version: 2 }) }), 1); } close() {} }
  const r = await probeServer('ws://10.0.0.2:3000/ws', { fetch, WebSocket: WS, local: { app: '0.2.4', protocol: 1 } });
  assert.deepEqual([r.ok, r.via, r.protocol, r.check.level], [true, 'ws', 2, 'error']);
  class Dead { constructor() { setTimeout(() => this.onerror(), 1); } close() {} }
  assert.equal((await probeServer('ws://10.0.0.2:3000/ws', { fetch, WebSocket: Dead, local: { app: '0.2.4', protocol: 1 } })).ok, false);
  class Silent { close() {} }
  const slow = await probeServer('ws://10.0.0.2:3000/ws', { fetch, WebSocket: Silent, timeoutMs: 30, local: { app: '0.2.4', protocol: 1 } });
  assert.equal(slow.ok, false);
  assert.equal((await probeServer('nonsense://', { fetch, local: { app: '0.2.4', protocol: 1 } })).error, '地址无效');
});

test('normalizeSettings keeps valid servers, migrates the old single address, drops a dangling custom mode', () => {
  const s = normalizeSettings({ mode: 'custom', remember: 1, serverId: 'a', servers: [{ id: 'a', name: 'A', url: 'http://1.2.3.4:3000' }, { id: 'b', url: 'ftp://x' }] });
  assert.deepEqual(s, { mode: 'custom', remember: true, serverId: 'a', servers: [{ id: 'a', name: 'A', url: 'http://1.2.3.4:3000' }], skipVersion: '' });
  const legacy = normalizeSettings({ mode: 'custom', custom: 'ws://5.6.7.8:3000/ws' });
  assert.equal(legacy.servers[0].url, 'ws://5.6.7.8:3000/ws');
  assert.equal(legacy.serverId, 'legacy');
  assert.equal(normalizeSettings({ mode: 'custom' }).mode, null);
  assert.equal(normalizeSettings({ mode: 'bogus' }).mode, null);
  assert.equal(normalizeSettings(null).servers.length, 0);
});

test('semver: tags like v0.2.4-desktop.N compare correctly', () => {
  assert.deepEqual(parseSemver('v0.2.4-desktop.1'), { major: 0, minor: 2, patch: 4, pre: ['desktop', '1'] });
  assert.equal(parseSemver('latest'), null);
  assert.ok(compareSemver('0.2.4-desktop.2', '0.2.4-desktop.1') > 0);
  assert.ok(compareSemver('0.2.4-desktop.10', '0.2.4-desktop.9') > 0);
  assert.ok(compareSemver('0.2.4', '0.2.4-desktop.9') > 0);
  assert.ok(compareSemver('0.2.5-desktop.1', '0.2.4') > 0);
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
});

test('newestDesktopRelease picks the newest published desktop build above the current version', () => {
  const rel = (tag, names, extra = {}) => ({ tag_name: tag, html_url: `https://x/${tag}`, body: 'notes', assets: names.map((name) => ({ name, browser_download_url: `https://x/${name}`, size: 1 })), ...extra });
  const list = [
    rel('v0.2.4-desktop.3', ['Stronghold-Protocol-Desktop-0.2.4-desktop.3-win-x64.zip'], { draft: true }),
    rel('v0.2.4-desktop.2', ['Stronghold-Protocol-Desktop-0.2.4-desktop.2-win-x64.zip', 'Stronghold-Protocol-Desktop-Setup-0.2.4-desktop.2.exe']),
    rel('v0.2.4-cloud.1', ['Stronghold-Protocol-Windows-client-v0.2.4-cloud.1.zip']),
    rel('nightly', ['Stronghold-Protocol-Desktop-x-win-x64.zip']),
    rel('v0.2.4-desktop.1', ['Stronghold-Protocol-Desktop-0.2.4-desktop.1-win-x64.zip']),
  ];
  const best = newestDesktopRelease(list, '0.2.4-desktop.1');
  assert.equal(best.version, '0.2.4-desktop.2');
  assert.ok(best.zip && best.setup);
  assert.equal(newestDesktopRelease(list, '0.2.4-desktop.2'), null);
  assert.equal(newestDesktopRelease(list, '0.2.4-desktop.1', '0.2.4-desktop.2'), null); // skipped
  assert.equal(newestDesktopRelease([], '0.2.4-desktop.0'), null);
  assert.equal(newestDesktopRelease({ message: 'rate limited' }, '0.2.4-desktop.0'), null);
});
