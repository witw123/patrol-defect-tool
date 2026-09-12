using Xunit;
using PatrolDefect.Domain;

namespace PatrolDefect.Domain.Tests;

public sealed class RulesTests
{
    [Fact]
    public void Appended_tags_take_precedence_over_existing_insulation_tag()
        => Assert.Equal(DefectCategoryRule.Other,
            DefectCategoryRule.GetCategory("绝缘破损", ["螺栓松动"]));

    [Theory]
    [InlineData("绝缘护套缺失", "全绝缘缺陷")]
    [InlineData("裸导线破损", "全绝缘缺陷")]
    [InlineData("螺栓松动", "其他缺陷")]
    public void Category_matches_html_rule(string tag, string expected)
        => Assert.Equal(expected, DefectCategoryRule.GetCategory(tag));

    [Fact]
    public void Relative_path_uses_line_and_tower()
    {
        var result = PathRules.Parse(@"C:\巡检", @"C:\巡检\线路一\#001\照片.jpg");
        Assert.Equal("线路一", result.LineName);
        Assert.Equal("#001", result.TowerName);
        Assert.Equal(Path.Combine("线路一", "#001", "照片.jpg"), result.RelativePath);
    }

    [Fact]
    public void Output_directories_are_excluded()
        => Assert.True(PathRules.IsOutputArtifact(Path.Combine("线路一", "缺陷圈示图", "照片.jpg")));

    [Fact]
    public void File_name_contains_distinct_defect_tags()
    {
        var marks = new[]
        {
            new DefectMark(1, 1, 0, 0, .1, .1, 10, "绝缘子", "_绝缘破损", "DefectFound"),
            new DefectMark(2, 1, 0, 0, .1, .1, 10, "绝缘子", "_绝缘破损", "DefectFound")
        };
        Assert.Equal("照片_绝缘破损.jpg", FileNameRules.Build("照片.jpg", marks));
    }
}
