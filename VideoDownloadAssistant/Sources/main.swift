import SwiftUI
import AppKit

@main
struct VideoDownloadAssistantApp: App {
    var body: some Scene {
        WindowGroup("视频下载助手") {
            MonitorView()
                .frame(minWidth: 720, minHeight: 460)
        }
        .windowResizability(.contentMinSize)
    }
}

struct ConversionRecord: Identifiable {
    let id = UUID()
    let name: String
    let date: Date
    let succeeded: Bool
}

struct CaptureMetadata: Decodable {
    let schemaVersion: Int
    let title: String
    let courseName: String
    let expectedSegments: Int
    let capturedSegments: Int
    let supplementedSegments: Int
    let expectedDuration: Double
    let totalBytes: Int64
}

struct ValidationResult {
    let succeeded: Bool
    let message: String
}

@MainActor
final class MonitorModel: ObservableObject {
    @Published var isMonitoring = true
    @Published var status = "正在监控下载目录……"
    @Published var records: [ConversionRecord] = []
    @Published var keepTS = true

    @Published private(set) var incomingDirectory: URL
    @Published private(set) var downloadDirectory: URL
    private var timer: Timer?
    private var previousSizes: [URL: Int64] = [:]
    @Published private var processing: Set<URL> = []
    var canChangeDirectories: Bool { processing.isEmpty }

    init() {
        let defaultInput = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("outputs", isDirectory: true)
        let defaultOutput = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("projects/renrenjiang/outputs", isDirectory: true)
        incomingDirectory = DirectorySettings.load(DirectorySettings.inputKey, fallback: defaultInput)
        downloadDirectory = DirectorySettings.load(DirectorySettings.outputKey, fallback: defaultOutput)
        do {
            try DirectorySettings.save(input: incomingDirectory, output: downloadDirectory)
            startMonitoring()
        } catch {
            isMonitoring = false
            status = "请重新选择目录：\(error.localizedDescription)"
        }
    }

    func chooseDirectory(input: Bool) {
        guard canChangeDirectories else { return }
        let wasMonitoring = isMonitoring
        stopMonitoring()
        let panel = NSOpenPanel()
        panel.title = input ? "选择 Chrome 输入目录（下载目录内的输出子目录）" : "选择最终 MP4 输出目录"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = input ? incomingDirectory : downloadDirectory
        guard panel.runModal() == .OK, let selected = panel.url else {
            if wasMonitoring { startMonitoring() }
            return
        }
        let newInput = input ? selected : incomingDirectory
        let newOutput = input ? downloadDirectory : selected
        do {
            try DirectorySettings.save(input: newInput, output: newOutput)
            incomingDirectory = newInput.standardizedFileURL
            downloadDirectory = newOutput.standardizedFileURL
            previousSizes.removeAll()
            if wasMonitoring { startMonitoring() }
            else { status = "目录已保存；开始监控后生效。原目录中的文件保持原位。" }
        } catch {
            // Keep monitoring paused so the error remains visible and the user can correct it.
            status = "目录未更改：\(error.localizedDescription)"
        }
    }

