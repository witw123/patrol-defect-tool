using PatrolDefect.Domain;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;

namespace PatrolDefect.Infrastructure;

public sealed class OutputService
{
    public async Task<(string BoxedPath, string OriginalPath)> SaveAsync(
        PhotoRecord photo, IEnumerable<DefectMark> marks, string outputRoot, CancellationToken cancellationToken = default,
        string? outputName = null, IReadOnlyList<string>? tags = null)
    {
        var list = marks.ToArray();
        var category = DefectCategoryRule.GetCategory(string.Join(" ", list.Select(x => x.DefectTag)), tags,
            Path.GetFileName(photo.FullPath), outputName ?? "");
        var boxedDir = Path.Combine(outputRoot, "缺陷圈示图", category);
        var originalDir = Path.Combine(outputRoot, "缺陷原图", category);
        Directory.CreateDirectory(boxedDir);
        Directory.CreateDirectory(originalDir);

        var name = outputName ?? FileNameRules.Build(photo.RelativePath, list);
        if (name != Path.GetFileName(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new InvalidOperationException("成果名称包含无效字符。");
        var baseName = Path.GetFileNameWithoutExtension(name);
        var extension = Path.GetExtension(photo.FullPath);
        var boxedPath = NextPath(boxedDir, originalDir, baseName, extension);
        var originalPath = Path.Combine(originalDir, Path.GetFileName(boxedPath));
        var token = Guid.NewGuid().ToString("N");
        var boxedTemp = Path.Combine(boxedDir, "." + token + ".tmp");
        var originalTemp = Path.Combine(originalDir, "." + token + ".tmp");
        var committedOriginal = false;
        try
        {
        if (list.Length == 0)
        {
            await using var source = File.OpenRead(photo.FullPath);
            await using var target = File.Create(boxedTemp);
            await source.CopyToAsync(target, cancellationToken);
        }
        else using (var image = await Image.LoadAsync<Rgba32>(photo.FullPath, cancellationToken))
        {
            foreach (var mark in list)
            {
                var rect = new RectangleF(
                    (float)(mark.X * image.Width),
                    (float)(mark.Y * image.Height),
                    (float)(mark.Width * image.Width),
                    (float)(mark.Height * image.Height));
                image.Mutate(ctx => ctx.Draw(Color.Red, (float)mark.StrokeWidth, rect));
            }
            IImageEncoder encoder = extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
                ? new PngEncoder() : new JpegEncoder { Quality = 95 };
            await image.SaveAsync(boxedTemp, encoder, cancellationToken);
        }
        await using (var source = File.OpenRead(photo.FullPath))
        await using (var target = new FileStream(originalTemp, FileMode.CreateNew, FileAccess.Write))
            await source.CopyToAsync(target, cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        File.Move(originalTemp, originalPath);
        committedOriginal = true;
        File.Move(boxedTemp, boxedPath);
        return (boxedPath, originalPath);
        }
        catch
        {
            if (committedOriginal) File.Delete(originalPath);
            throw;
        }
        finally
        {
            File.Delete(originalTemp);
            File.Delete(boxedTemp);
        }
    }

    private static string NextPath(string boxedDirectory, string originalDirectory, string name, string extension)
    {
        for (var i = 1; ; i++)
        {
            var fileName = i == 1 ? name + extension : $"{name}_{i}{extension}";
            var candidate = Path.Combine(boxedDirectory, fileName);
            if (!File.Exists(candidate) && !File.Exists(Path.Combine(originalDirectory, fileName))) return candidate;
        }
    }

    // 原版 saveCriticalOnly：仅将当前圈示图独立保存到「危急缺陷」，使用命名预览全名直接覆盖。
    public async Task<string> SaveCriticalOnlyAsync(PhotoRecord photo, IReadOnlyList<DefectMark> marks,
        string outputRoot, string outputName, CancellationToken cancellationToken = default)
    {
        var criticalDirectory = Path.Combine(outputRoot, "危急缺陷");
        Directory.CreateDirectory(criticalDirectory);
        var name = string.IsNullOrWhiteSpace(outputName)
            ? FileNameRules.Build(photo.RelativePath, marks.ToArray()) : outputName.Trim();
        if (name != Path.GetFileName(name) || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
            throw new InvalidOperationException("危急成果名称包含无效字符。");
        var extension = Path.GetExtension(photo.FullPath);
        if (!Path.HasExtension(name)) name += extension;
        var target = Path.Combine(criticalDirectory, name);
        var token = Guid.NewGuid().ToString("N");
        var temp = Path.Combine(criticalDirectory, "." + token + ".tmp");
        try
        {
            if (marks.Count == 0)
            {
                await using var source = File.OpenRead(photo.FullPath);
                await using var writer = File.Create(temp);
                await source.CopyToAsync(writer, cancellationToken);
            }
            else using (var image = await Image.LoadAsync<Rgba32>(photo.FullPath, cancellationToken))
            {
                foreach (var mark in marks)
                {
                    var rect = new RectangleF(
                        (float)(mark.X * image.Width),
                        (float)(mark.Y * image.Height),
                        (float)(mark.Width * image.Width),
                        (float)(mark.Height * image.Height));
                    image.Mutate(ctx => ctx.Draw(Color.Red, (float)mark.StrokeWidth, rect));
                }
                IImageEncoder encoder = extension.Equals(".png", StringComparison.OrdinalIgnoreCase)
                    ? new PngEncoder() : new JpegEncoder { Quality = 95 };
                await image.SaveAsync(temp, encoder, cancellationToken);
            }
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(temp, target, overwrite: true);
            return target;
        }
        finally
        {
            File.Delete(temp);
        }
    }
}
