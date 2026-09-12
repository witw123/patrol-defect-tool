using System.Text.Json;
using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

// 照片重命名规则与原版 HTML computeNewFileName 直接对照：
// 用例与期望值由 tools/capture-html-baseline.cjs 从原 HTML 提取（html-rename.json）。
public sealed class PhotoRenameRulesTests
{
    [Fact]
    public void ComputeNewFileName_matches_actual_html()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-rename.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var name = item.GetProperty("name").GetString()!;
            var loc = item.GetProperty("loc").GetString()!;
            var input = item.GetProperty("input").GetString()!;
            Assert.Equal(item.GetProperty("expected").GetString(),
                PhotoRenameRules.ComputeNewFileName(name, loc, input));
        }
    }

    [Fact]
    public void Native_location_matches_html_for_captured_names()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-rename.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var root = item.GetProperty("root").GetString()!;
            var name = item.GetProperty("name").GetString()!;
            Assert.Equal(item.GetProperty("loc").GetString(),
                PathRules.ParseRelative(root, name).Location);
        }
    }

    [Fact]
    public void Invalid_characters_are_rejected()
    {
        Assert.True(PhotoRenameRules.ContainsInvalidCharacters("a/b.jpg"));
        Assert.False(PhotoRenameRules.ContainsInvalidCharacters("绝缘子.jpg"));
    }
}
