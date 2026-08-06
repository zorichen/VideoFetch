# 视频下载助手

“视频下载助手”由 Chrome 扩展和 macOS 本地助手组成，用于保存用户拥有保存权限、且不含 DRM 或加密保护的媒体。

## 组成

- `VideoCaptureExtension/`：Chrome Manifest V3 扩展，复制正常播放已经返回的非加密媒体响应。
- `VideoDownloadAssistant/`：SwiftUI macOS 助手，将捕获的 TS 搬运、无损封装为 MP4 并验证完整性。
- `outputs/`：已验证的跨电脑交付包和安装说明。

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

## 安全边界

- 不安装 HTTPS 根证书，不读取 Cookie，不拦截任意网站流量。
- 检测到 HLS `EXT-X-KEY` 或 Widevine、FairPlay、PlayReady DRM 时停止。
- 仅允许已明确配置和授权的域名。
- 仅用于你拥有保存权限的内容。
