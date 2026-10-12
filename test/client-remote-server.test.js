// The client package's remote game server: `?server=` (public/js/net.js) and `--cloud` (scripts/make-windows-bundle.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWsUrl, remoteServerUrl, K_SERVER } from '../public/js/net.js';
import { cloudServerUrl, cloudBat, cloudReadme } from '../scripts/make-windows-bundle.mjs';

function withStorage(fn) {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const m = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) } });
  try { return fn(m); } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev); else delete globalThis.localStorage;
  }
}
const page = (search = '') => ({ protocol: 'http:', host: 'localhost:3000', search });

test('?server= picks a remote wss server, remembers it, ?server=local forgets it', () => withStorage((m) => {
  assert.equal(defaultWsUrl(page()), 'ws://localhost:3000/ws');
  assert.equal(defaultWsUrl(page('?server=wss://example.com')), 'wss://example.com/ws');
  assert.equal(m.get(K_SERVER), 'wss://example.com/ws');
  assert.equal(defaultWsUrl(page()), 'wss://example.com/ws');
  assert.equal(defaultWsUrl(page('?server=local')), 'ws://localhost:3000/ws');
  assert.equal(m.has(K_SERVER), false);
}));

test('?server= refuses anything that is not ws: / wss:', () => withStorage(() => {
  assert.equal(remoteServerUrl(page('?server=javascript:alert(1)')), null);
  assert.equal(remoteServerUrl(page('?server=https://example.com')), null);
  assert.equal(defaultWsUrl(page('?server=nonsense')), 'ws://localhost:3000/ws');
}));

test('--cloud: URL normalisation, the .bat and the README section', () => {
  assert.equal(cloudServerUrl('wss://example.com'), 'wss://example.com/ws');
  assert.equal(cloudServerUrl('wss://example.com/ws'), 'wss://example.com/ws');
  assert.equal(cloudServerUrl('https://example.com'), null);
  const b = cloudBat('wss://example.com/ws');
  assert.match(b, /launch\.mjs" --no-setup --host 127\.0\.0\.1 --server wss:\/\/example\.com\/ws %\*\r\n/);
  assert.ok(/^[\x00-\x7f]*$/.test(b), 'the .bat stays ASCII');
  assert.match(cloudReadme('wss://example.com/ws'), /联机-云服务器\.bat/);
});

test('invite link: the remote server\'s web page when playing on one', async () => withStorage(async () => {
  const { inviteLink } = await import('../public/js/screens/room.js');
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const set = (v) => Object.defineProperty(globalThis, 'location', { configurable: true, value: v });
  try {
    set({ protocol: 'app:', host: 'game', origin: 'app://game', pathname: '/', search: '?server=wss%3A%2F%2Fexample.com%2Fws' });
    assert.equal(inviteLink('ABCD'), 'https://example.com/?room=ABCD');
    set({ protocol: 'http:', host: 'localhost:3000', origin: 'http://localhost:3000', pathname: '/', search: '?server=local' });
    assert.equal(inviteLink('ABCD'), 'http://localhost:3000/?room=ABCD');
  } finally {
    if (prev) Object.defineProperty(globalThis, 'location', prev); else delete globalThis.location;
  }
}));

test('PIXI root path: set on non-http(s) pages only', async () => {
  const { fixRootPath } = await import('../public/js/render/app/pixi.js');
  const P = () => ({ Assets: { resolver: { rootPath: '' } } });
  const a = P(); fixRootPath(a, { protocol: 'app:', origin: 'app://game' });
  assert.equal(a.Assets.resolver.rootPath, 'app://game/');
  const b = P(); fixRootPath(b, { protocol: 'https:', origin: 'https://example.com' });
  assert.equal(b.Assets.resolver.rootPath, '');
});
