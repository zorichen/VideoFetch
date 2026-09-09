import Foundation

@main
struct DirectorySettingsTests {
    static func main() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("vda-test-\(UUID().uuidString)")
        let suite = "vda-test-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer {
            defaults.removePersistentDomain(forName: suite)
            try? fm.removeItem(at: root)
        }
        let input = root.appendingPathComponent("input")
        let output = root.appendingPathComponent("output")
        try DirectorySettings.save(input: input, output: output, defaults: defaults)
        precondition(DirectorySettings.load(DirectorySettings.outputKey, fallback: input,
                                          defaults: UserDefaults(suiteName: suite)!) == output.standardizedFileURL)
        func expectInvalid(_ candidate: URL) throws {
            do {
                try DirectorySettings.save(input: input, output: candidate, defaults: defaults)
            } catch { return }
            fatalError("Overlapping directory was accepted: \(candidate)")
        }
        try expectInvalid(input)
        try expectInvalid(input.appendingPathComponent("child"))
        try expectInvalid(root)
        let link = root.appendingPathComponent("input-link")
        try fm.createSymbolicLink(at: link, withDestinationURL: input)
        try expectInvalid(link)
        precondition(defaults.string(forKey: DirectorySettings.outputKey) == output.path)
        // A sibling whose name has the same prefix must remain valid.
        try DirectorySettings.validate(input: input, output: root.appendingPathComponent("input-archive"))
        defaults.set("relative/path", forKey: DirectorySettings.outputKey)
        precondition(DirectorySettings.load(DirectorySettings.outputKey, fallback: output, defaults: defaults) == output)
        print("PASS: directory persistence, overlap, symlinks, sibling paths and invalid stored path")
    }
}
