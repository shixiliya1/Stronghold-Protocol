# 卫戍协议 · Android app and web client (no game server needed)

`mobile/` builds the browser client into a static site (`scripts/build-www.mjs`), which is used two ways:

* **Android** (Capacitor 8, `android/`, appId `io.github.shixiliya1.stronghold`): every game file, including the full art, ships inside the APK, so rendering is local. The app is landscape and full screen, and the screen stays on.
* **GitHub Pages** PWA (`--target pages`): a service worker (`src/sw.js`) serves the game's root-relative URLs from under the base path and caches the app shell (network first) and the art (cache first, on demand).

At start you pick a server with the desktop picker (`electron/ui/chooser.*`, reused through `src/client/web-api.js`):

* **云服务器联机**: the Azure server (wss).
* **离线单人**: the real lobby, match and network code of `server/` runs inside the page. esbuild bundles it with Node shims (`src/offline-server.js`, `src/shims/`); the simulation is the page's own `/sim/`; the socket is in-memory (`src/client/offline-socket.js`).
* **自定义服务器**: any saved address. The web build only accepts `wss://`.

There is no local hosting. On Android the app checks the fork's Releases for a newer `Stronghold-Protocol-Android-*.apk` and offers to open the download page.

```
npm ci && (cd mobile && npm ci)
node mobile/scripts/build-www.mjs --target android --version 0.2.4-android.1   # → mobile/www
(cd mobile && npx cap sync android && cd android && ./gradlew assembleRelease)  # signing: SP_KEYSTORE* env, else debug key
node mobile/scripts/smoke.mjs --www mobile/www                                  # headless phone-sized offline solo smoke test
```

CI: `.github/workflows/android-release.yml` produces the signed APK from the `ANDROID_*` secrets and attaches it to the release. `.github/workflows/pages.yml` deploys the web client. `upstream-sync-build.yml` calls both after the Windows build.
