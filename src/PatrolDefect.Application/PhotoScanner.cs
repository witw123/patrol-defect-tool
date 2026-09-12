using PatrolDefect.Domain;

namespace PatrolDefect.Application;

public sealed class PhotoScanner
{
    private static readonly HashSet<string> Extensions =
        [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"];

    public IReadOnlyList<PhotoRecord> Scan(string rootPath) => ScanWithDirectories(rootPath).Photos;

    // 与原版 discoveredDirs 对齐：同时返回扫描发现的所有子目录（含空文件夹），保证杆塔 100% 匹配。
    public (IReadOnlyList<PhotoRecord> Photos, IReadOnlyList<string> Directories) ScanWithDirectories(string rootPath)
    {
        if (!Directory.Exists(rootPath))
            throw new DirectoryNotFoundException(rootPath);

        var files = new List<string>();
        var directories = new List<string>();
        Walk(rootPath, "", files, directories);
        var photos = files
            .Where(path => Extensions.Contains(Path.GetExtension(path).ToLowerInvariant()))
            .Select(path =>
            {
                var parsed = PathRules.Parse(rootPath, Path.Combine(rootPath, path));
                return new PhotoRecord(0, parsed.RelativePath, Path.Combine(rootPath, path),
                    parsed.LineName, parsed.TowerName);
            })
            .Where(x => !PathRules.IsOutputArtifact(x.RelativePath))
            .OrderBy(x => x, PhotoComparer.Instance)
            .ToList();
        return (photos, directories);
    }

    private static void Walk(string root, string relative, List<string> files, List<string> directories)
    {
        if (relative.Length > 0) directories.Add(relative);
        var directoryPath = relative.Length == 0 ? root : Path.Combine(root, relative);
        foreach (var file in Directory.EnumerateFiles(directoryPath))
            files.Add(relative.Length == 0
                ? Path.GetFileName(file)
                : Path.Combine(relative, Path.GetFileName(file)));
        foreach (var directory in Directory.EnumerateDirectories(directoryPath))
        {
            var name = Path.GetFileName(directory);
            if (PathRules.ShouldSkipDirectory(name)) continue;
            // Native reparse points can lead outside the selected tree or create cycles.
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
            Walk(root, relative.Length == 0 ? name : Path.Combine(relative, name), files, directories);
        }
    }
}
