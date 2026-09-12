namespace PatrolDefect.Domain;

public sealed record PhotoRecord(long Id, string RelativePath, string FullPath, string LineName, string TowerName);

public sealed record DefectMark(
    long Id,
    long PhotoId,
    double X,
    double Y,
    double Width,
    double Height,
    double StrokeWidth,
    string Component,
    string DefectTag,
    string Conclusion);

public enum PhotoConclusion
{
    Pending,
    NoDefect,
    DefectFound,
    ReviewRequired,
    Unusable
}

public static class DefectCategoryRule
{
    public const string Insulation = "全绝缘缺陷";
    public const string Other = "其他缺陷";

    public static string GetCategory(string defectTag, IReadOnlyList<string>? appended = null,
        string originalName = "", string outputName = "")
    {
        var text = appended is { Count: > 0 } ? string.Join(" ", appended) :
            defectTag.Length > 0 ? defectTag :
            originalName.Length > 0 && outputName.Length > 0 ? ExtractTag(originalName, outputName) :
            outputName;
        return text.Contains("绝缘", StringComparison.OrdinalIgnoreCase)
            || text.Contains("裸导线", StringComparison.OrdinalIgnoreCase)
            ? Insulation
            : Other;
    }

    public static string ExtractTag(string originalName, string outputName)
    {
        if (originalName.Length == 0 || outputName.Length == 0) return "";
        static string Stem(string name)
        {
            var dot = name.LastIndexOf('.');
            return dot < 0 ? name[..^1] : name[..dot];
        }
        var original = Stem(originalName);
        var output = Stem(outputName);
        if (original == output) return "";
        if (output.StartsWith(original + "_", StringComparison.Ordinal)) return output[original.Length..];
        var index = output.LastIndexOf(original, StringComparison.Ordinal);
        if (index >= 0)
        {
            var after = output[(index + original.Length)..];
            if (after.StartsWith('_')) return after;
        }
        var last = output.Split("__")[^1].Split('_');
        return last.Length > 1 ? "_" + string.Join("_", last.Skip(1)) : "";
    }
}

public sealed record ParsedPhotoPath(string LineName, string TowerName, string RelativePath, string Location = "");