    func startMonitoring() {
        do {
            try DirectorySettings.save(input: incomingDirectory, output: downloadDirectory)
        } catch {
            isMonitoring = false
            status = "无法开始监控：\(error.localizedDescription)"
            return
        }
        isMonitoring = true
        status = "正在监控 Chrome 下载并归档到：\(downloadDirectory.path)"
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.scan() }
        }
        scan()
    }

    func stopMonitoring() {
        isMonitoring = false
        timer?.invalidate()
        timer = nil
        status = "监控已暂停。"
    }

    func openFolder() {
        NSWorkspace.shared.open(downloadDirectory)
    }

    private func scan() {
        guard isMonitoring else { return }
        let keys: [URLResourceKey] = [.fileSizeKey, .isRegularFileKey]
        let incoming = tsFiles(in: incomingDirectory).map { ($0, true) }
        let archived = tsFiles(in: downloadDirectory).map { ($0, false) }
        for (file, needsMove) in incoming + archived where !processing.contains(file) {
            guard let values = try? file.resourceValues(forKeys: Set(keys)),
                  values.isRegularFile == true,
                  let size = values.fileSize,
                  size > 0 else { continue }
            let current = Int64(size)
            if file.lastPathComponent.contains(".__vda_") && !FileManager.default.fileExists(atPath: sidecarURL(for: file).path) {
                continue
            }
            if previousSizes[file] == current {
                let mp4 = finalMP4URL(for: file)
                if !FileManager.default.fileExists(atPath: mp4.path) {
                    processing.insert(file)
                    needsMove ? relocateAndConvert(file) : convert(file, to: mp4)
                }
            }
            previousSizes[file] = current
        }
    }

    private func tsFiles(in directory: URL) -> [URL] {
        let keys: [URLResourceKey] = [.fileSizeKey, .isRegularFileKey]
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else { return [] }
        return enumerator.compactMap { $0 as? URL }
            .filter { $0.pathExtension.lowercased() == "ts" }
    }

    private func relocateAndConvert(_ source: URL) {
        var relative = source.path.replacingOccurrences(of: incomingDirectory.path, with: "")
        while relative.hasPrefix("/") { relative.removeFirst() }
        var destination = downloadDirectory.appendingPathComponent(relative)
        try? FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: destination.path) {
            let base = destination.deletingPathExtension().lastPathComponent
            let folder = destination.deletingLastPathComponent()
            var index = 2
            repeat {
                destination = folder.appendingPathComponent("\(base) \(index)").appendingPathExtension("ts")
                index += 1
            } while FileManager.default.fileExists(atPath: destination.path)
        }
        do {
            try FileManager.default.moveItem(at: source, to: destination)
            let sourceSidecar = sidecarURL(for: source)
            let destinationSidecar = sidecarURL(for: destination)
            if FileManager.default.fileExists(atPath: sourceSidecar.path) {
                try? FileManager.default.moveItem(at: sourceSidecar, to: destinationSidecar)
            }
            processing.remove(source)
            previousSizes.removeValue(forKey: source)
            processing.insert(destination)
            convert(destination, to: finalMP4URL(for: destination))
        } catch {
            finish(source, name: source.lastPathComponent, succeeded: false,
                   message: "归档失败：\(error.localizedDescription)")
        }
    }

    private func sidecarURL(for source: URL) -> URL {
        source.deletingPathExtension().appendingPathExtension("capture.json")
    }

    private func metadata(for source: URL) -> CaptureMetadata? {
        guard let data = try? Data(contentsOf: sidecarURL(for: source)) else { return nil }
        return try? JSONDecoder().decode(CaptureMetadata.self, from: data)
    }

    private func safeFilename(_ value: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/:")
        let safe = value.components(separatedBy: forbidden).joined(separator: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return safe.isEmpty ? "视频" : safe
    }

    private func finalMP4URL(for source: URL) -> URL {
        let title: String
        if let metadata = metadata(for: source) {
            title = safeFilename(metadata.title)
        } else if let marker = source.deletingPathExtension().lastPathComponent.range(of: ".__vda_") {
            title = String(source.deletingPathExtension().lastPathComponent[..<marker.lowerBound])
        } else {
            title = source.deletingPathExtension().lastPathComponent
        }
        return source.deletingLastPathComponent().appendingPathComponent(title).appendingPathExtension("mp4")
    }

    private func convert(_ source: URL, to destination: URL) {
        guard let ffmpeg = Bundle.main.url(forResource: "ffmpeg", withExtension: nil) else {
            finish(source, name: source.lastPathComponent, succeeded: false, message: "应用缺少 ffmpeg 组件。")
            return
        }
        let captureMetadata = metadata(for: source)
        if let captureMetadata,
           let size = try? source.resourceValues(forKeys: [.fileSizeKey]).fileSize,
           Int64(size) != captureMetadata.totalBytes {
            finish(source, name: source.lastPathComponent, succeeded: false,
                   message: "完整性失败：TS 字节数与校验清单不一致。")
            return
        }
        status = "正在转换：\(source.lastPathComponent)"
        let process = Process()
        let errorPipe = Pipe()
        process.executableURL = ffmpeg
        process.arguments = [
            "-hide_banner", "-loglevel", "error", "-y",
            "-i", source.path,
            "-c", "copy",
            "-bsf:a", "aac_adtstoasc",
            "-movflags", "+faststart",
            destination.path
        ]
        process.standardError = errorPipe
        process.terminationHandler = { [weak self] task in
            let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
            let errorText = String(decoding: errorData, as: UTF8.self)
            Task { @MainActor in
                guard let self else { return }
                if task.terminationStatus == 0 {
                    let validation = self.validateMedia(destination, metadata: captureMetadata, ffmpeg: ffmpeg)
                    if validation.succeeded {
                        try? FileManager.default.removeItem(at: self.sidecarURL(for: source))
                        if !self.keepTS { try? FileManager.default.removeItem(at: source) }
                        self.finish(source, name: destination.lastPathComponent, succeeded: true,
                                    message: "验证通过：\(destination.lastPathComponent)；\(validation.message)")
                    } else {
                        self.finish(source, name: destination.lastPathComponent, succeeded: false,
                                    message: "完整性失败：\(validation.message)")
                    }
                } else {
                    self.finish(source, name: source.lastPathComponent, succeeded: false,
                                message: "转换失败：\(errorText.isEmpty ? "未知错误" : errorText)")
                }
            }
        }
        do {
            try process.run()
        } catch {
            finish(source, name: source.lastPathComponent, succeeded: false, message: "无法启动转换：\(error.localizedDescription)")
        }
    }

    private func validateMedia(_ media: URL, metadata: CaptureMetadata?, ffmpeg: URL) -> ValidationResult {
        let probe = Process()
        let probePipe = Pipe()
        probe.executableURL = ffmpeg
        probe.arguments = ["-hide_banner", "-i", media.path]
        probe.standardError = probePipe
        do {
            try probe.run()
            probe.waitUntilExit()
        } catch {
            return ValidationResult(succeeded: false, message: "无法读取 MP4：\(error.localizedDescription)")
        }
        let probeText = String(decoding: probePipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        let pattern = #"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: probeText, range: NSRange(probeText.startIndex..., in: probeText)),
              let hourRange = Range(match.range(at: 1), in: probeText),
              let minuteRange = Range(match.range(at: 2), in: probeText),
              let secondRange = Range(match.range(at: 3), in: probeText),
              let hours = Double(probeText[hourRange]),
              let minutes = Double(probeText[minuteRange]),
              let seconds = Double(probeText[secondRange]) else {
            return ValidationResult(succeeded: false, message: "无法识别 MP4 时长。")
        }
        let actualDuration = hours * 3600 + minutes * 60 + seconds
        if let metadata, abs(actualDuration - metadata.expectedDuration) > 1.0 {
            return ValidationResult(
                succeeded: false,
                message: String(format: "时长不符：预计 %.2f 秒，实际 %.2f 秒。", metadata.expectedDuration, actualDuration)
            )
        }

        let decode = Process()
        let decodePipe = Pipe()
        decode.executableURL = ffmpeg
        decode.arguments = ["-v", "error", "-xerror", "-i", media.path, "-f", "null", "-"]
        decode.standardError = decodePipe
        do {
            try decode.run()
            decode.waitUntilExit()
        } catch {
            return ValidationResult(succeeded: false, message: "无法启动完整解码检查：\(error.localizedDescription)")
        }
        if decode.terminationStatus != 0 {
            let detail = String(decoding: decodePipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return ValidationResult(succeeded: false, message: "完整解码失败：\(detail.isEmpty ? "未知错误" : detail)")
        }
        let expected = metadata.map { String(format: "预计 %.2f 秒", $0.expectedDuration) } ?? "无播放列表时长"
        return ValidationResult(succeeded: true, message: String(format: "%@，实际 %.2f 秒，完整解码通过", expected, actualDuration))
    }

    private func finish(_ source: URL, name: String, succeeded: Bool, message: String) {
        processing.remove(source)
        status = message
        records.insert(ConversionRecord(name: name, date: Date(), succeeded: succeeded), at: 0)
        if records.count > 20 { records.removeLast(records.count - 20) }
    }
}

struct MonitorView: View {
    @StateObject private var model = MonitorModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 5) {
                Text("视频下载助手").font(.largeTitle.bold())
                Text("自动把 Chrome 扩展保存的 TS 无损封装为同名 MP4。")
                    .foregroundStyle(.secondary)
            }

            GroupBox("下载目录（修改后自动保存）") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Chrome 临时写入：\(model.incomingDirectory.path)")
                        .font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    Button("选择 Chrome 输入目录") { model.chooseDirectory(input: true) }
                        .disabled(!model.canChangeDirectories)
                    HStack {
                        Image(systemName: "folder")
                        Text("最终目录：\(model.downloadDirectory.path)")
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                        Spacer()
                        Button("打开目录") { model.openFolder() }
                        Button("选择输出目录") { model.chooseDirectory(input: false) }
                            .disabled(!model.canChangeDirectories)
                    }
                    Text("切换目录不会搬迁旧文件；转换进行中暂时不能修改目录。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding(8)
            }

            HStack {
                Circle()
                    .fill(model.isMonitoring ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                Text(model.status).textSelection(.enabled)
                Spacer()
                Toggle("转换后保留 TS", isOn: $model.keepTS)
                    .toggleStyle(.checkbox)
            }

            HStack {
                Button(model.isMonitoring ? "暂停监控" : "开始监控") {
                    model.isMonitoring ? model.stopMonitoring() : model.startMonitoring()
                }
                .buttonStyle(.borderedProminent)
                Text("扩展下载完成并且文件大小稳定约 2 秒后自动转换。")
                    .font(.caption).foregroundStyle(.secondary)
            }

            GroupBox("最近转换") {
                if model.records.isEmpty {
                    Text("暂无记录").foregroundStyle(.secondary).padding(8)
                } else {
                    List(model.records) { record in
                        HStack {
                            Image(systemName: record.succeeded ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(record.succeeded ? .green : .red)
                            Text(record.name)
                            Spacer()
                            Text(record.date, style: .time).foregroundStyle(.secondary)
                        }
                    }.frame(minHeight: 140)
                }
            }

            Text("仅限个人学术研究，禁止商业使用。助手仅转换本地文件；扩展不导出 DRM/加密内容。")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(24)
    }
}
