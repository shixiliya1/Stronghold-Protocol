// public/js/render/app/pixi.js — load PIXI and pixi-spine once (one module-level promise).

import { installPixiNoEval } from './pixiNoEval.js';

const VENDOR = { pixi: '/vendor/pixi.min.js', spine: '/vendor/pixi-spine.js' };

let pixiPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * PIXI's path utils only treat http(s): as URLs, so on any other scheme (the desktop client's app://game/) a root-relative
 * asset path resolves against the bare scheme (`/assets/x.skel` → `app://assets/x.skel`). Give the resolver the page's
 * origin as its root there; http(s) pages keep PIXI's own resolution.
 * @param {any} PIXI
 * @param {{ protocol?: string, origin?: string }} [loc]
 */
export function fixRootPath(PIXI, loc) {
  if (!loc || /^https?:$/.test(loc.protocol || '') || !loc.origin || loc.origin === 'null') return;
  const resolver = PIXI && PIXI.Assets && PIXI.Assets.resolver;
  if (resolver && !resolver.rootPath) resolver.rootPath = `${loc.origin}/`;
}

/** Make sure PIXI and PIXI.spine exist (classic scripts; loaded once). */
export function ensurePixi() {
  if (globalThis.PIXI && globalThis.PIXI.spine) { installPixiNoEval(globalThis.PIXI); return Promise.resolve(globalThis.PIXI); }
  if (!pixiPromise) {
    pixiPromise = (async () => {
      if (!globalThis.PIXI) await loadScript(VENDOR.pixi);
      installPixiNoEval(globalThis.PIXI);
      if (!globalThis.PIXI?.spine) await loadScript(VENDOR.spine);
      if (!globalThis.PIXI || !globalThis.PIXI.spine) throw new Error('PIXI / pixi-spine unavailable');
      fixRootPath(globalThis.PIXI, globalThis.location);
      return globalThis.PIXI;
    })();
    pixiPromise.catch(() => { pixiPromise = null; });
  }
  return pixiPromise;
}
