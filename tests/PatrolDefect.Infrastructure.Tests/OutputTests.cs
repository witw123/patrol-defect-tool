using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace PatrolDefect.Infrastructure.Tests;

public sealed class OutputTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "PatrolOutputTests", Guid.NewGuid().ToString("N"));
    public OutputTests() => Directory.CreateDirectory(_root);

    private PhotoRecord Photo(string path) => new(1, Path.GetFileName(path), path, "线路", "#001");
    private static DefectMark Mark() => new(1, 1, .25, .25, .5, .5, 10, "杆塔", "_杆塔-倾斜", "DefectFound");

    [Fact]
    public async Task Output_has_original_dimensions_red_outline_and_unchanged_original()
    {
        var source = Path.Combine(_root, "照片.png");
        using (var image = new Image<Rgba32>(400, 200, Color.White)) await image.SaveAsPngAsync(source);
        var before = await File.ReadAllBytesAsync(source);
        var output = await new OutputService().SaveAsync(Photo(source), [Mark()], Path.Combine(_root, "out"));
        using var boxed = await Image.LoadAsync<Rgba32>(output.BoxedPath);
        Assert.Equal(400, boxed.Width);
        Assert.Equal(200, boxed.Height);
        Assert.Equal(new Rgba32(255, 0, 0), boxed[100, 80]);
        Assert.Equal(new Rgba32(255, 0, 0), boxed[103, 80]);
        Assert.Equal(new Rgba32(255, 255, 255), boxed[110, 80]);
        Assert.Equal(before, await File.ReadAllBytesAsync(output.OriginalPath));
        Assert.Equal(before, await File.ReadAllBytesAsync(source));
        Assert.Equal("照片_杆塔-倾斜.png", Path.GetFileName(output.BoxedPath));
        Assert.Empty(Directory.GetFiles(_root, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Broken_image_does_not_leave_a_partial_pair()
    {
        var source = Path.Combine(_root, "坏图.jpg");
        await File.WriteAllTextAsync(source, "not an image");
        var output = Path.Combine(_root, "out");
        await Assert.ThrowsAnyAsync<Exception>(() => new OutputService().SaveAsync(Photo(source), [Mark()], output));
        Assert.Empty(Directory.GetFiles(output, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Cancellation_does_not_commit_files()
    {
        var source = Path.Combine(_root, "照片.png");
        using (var image = new Image<Rgba32>(40, 40)) await image.SaveAsPngAsync(source);
        var output = Path.Combine(_root, "out");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new OutputService().SaveAsync(Photo(source), [Mark()], output, new CancellationToken(true)));
        Assert.Empty(Directory.GetFiles(output, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Existing_original_is_never_overwritten_by_name_allocation()
    {
        var source = Path.Combine(_root, "照片.png");
        using (var image = new Image<Rgba32>(40, 40)) await image.SaveAsPngAsync(source);
        var output = Path.Combine(_root, "out");
        var directory = Path.Combine(output, "缺陷原图", "其他缺陷");
        Directory.CreateDirectory(directory);
        var existing = Path.Combine(directory, "照片_杆塔-倾斜.png");
        await File.WriteAllTextAsync(existing, "keep");
        var saved = await new OutputService().SaveAsync(Photo(source), [Mark()], output);
        Assert.Equal("keep", await File.ReadAllTextAsync(existing));
        Assert.Equal("照片_杆塔-倾斜_2.png", Path.GetFileName(saved.BoxedPath));
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);
}
