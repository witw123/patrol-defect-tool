using System.Text.Json;
using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class HtmlBaselineTests
{
    public static IEnumerable<object[]> PathCases()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-paths.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
            yield return [item.GetProperty("input").GetString()!, item.GetProperty("line").GetString()!,
                item.GetProperty("tower").GetString()!];
    }

    [Theory]
    [MemberData(nameof(PathCases))]
    public void Path_matches_actual_html(string input, string line, string tower)
    {
        var parsed = PathRules.ParseRelative("巡检", input);
        Assert.Equal(line, parsed.LineName);
        Assert.Equal(tower, parsed.TowerName);
    }
    public static IEnumerable<object[]> CleaningCases()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-clean-names.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
            yield return [item.GetProperty("input").GetString()!, item.GetProperty("expected").GetString()!];
    }

    [Theory]
    [MemberData(nameof(CleaningCases))]
    public void Cleaning_matches_actual_html(string input, string expected)
        => Assert.Equal(expected, FileNameRules.Clean(input));
}
