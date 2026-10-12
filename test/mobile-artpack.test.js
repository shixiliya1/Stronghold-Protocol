// The Android art download needs the ArtPack plugin reachable from the page: registered natively before the bridge
// starts, and @capacitor/core (registerPlugin) bundled for the page — the injected native bridge has no registerPlugin.
// The APK itself is checked by mobile/scripts/check-apk.mjs in the Android release workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = 'mobile/android/app/src/main/java/io/github/shixiliya1/stronghold/';

test('MainActivity registers ArtPackPlugin before super.onCreate', () => {
  const s = rd(J + 'MainActivity.java');
  const r = s.indexOf('registerPlugin(ArtPackPlugin.class)');
  assert.ok(r >= 0 && r < s.indexOf('super.onCreate('));
  assert.match(rd(J + 'ArtPackPlugin.java'), /@CapacitorPlugin\(name = "ArtPack"\)/);
  assert.match(rd(J + 'ArtWebViewClient.java'), /extends BridgeWebViewClient/);
});

test('the page gets @capacitor/core (cap-core.js) before art-ui.js', () => {
  const b = rd('mobile/scripts/build-www.mjs');
  assert.match(b, /entryPoints: \[path\.join\(MOBILE, 'src', 'cap-core\.js'\)\]/);
  assert.match(b, /<script src="cap-core\.js"><\/script>\\n<script src="art-ui\.js"><\/script>/);
  assert.match(rd('mobile/src/cap-core.js'), /registerPlugin\('ArtPack'\)/);
  assert.match(rd('mobile/src/client/art-ui.js'), /window\.SP_ARTPACK/);
  assert.match(rd('.github/workflows/android-release.yml'), /check-apk\.mjs "\$APK"/);
});
