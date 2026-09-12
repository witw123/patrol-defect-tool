using System.Text.Json;
using PatrolDefect.Application;
using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Infrastructure.Tests;

public sealed class PhotoSortTests
{
    [Fact]
    public void Sort_matches_html_compare_photos()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-sort.json")));
        var inputs = fixture.RootElement.GetProperty("input").EnumerateArray()
            .Select((item, index) =>
            {
                var path = item.GetString()!;
                var parsed = PathRules.ParseRelative("巡检", path);
                return new PhotoRecord(index + 1, path, path, parsed.LineName, parsed.TowerName);
            }).ToArray();
        var expected = fixture.RootElement.GetProperty("expected").EnumerateArray()
            .Select(item => item.GetString()).ToArray();
        Assert.Equal(expected, inputs.OrderBy(photo => photo, PhotoComparer.Instance).Select(photo => photo.RelativePath));
    }
}
