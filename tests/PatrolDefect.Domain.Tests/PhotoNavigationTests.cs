using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class PhotoNavigationTests
{
    private static readonly PhotoRecord[] Photos = Enumerable.Range(1, 5)
        .Select(i => new PhotoRecord(i, $"{i}.jpg", $"{i}.jpg", "line", "tower")).ToArray();

    [Fact]
    public void Progress_uses_sequence_not_visit_order() =>
        Assert.Equal(Photos[4], PhotoNavigation.FurthestViewed(Photos, new HashSet<long> { 5, 2, 1 }));

    [Fact]
    public void No_progress_returns_first_photo() =>
        Assert.Equal(Photos[0], PhotoNavigation.FurthestViewed(Photos, new HashSet<long>()));

    [Fact]
    public void Filtered_navigation_skips_hidden_photos_both_directions()
    {
        Assert.Equal(Photos[3], PhotoNavigation.Next(Photos, 1, 1, p => p.Id == 4));
        Assert.Equal(Photos[0], PhotoNavigation.Next(Photos, 4, -1, p => p.Id == 1));
        Assert.Null(PhotoNavigation.Next(Photos, 5, 1, _ => true));
    }
}
