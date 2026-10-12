# electron/ — Windows 桌面客户端（卫戍协议.exe）

双击 `卫戍协议.exe` 打开独立的游戏窗口：页面、美术、音频、战斗模拟全部从本机读取（`app://game/`，由主进程直接读文件，
页面本身**不经过本地 HTTP 端口**），对局同步通过 WebSocket 连接所选的游戏服务器。

## 选择服务器（启动时；之后 Ctrl+Shift+M 随时切换）

| 选项 | 说明 |
| --- | --- |
| 云服务器联机（默认） | `main.js` 的 `DEFAULT_SERVER`（wss）；卡片上显示在线状态、延迟和服务器版本 |
| 离线单人 | 在应用内启动自带的游戏服务器（`server-host.mjs`，Electron utilityProcess，不需要装 Node），只监听 127.0.0.1，不需要联网 |
| 本机开服 | 同一个服务器监听局域网（端口 3000，被占用时自动换）；弹窗显示朋友可用的地址（Ctrl+Shift+H 再看）。Windows 防火墙弹窗请允许「专用网络」 |
| 自定义服务器 | 保存多个服务器（名称可选 + 地址），可添加 / 编辑 / 删除；地址可写 `wss://域名/ws`、`ws://IP:端口/ws`、`http(s)://域名` 或 `IP:端口`，统一换成 `ws(s)://…/ws` |

- 连接前会检测服务器（`servers.js`：先 `GET /healthz`，读不到再做一次 WebSocket 握手，4 秒超时），显示「在线 · 延迟 · 版本」。
  服务器的联机协议版本（`PROTOCOL_VERSION`）或游戏版本（`APP_VERSION`）与本客户端不同时会提示，确认后才连接。
- 「记住选择」：下次启动直接进入上次的服务器；关闭窗口时自带服务器会一起停止。
- 设置保存在 `%APPDATA%\卫戍协议\desktop-mode.json`（`{ mode, remember, serverId, servers, skipVersion }`）。
- 命令行：`卫戍协议.exe --mode=cloud|offline|host`、`--server=wss://host/ws`（环境变量 `SP_MODE` / `SP_SERVER` 同理）。

## 自动更新（`updater.js`，启动 8 秒后静默检查；选择页「检查更新」或 Ctrl+Shift+U 手动检查）

发布页（GitHub Releases，`shixiliya1/Stronghold-Protocol`）每个版本有两种包，更新方式不同：

- **安装版** `Stronghold-Protocol-Desktop-Setup-<版本>.exe`（NSIS，可选安装目录）：用 `electron-updater`（GitHub provider）。
  它读发布里的 `latest.yml`，有新版本时弹窗「下载更新 / 以后再说 / 跳过这个版本」→ 下载（有 `.blockmap` 时只下载变化的部分，
  任务栏和标题显示进度）→「重启并安装」。
- **便携版** `Stronghold-Protocol-Desktop-<版本>-win-x64.zip`：便携文件夹无法安全地原地替换自己，所以只通过 GitHub API 找到更新的
  桌面版发布，下载新的 zip 到「下载」文件夹（显示进度）并打开所在文件夹；解压后用新文件夹即可（存档在用户目录，不受影响）。

版本号来自 tag（semver）：`v0.2.4-desktop.1` → 应用版本 `0.2.4-desktop.1`，`-desktop.2` 比 `-desktop.1` 新。
程序没有签名：Windows SmartScreen 提示时点「更多信息 → 仍要运行」。

## 文件

- `main.js`：窗口（无菜单栏、单实例、外部链接用系统浏览器打开）、`app://` 协议、服务器选择、自带服务器的启停、IPC。
- `protocol.js`：把 `app://game/…` 请求交给服务器自己的静态文件处理（`server/http/static.js`），路由与网页版完全一致。
- `servers.js` / `update-check.js`：地址规范化、连通性检测、版本比较、发布挑选（纯函数，测试见 `test/desktop-servers.test.js`）。
- `updater.js`：检查更新的两条路径与对话框。`server-host.mjs`：在 utilityProcess 里运行游戏服务器。
- `preload.cjs`：给选择页和游戏页的 `window.spDesktop`，以及游戏页右下角的模式标签。`ui/`：选择页。
- 游戏文件在打包后的 `resources/game/`（`public/`、`data/`、`shared/`、`server/`、`packs/`、`node_modules/`），开发时就是仓库根目录。

## 本地开发

先在仓库根目录 `npm install && npm run setup` 准备素材，然后：

```bash
cd electron
npm install
npm start                                                        # 打开窗口
npx electron-builder --win dir --x64 --publish never             # → dist/win-unpacked/
npx electron-builder --win nsis --x64 --publish never \
  -c.extraMetadata.version=0.2.4-desktop.1                       # 安装包 + .blockmap + latest.yml（Linux 上需要 wine）
```

发布：`.github/workflows/windows-client-release.yml`（Actions → Windows client release → Run workflow，填 tag）。
