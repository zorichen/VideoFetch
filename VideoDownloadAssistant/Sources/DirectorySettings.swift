import Foundation

enum DirectorySettings {
    static let inputKey = "captureInputDirectory"
    static let outputKey = "captureOutputDirectory"

    static func load(_ key: String, fallback: URL, defaults: UserDefaults = .standard) -> URL {
        guard let path = defaults.string(forKey: key), path.hasPrefix("/") else { return fallback }
        return URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
    }

    static func validate(input: URL, output: URL) throws {
        let source = input.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        let destination = output.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        if source.starts(with: destination) || destination.starts(with: source) {
            throw NSError(domain: "DirectorySettings", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "输入和输出目录不能相同，也不能互相包含。请选择两个独立目录。"
            ])
        }
    }

    static func save(input: URL, output: URL, defaults: UserDefaults = .standard) throws {
        try validate(input: input, output: output)
        for directory in [input, output] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard FileManager.default.isWritableFile(atPath: directory.path) else {
                throw NSError(domain: "DirectorySettings", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "目录不可写：\(directory.path)"
                ])
            }
        }
        defaults.set(input.path, forKey: inputKey)
        defaults.set(output.path, forKey: outputKey)
    }
}
