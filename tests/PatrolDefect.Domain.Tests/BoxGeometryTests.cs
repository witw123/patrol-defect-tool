using PatrolDefect.Domain;
using Xunit;

namespace PatrolDefect.Domain.Tests;

// 与原版 HTML clampBox / moveBox / resizeBox 行为一致的几何测试（以 100×100 画布为例）。
public sealed class BoxGeometryTests
{
    private const double Bounds = 100;

    [Fact]
    public void Clamp_pulls_negative_size_back_into_bounds()
    {
        var (x, y, w, h) = BoxGeometry.Clamp(-10, -5, 120, 130, Bounds, Bounds);
        Assert.Equal(0, x);
        Assert.Equal(0, y);
        Assert.Equal(100, w);
        Assert.Equal(100, h);
    }

    [Fact]
    public void Clamp_normalizes_flipped_edges()
    {
        var (x, y, w, h) = BoxGeometry.Clamp(80, 90, -50, -60, Bounds, Bounds);
        Assert.Equal(30, x);
        Assert.Equal(30, y);
        Assert.Equal(50, w);
        Assert.Equal(60, h);
    }

    [Fact]
    public void Move_collapses_box_at_boundary_like_html()
    {
        // 原版 clampBox 在越界时会把宽度收敛为 0，不做反向贴边。
        var (x, y, w, h) = BoxGeometry.Move(80, 80, 30, 10, 40, 40, Bounds, Bounds);
        Assert.Equal((100, 100, 0, 0), (x, y, w, h));
    }

    [Fact]
    public void Resize_west_keeps_min_size_and_clamps()
    {
        var (x, y, w, h) = BoxGeometry.Resize(50, 40, 30, 20, "w", -20, 45, Bounds, Bounds, 3);
        Assert.Equal((0, 40, 80, 20), (x, y, w, h));
    }

    [Fact]
    public void Resize_east_enforces_minimum()
    {
        var (x, _, w, _) = BoxGeometry.Resize(50, 40, 30, 20, "e", 40, 45, Bounds, Bounds, 3);
        Assert.Equal(50, x);
        Assert.Equal(3, w);
    }

    [Fact]
    public void Resize_northwest_shrinks_to_minimum_before_right_edge()
    {
        var (x, y, w, h) = BoxGeometry.Resize(50, 50, 10, 10, "nw", 90, 95, Bounds, Bounds, 3);
        Assert.Equal((57, 57, 3, 3), (x, y, w, h));
    }
}
