using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Encodings.Web;
using PatrolDefect.Domain;

namespace PatrolDefect.Infrastructure;

public static class TemplateService
{
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static RuleTemplate Merge(RuleTemplate current, RuleTemplate incoming)
    {
        var result = Clone(current);
        foreach (var item in incoming.Categories)
            result.Categories[item.Key] = result.Categories.TryGetValue(item.Key, out var old)
                ? old.Concat(item.Value.Where(value => !old.Contains(value))).Distinct().ToArray() : item.Value.ToArray();
        foreach (var item in incoming.Recommendations)
            result.Recommendations[item.Key] = result.Recommendations.TryGetValue(item.Key, out var old)
                ? old.Concat(item.Value).Distinct().ToArray() : item.Value.Distinct().ToArray();
        var existingCritical = (current.CriticalTags ?? []).ToHashSet(StringComparer.Ordinal);
        if (incoming.CriticalTags is not null)
        {
            var incomingCritical = incoming.CriticalTags.Select(x => x.Trim()).ToHashSet(StringComparer.Ordinal);
            foreach (var tag in incoming.Categories.Values.SelectMany(x => x))
                if (incomingCritical.Contains(tag)) existingCritical.Add(tag);
        }
        result.CriticalTags = existingCritical.ToArray();
        if (incoming.CandidatePool is not null)
            result.CandidatePool = (current.CandidatePool ?? []).Concat(incoming.CandidatePool.Select(x => x.Trim()))
                .Where(x => x.Length > 0).Distinct().OrderBy(x => x, StringComparer.Create(
                    System.Globalization.CultureInfo.GetCultureInfo("zh-CN"), false)).ToArray();
        return result;
    }

    public static RuleTemplate Overwrite(RuleTemplate current, RuleTemplate incoming)
    {
        var result = Clone(incoming);
        var importedTags = result.Categories.Values.SelectMany(x => x).ToHashSet(StringComparer.Ordinal);
        result.CriticalTags = (incoming.CriticalTags ?? RuleCatalog.LoadDefaults().CriticalTags)
            .Select(x => x.Trim()).Where(importedTags.Contains).Distinct().ToArray();
        result.CandidatePool ??= current.CandidatePool?.ToArray() ?? [];
        return result;
    }

    public static RuleTemplate Clone(RuleTemplate source) => Parse(Serialize(source));

    public static RuleTemplate FromCatalog(RuleCatalog catalog, IReadOnlySet<string> criticalTags,
        IEnumerable<string>? candidatePool = null) =>
        new() {
            Categories = catalog.Categories.ToDictionary(x => x.Key, x => x.Value.ToArray()),
            Recommendations = catalog.Recommendations.ToDictionary(x => x.Key, x => x.Value.ToArray()),
            CriticalTags = criticalTags.ToArray(), CandidatePool = candidatePool?.ToArray() ??
                catalog.KnownPositions.Concat(catalog.Categories.Keys).Concat(catalog.Recommendations.Keys)
                    .Distinct().OrderBy(x => x, StringComparer.Create(
                        System.Globalization.CultureInfo.GetCultureInfo("zh-CN"), false)).ToArray() };

    public static void Export(string path, RuleTemplate template)
    {
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, Serialize(template));
            File.Move(temporary, path, overwrite: true);
        }
        finally { File.Delete(temporary); }
    }

    public static string Serialize(RuleTemplate template) => JsonSerializer.Serialize(template, Options);

    public static RuleTemplate Import(string path)
    {
        if (new FileInfo(path).Length > 10 * 1024 * 1024)
            throw new InvalidDataException("模板不能超过 10 MB。");
        return Parse(File.ReadAllText(path));
    }

    public static RuleTemplate Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object ||
            (!root.TryGetProperty("defectDict", out _) && !root.TryGetProperty("locationAdjacency", out _)))
            throw new InvalidDataException("模板必须包含 defectDict 或 locationAdjacency。");
        var template = JsonSerializer.Deserialize<RuleTemplate>(json, Options)
            ?? throw new InvalidDataException("模板内容为空。");
        if (template.Categories is null || template.Recommendations is null)
            throw new InvalidDataException("分类与推荐必须是对象。");
        foreach (var map in new[] { template.Categories, template.Recommendations })
            foreach (var (key, values) in map)
                if (string.IsNullOrWhiteSpace(key) || values is null || values.Any(x => x is null))
                    throw new InvalidDataException("分类或推荐包含空名称、无效标签列表。");
        if (template.CriticalTags?.Any(x => x is null) == true || template.CandidatePool?.Any(x => x is null) == true)
            throw new InvalidDataException("危急标签与候选词必须为字符串数组。");
        return template;
    }
}

public sealed class RuleTemplate
{
    [JsonPropertyName("appName")]
    public string AppName { get; set; } = "巡检缺陷命名分类工具";
    [JsonPropertyName("fileType")]
    public string FileType { get; set; } = "xunjian_defect_template";
    [JsonPropertyName("version")]
    public string Version { get; set; } = "2.2";
    [JsonPropertyName("exportTime")]
    public string ExportTime { get; set; } = DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss");
    [JsonPropertyName("defectDict")]
    public Dictionary<string, string[]> Categories { get; set; } = [];
    [JsonPropertyName("locationAdjacency")]
    public Dictionary<string, string[]> Recommendations { get; set; } = [];
    [JsonPropertyName("criticalDefects")]
    public string[]? CriticalTags { get; set; }
    [JsonPropertyName("candidatePool")]
    public string[]? CandidatePool { get; set; }
}
