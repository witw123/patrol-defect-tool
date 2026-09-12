using System.Text.Json;

namespace PatrolDefect.Domain;

public sealed class RuleCatalog
{
    public required string SourceSha256 { get; init; }
    public required Dictionary<string, string[]> Categories { get; init; }
    public required Dictionary<string, string[]> Recommendations { get; init; }
    public required string[] CriticalTags { get; init; }
    public required string[] KnownPositions { get; init; }

    public static RuleCatalog LoadDefaults()
    {
        using var stream = typeof(RuleCatalog).Assembly.GetManifestResourceStream(
            "PatrolDefect.Domain.Data.default-rules.json")
            ?? throw new InvalidOperationException("Default rule resource is missing.");
        return JsonSerializer.Deserialize<RuleCatalog>(stream)
            ?? throw new InvalidDataException("Default rule resource is empty.");
    }
}
