#!/usr/bin/env node
// mobile/scripts/check-apk.mjs <apk|www-dir> — fails unless the ArtPack native plugin is reachable from the page:
//   • APK: classes*.dex has io.github.shixiliya1.stronghold.ArtPackPlugin (@CapacitorPlugin), assets/native-bridge.js;
//   • MainActivity registers it (registerPlugin(ArtPackPlugin.class) before super.onCreate);
//   • client/index.html loads cap-core.js (the @capacitor/core bundle) before art-ui.js;
//   • behaviour: the APK's own native-bridge.js + cap-core.js in a VM with a fake androidBridge — window.SP_ARTPACK
//     exists and ArtPack.status() posts a native call { pluginId: 'ArtPack', methodName: 'status' }.
// (Capacitor ≥3: the injected native bridge has no registerPlugin; without @capacitor/core art-ui.js shows
//  「缺少原生下载组件」.)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
if (!target) { console.error('usage: check-apk.mjs <apk|www-dir>'); process.exit(2); }
const errors = [];
const fail = (m) => errors.push(m);
const isApk = fs.statSync(target).isFile();
const zipList = isApk ? execFileSync('unzip', ['-Z1', target], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n') : [];
const read = (rel) => {
  if (!isApk) { const f = path.join(target, rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; }
  const name = 'assets/public/' + rel;
  if (!zipList.includes(name) && !zipList.includes(rel)) return null;
  return execFileSync('unzip', ['-p', target, zipList.includes(name) ? name : rel], { maxBuffer: 256 << 20 });
};

if (isApk) {
  const dex = zipList.filter((n) => /^classes\d*\.dex$/.test(n)).map((n) => execFileSync('unzip', ['-p', target, n], { maxBuffer: 256 << 20 }).toString('latin1')).join('\n');
  if (!dex.includes('Lio/github/shixiliya1/stronghold/ArtPackPlugin;')) fail('classes.dex: ArtPackPlugin missing (stripped?)');
  if (!dex.includes('Lcom/getcapacitor/annotation/CapacitorPlugin;')) fail('classes.dex: @CapacitorPlugin annotation missing');
  if (!dex.includes('Lio/github/shixiliya1/stronghold/ArtWebViewClient;')) fail('classes.dex: ArtWebViewClient missing');
  if (!zipList.includes('assets/native-bridge.js')) fail('assets/native-bridge.js missing');
}
const main = fs.readFileSync(path.join(MOBILE, 'android/app/src/main/java/io/github/shixiliya1/stronghold/MainActivity.java'), 'utf8');
const reg = main.indexOf('registerPlugin(ArtPackPlugin.class)'), sup = main.indexOf('super.onCreate(');
if (reg < 0 || sup < 0 || reg > sup) fail('MainActivity: registerPlugin(ArtPackPlugin.class) must come before super.onCreate');
if (!/@CapacitorPlugin\(name = "ArtPack"\)/.test(fs.readFileSync(path.join(MOBILE, 'android/app/src/main/java/io/github/shixiliya1/stronghold/ArtPackPlugin.java'), 'utf8'))) fail('ArtPackPlugin: @CapacitorPlugin(name = "ArtPack") missing');

const html = read('client/index.html')?.toString() || '';
const iCore = html.indexOf('src="cap-core.js"'), iUi = html.indexOf('src="art-ui.js"');
if (iCore < 0 || iUi < 0 || iCore > iUi) fail('client/index.html: cap-core.js must load before art-ui.js');
const core = read('client/cap-core.js');
if (!core) fail('client/cap-core.js missing');

const bridge = isApk ? execFileSync('unzip', ['-p', target, 'assets/native-bridge.js']).toString()
  : fs.readFileSync(path.join(MOBILE, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js'), 'utf8');
if (core) {
  const posted = [];
  const win = {
    androidBridge: { postMessage: (s) => posted.push(JSON.parse(s)) },
    location: { protocol: 'https:', host: 'localhost', href: 'https://localhost/client/index.html', origin: 'https://localhost' },
    navigator: { userAgent: 'Android' }, console: { log() {}, warn() {}, error() {}, info() {}, debug() {}, group() {}, groupCollapsed() {}, groupEnd() {} },
    document: { addEventListener() {}, cookie: '' }, addEventListener() {}, Document: class {}, HTMLDocument: class {}, XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} }, ProgressEvent: class {}, fetch: async () => ({}), Request: class {}, Headers: class {}, Response: class {}, setTimeout, clearTimeout, Promise, URL, JSON, Error,
  };
  win.window = win; win.self = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  try {
    vm.runInContext(bridge, ctx, { filename: 'native-bridge.js' });
    // what Capacitor's JSInjector adds natively for every registered plugin (Bridge → PluginHeaders)
    win.Capacitor.PluginHeaders = [{ name: 'ArtPack', methods: ['status', 'start', 'addListener', 'removeListener'].map((name) => ({ name, rtype: 'promise' })) }];
    vm.runInContext(core.toString(), ctx, { filename: 'cap-core.js' });
  } catch (e) { fail('VM: ' + e.message); }
  const p = win.SP_ARTPACK;
  if (!p) fail('VM: window.SP_ARTPACK not set (Capacitor.isNativePlatform() false or registerPlugin missing)');
  else {
    try { p.status().catch((e) => fail('VM: ArtPack.status() rejected: ' + e.message)); } catch (e) { fail('VM: ArtPack.status() threw ' + e.message); }
    await new Promise((r) => setTimeout(r, 50));
    if (!posted.some((m) => m.pluginId === 'ArtPack' && m.methodName === 'status')) fail('VM: ArtPack.status() did not reach the native bridge (' + JSON.stringify(posted.slice(0, 3)) + ')');
  }
}
if (errors.length) { for (const e of errors) console.error('::error::' + e); process.exit(1); }
console.log('ArtPack plugin check OK (' + target + ')');
