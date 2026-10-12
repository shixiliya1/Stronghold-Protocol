# electron/ — Windows 桌面客户端（卫戍协议.exe）

双击 `卫戍协议.exe` 打开独立的游戏窗口：页面、美术、音频、战斗模拟全部从本机读取（`app://game/`，由主进程直接读文件，
**不开本地 HTTP 端口**），只有对局同步通过 WebSocket 连接游戏服务器（默认见 `main.js` 的 `DEFAULT_SERVER`）。

- `main.js`：窗口（无菜单栏、单实例、外部链接用系统浏览器打开）、`app://` 协议、默认服务器；
  `卫戍协议.exe --server=wss://host/ws` 可临时换服务器。
- `protocol.js`：把 `app://game/…` 请求交给服务器自己的静态文件处理（`server/http/static.js`），路由与网页版完全一致。
- 游戏文件在打包后的 `resources/game/`（`public/`、`data/`、`shared/`、`server/`、`packs/`），开发时就是仓库根目录。

本地开发（需要先在仓库根目录 `npm install && npm run setup` 准备素材）：

```bash
cd electron
npm install
npm start                                            # 打开窗口
npx electron-builder --win dir --x64 --publish never # 在 Linux / macOS 上也能打 Windows 包 → dist/win-unpacked/
```

发布：`.github/workflows/windows-client-release.yml`（Actions → Windows client release → Run workflow）。
