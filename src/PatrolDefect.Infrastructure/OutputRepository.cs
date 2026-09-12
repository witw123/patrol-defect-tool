using PatrolDefect.Domain;

namespace PatrolDefect.Infrastructure;

public sealed class OutputRepository
{
    // 与原版 scanOutputDirectory 一致：优先「输出清单」精确映射，缺失时回退文件名匹配；
    // 已标状态以输出成果为权威来源，圈示图/原图/危急全部登记。
    public int Sync(ProjectStore store, IReadOnlyList<PhotoRecord> photos, string outputRoot)
    {
        var manifest = new OutputManifestService().Read(outputRoot);
        var known = store.LoadAllArtifacts().Select(x => x.Path)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // 清理指向已不存在文件的登记（规范命名/取消后残留），避免清单与统计虚高。
        foreach (var path in known.Where(path => !File.Exists(path)).ToArray())
        {
            if (store.FindArtifactPhotoId(path) is { } photoId) store.ForgetArtifact(photoId, path);
            known.Remove(path);
        }

        var byOrigName = photos.GroupBy(photo => Path.GetFileName(photo.FullPath),
            StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.First(),
            StringComparer.OrdinalIgnoreCase);
        var byRelPath = photos.GroupBy(photo => photo.RelativePath.Replace('\\', '/'),
            StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.First(),
            StringComparer.OrdinalIgnoreCase);
        var byStem = photos.GroupBy(photo => Path.GetFileNameWithoutExtension(photo.FullPath),
            StringComparer.OrdinalIgnoreCase).ToDictionary(group => group.Key, group => group.First(),
            StringComparer.OrdinalIgnoreCase);

        PhotoRecord? Resolve(string relativeKey, string outputName)
        {
            if (manifest.TryGetValue(relativeKey.Replace('\\', '/'), out var entry))
            {
                if (byRelPath.TryGetValue(entry.RelPath, out var photo) ||
                    byOrigName.TryGetValue(entry.OrigName, out photo))
                    return photo;
            }
            var stem = Path.GetFileNameWithoutExtension(outputName);
            if (byStem.TryGetValue(stem, out var exact)) return exact;
            // 原版 findMatchingInputFile 兜底：输出名以原图 stem 为前缀（保存时追加缺陷标签）。
            return photos
                .Where(photo => outputName.StartsWith(
                    Path.GetFileNameWithoutExtension(photo.FullPath), StringComparison.OrdinalIgnoreCase))
                .OrderBy(photo => Path.GetFileNameWithoutExtension(photo.FullPath).Length)
                .FirstOrDefault();
        }

        var count = 0;
        foreach (var directory in new[] { "缺陷圈示图", "缺陷原图", "危急缺陷" })
        {
            var root = Path.Combine(outputRoot, directory);
            if (!Directory.Exists(root)) continue;
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                if (known.Contains(file)) continue;
                if (Path.GetExtension(file).ToLowerInvariant() is not (".jpg" or ".jpeg" or ".png" or ".bmp"
                    or ".tif" or ".tiff" or ".webp")) continue;
                var photo = Resolve(Path.GetRelativePath(outputRoot, file), Path.GetFileName(file));
                if (photo is null) continue;
                store.RegisterArtifacts(photo.Id, file);
                count++;
            }
        }
        if (count > 0) new OutputManifestService().Write(outputRoot, store, photos);
        return count;
    }

    public int DeleteCritical(ProjectStore store, long photoId)
    {
        var count = 0;
        foreach (var path in store.LoadArtifacts(photoId)
            .Where(path => string.Equals(Path.GetFileName(Path.GetDirectoryName(path) ?? ""),
                "危急缺陷", StringComparison.Ordinal)))
        {
            File.Delete(path);
            store.ForgetArtifact(photoId, path);
            count++;
        }
        return count;
    }

    public int DeleteArtifacts(ProjectStore store, long photoId)
    {
        var count = 0;
        foreach (var path in store.LoadArtifacts(photoId))
        {
            File.Delete(path);
            store.ForgetArtifact(photoId, path);
            count++;
        }
        return count;
    }
}
