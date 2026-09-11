# VideoFetch

macOS 助手 0.10.0。**仅限个人学术研究，禁止商业使用。** 详见 [LICENSE](../LICENSE)。

原生 macOS 本地转换助手。它不会安装 HTTPS 根证书，也不会拦截浏览器流量。

应用包含统一的蓝紫色视频下载图标。

## 当前功能

- 监控 Chrome 实际下载位置 `~/Downloads/outputs/`，写入稳定后自动搬到 `~/projects/renrenjiang/outputs/<课程名称>/`。
- 上述为默认目录；可在界面分别选择 Chrome 输入目录和最终 MP4 输出目录，自动保存并在重启后恢复。
- 输入、输出目录不能相同或互相包含；转换期间暂不能修改。切换不会搬迁旧目录文件。
- 同时递归监控最终课程目录并转换遗留 TS。
- 读取扩展生成的 `.capture.json`，核对 TS 字节数和预计时长；分片数由扩展导出时检查。
- MP4 时长与预计时长误差超过 1 秒时标记失败。
- 转换后完整解码扫描音视频流，出现解码错误时标记失败。
- 验证成功后自动删除 `.capture.json`；验证失败时保留用于诊断。
- TS 文件写入稳定后，自动无损封装为同名 MP4。
- 内置 arm64 ffmpeg，不需要额外安装。
- 默认保留原始 TS，可在界面关闭。
- 显示最近转换结果并可直接打开目录。

## 构建

```bash
chmod +x build.sh
./build.sh
```

构建结果位于 `build/VideoFetch.app` 和 `build/VideoFetch-0.9.zip`。SDK 由 `xcrun` 自动定位；需要 Xcode Command Line Tools。

## 限制

- 当前构建仅适用于 Apple Silicon Mac。
- 转换助手只处理本地 TS，不发起网络请求。
