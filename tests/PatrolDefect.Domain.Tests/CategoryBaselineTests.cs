using System.Text.Json;
using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class CategoryBaselineTests
{
    [Fact]
    public void All_precedence_and_filename_branches_match_html()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "Fixtures", "html-categories.json")));
        foreach (var item in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var original = item.GetProperty("original").GetString()!;
            var output = item.GetProperty("output").GetString()!;
            var appended = item.GetProperty("appended");
            var tags = appended.ValueKind == JsonValueKind.Null ? null :
                appended.EnumerateArray().Select(tag => tag.GetString()!).ToArray();
            Assert.Equal(item.GetProperty("expected").GetString(),
                DefectCategoryRule.GetCategory(item.GetProperty("tag").GetString()!, tags, original, output));
            Assert.Equal(item.GetProperty("extracted").GetString(), DefectCategoryRule.ExtractTag(original, output));
        }
    }
}
