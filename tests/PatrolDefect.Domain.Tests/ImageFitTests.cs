using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

public sealed class ImageFitTests
{
    [Fact]
    public void Landscape_image_has_vertical_letterbox()
    {
        var fit = ImageFit.Calculate(1012, 812, 4000, 2000);
        Assert.Equal(new ImageFit(6, 156, 1000, 500), fit);
        Assert.False(fit.Contains(500, 100));
        Assert.True(fit.Contains(506, 406));
        Assert.Equal(.5, (506 - fit.Left) / fit.Width);
        Assert.Equal(.5, (406 - fit.Top) / fit.Height);
    }

    [Fact]
    public void Portrait_image_has_horizontal_letterbox()
    {
        Assert.Equal(new ImageFit(306, 6, 400, 800),
            ImageFit.Calculate(1012, 812, 2000, 4000));
    }
}
