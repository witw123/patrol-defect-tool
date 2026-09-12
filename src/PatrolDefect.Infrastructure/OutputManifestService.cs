using System.Text.Json;
using System.Text.Json.Serialization;
using PatrolDefect.Domain;

namespace PatrolDefect.Infrastructure;

public sealed record OutputManifestEntry(
    [property: JsonPropertyName("origName")] string OrigName,
    [property: JsonPropertyName("relPath")] string RelPath);

// 原版「输出清单.json」：输出文件 → 原图 精确映射，键为 '/' 分隔的输出相对路径。
// 结构 { version: 1, savedAt, entries: { key: { origName, relPath } } }。
public sealed class OutputManifestService
{
    public const string FileName = "输出清单.json";

    private static readonly JsonSerializerOptions ReadOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    // 按数据库登记成果重建清单文件（原子写入，不残留半份清单）。
    public void Write(string outputRoot, ProjectStore store, IReadOnlyList<PhotoRecord> photos)
    {
        var byId = photos.ToDictionary(photo => photo.Id, photo => photo);
        var entries = new SortedDictionary<string, OutputManifestEntry>(StringComparer.Ordinal);
        foreach (var (photoId, path) in store.LoadAllArtifacts())
        {
            if (!byId.TryGetValue(photoId, out var photo) || !File.Exists(path)) continue;
            if (Path.GetFullPath(path).StartsWith(Path.GetFullPath(outputRoot),
                    StringComparison.OrdinalIgnoreCase) is false) continue;
            var key = Path.GetRelativePath(outputRoot, path).Replace('\\', '/');
            entries[key] = new OutputManifestEntry(
                Path.GetFileName(photo.FullPath), photo.RelativePath.Replace('\\', '/'));
        }
        var payload = JsonSerializer.Serialize(new ManifestPayload
        {
            Version = 1,
            SavedAt = DateTimeOffset.Now,
            Entries = entries
        }, new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull });

        Directory.CreateDirectory(outputRoot);
        var target = Path.Combine(outputRoot, FileName);
        var temp = Path.Combine(outputRoot, "." + Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllText(temp, payload);
        File.Move(temp, target, overwrite: true);
    }

    public IReadOnlyDictionary<string, OutputManifestEntry> Read(string outputRoot)
    {
        var path = Path.Combine(outputRoot, FileName);
        if (!File.Exists(path)) return new Dictionary<string, OutputManifestEntry>();
        try
        {
            var payload = JsonSerializer.Deserialize<ManifestPayload>(File.ReadAllText(path), ReadOptions);
            return payload?.Entries ?? new SortedDictionary<string, OutputManifestEntry>(StringComparer.Ordinal);
        }
        catch
        {
            return new Dictionary<string, OutputManifestEntry>();
        }
    }

    private sealed class ManifestPayload
    {
        [JsonPropertyName("version")] public int Version { get; set; }
        [JsonPropertyName("savedAt")] public DateTimeOffset SavedAt { get; set; }
        [JsonPropertyName("entries")] public SortedDictionary<string, OutputManifestEntry> Entries { get; set; } = new(StringComparer.Ordinal);
    }
}
