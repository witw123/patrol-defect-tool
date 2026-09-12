using System.Text.Json;
using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class SectionTests
{
    [Fact]
    public void Filename_preview_matches_html_selected_tags()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-preview.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var name = item.GetProperty("name").GetString()!;
            var tags = item.GetProperty("appended").EnumerateArray().Select(tag => tag.GetString()!);
            Assert.Equal(item.GetProperty("expected").GetString(), FileNameRules.Preview(name, tags,
                item.GetProperty("section").GetString()!, PathRules.ParseRelative("巡检", name)));
        }
    }

    [Fact]
    public void Suggestions_and_range_detection_match_html()
    {
        using var fixture = Read();
        foreach (var item in fixture.RootElement.GetProperty("suggestions").EnumerateArray())
        {
            var tower = item.GetProperty("tower").GetString()!;
            Assert.Equal(item.GetProperty("expected").GetString(),
                SectionRules.Suggest(tower, item.GetProperty("next").GetString()!));
            Assert.Equal(item.GetProperty("isRange").GetBoolean(), SectionRules.IsRange(tower));
        }
    }

    [Fact]
    public void Custom_names_match_html()
    {
        using var fixture = Read();
        foreach (var item in fixture.RootElement.GetProperty("custom").EnumerateArray())
        {
            var parsed = PathRules.ParseRelative("巡检", item.GetProperty("relative").GetString()!);
            Assert.Equal(item.GetProperty("expected").GetString(),
                SectionRules.CustomBase(item.GetProperty("name").GetString()!,
                    item.GetProperty("section").GetString()!, parsed));
        }
    }

    private static JsonDocument Read() => JsonDocument.Parse(File.ReadAllText(
        Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-sections.json")));
}
