// mobile/src/cap-core.js — bundled to client/cap-core.js (IIFE). The native bridge Capacitor injects (native-bridge.js)
// carries only the transport; Capacitor.registerPlugin and the plugin proxies live in @capacitor/core, which a page
// without a bundler never loads. Importing it here completes window.Capacitor, and the ArtPack proxy is exposed for
// client/art-ui.js (the native side: ArtPackPlugin, registered in MainActivity).
import { Capacitor, registerPlugin } from '@capacitor/core';

window.Capacitor = Capacitor;
if (Capacitor.isNativePlatform()) window.SP_ARTPACK = registerPlugin('ArtPack');
