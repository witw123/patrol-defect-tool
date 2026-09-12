using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class RuleCatalogTests
{
    [Fact]
    public void Embedded_defaults_preserve_actual_html_counts()
    {
        var catalog = RuleCatalog.LoadDefaults();
        Assert.Equal(24, catalog.Categories.Count);
        Assert.Equal(138, catalog.Categories.Values.Sum(tags => tags.Length));
        Assert.Equal(41, catalog.CriticalTags.Length);
        Assert.Equal(30, catalog.Recommendations.Count);
        Assert.Contains("_导线-裸导线", catalog.CriticalTags);
        Assert.Contains("悬瓶", catalog.Recommendations["柱瓶"]);
        Assert.Equal(64, catalog.SourceSha256.Length);
    }

    [Fact]
    public void Editing_one_catalog_does_not_mutate_default_resource()
    {
        var catalog = RuleCatalog.LoadDefaults();
        catalog.Categories.Clear();
        Assert.Equal(24, RuleCatalog.LoadDefaults().Categories.Count);
    }
}
