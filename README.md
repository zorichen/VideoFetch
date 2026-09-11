# VideoFetch

“VideoFetch”由 Chrome 扩展和 macOS 本地助手组成，用于保存用户拥有保存权限、且不含 DRM 或加密保护的媒体。

**仅限个人学术研究，禁止商业使用。** 本项目采用[个人学术研究专用许可](LICENSE)，属于源码可见项目。第三方组件仍遵循各自许可证。

## 组成

- `VideoCaptureExtension/`：Chrome Manifest V3 扩展，复制正常播放已经返回的非加密媒体响应。
- `VideoDownloadAssistant/`：SwiftUI macOS 助手，将捕获的 TS 搬运、无损封装为 MP4 并验证完整性。
- `outputs/`：Chrome 扩展 1.3.0、macOS 助手 0.10.0 及安装说明。

## 下载与安装

请查看 [`outputs/安装说明.md`](outputs/安装说明.md)。

当前 macOS 应用支持 macOS 13+、Apple Silicon（M1/M2/M3/M4）。应用采用本地临时签名，未经过 Apple Developer ID 公证。

## 构建

```bash
cd VideoDownloadAssistant
chmod +x build.sh
./build.sh
```

Chrome 扩展无需编译，在 `chrome://extensions/` 中打开开发者模式并加载 `VideoCaptureExtension/` 即可。
生成包含许可文件的扩展 ZIP：`python3 scripts/package-extension.py`（需要 Python 3）。

## 配置域名和目录

1. 在扩展弹窗点击“域名与目录设置”。分别填写允许开始捕获的页面域名和媒体 / CDN 域名，每行一个。页面域名自动纳入媒体来源。
2. 域名默认使用 HTTPS，也可填写完整 HTTP(S) 来源（如 `http://localhost:8080`）。按协议、域名和端口精确匹配，子域名须单独添加，不支持通配符。默认保留人人讲页面、API 和两个媒体域名；未配置的页面不能开始捕获。
3. 点击“授权域名并保存”，按 Chrome 提示授予所列域名权限。配置从下一次捕获生效。增加域名不代表网站一定兼容，内容仍须是受支持的非加密媒体。
4. Chrome 输出子目录默认为 `outputs`，可改为 `research/videos` 等相对路径；主下载目录在 Chrome 设置中调整。
5. macOS 助手中点击“选择 Chrome 输入目录”，选中 Chrome 主下载目录内对应的输出子目录，再点击“选择输出目录”设置最终 MP4 目录。目录会自动记住，重启后继续使用。

默认输入目录为 `~/Downloads/outputs`，最终目录为 `~/projects/renrenjiang/outputs`，保留旧版习惯。两个目录不能相同或互相包含；转换期间不能修改目录。修改目录不会迁移旧文件，可将待处理文件手动移入新输入目录。直接 MP4 导出保留在 Chrome 输出子目录中，macOS 助手只搬运及转换 TS。

## 验证

扩展回归检查（需要 Node.js）：`node --test tests/extension.test.cjs`。
macOS 目录配置检查：`zsh tests/test-directories.sh`。
macOS 构建通过 `xcrun` 自动选择已安装的 SDK，需 Xcode Command Line Tools。

## 安全边界

- 不安装 HTTPS 根证书，不读取 Cookie 值；少量补片请求可能携带该站点现有登录凭据。
- 检测到 HLS `EXT-X-KEY` 或 Widevine、FairPlay、PlayReady DRM 时停止。
- 仅允许已明确配置和授权的域名。
- 仅用于你拥有保存权限的内容。

升级改名保留 macOS bundle ID `local.codex.VideoDownloadAssistant`。Chrome 解压扩展应覆盖原加载目录后重新加载，保持扩展 ID 与已保存的域名和目录设置；不要另建路径重复加载。
