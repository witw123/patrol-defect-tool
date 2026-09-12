using PatrolDefect.Domain;

namespace PatrolDefect.Infrastructure;

public sealed record BatchResult(int Success, int Failed, IReadOnlyList<string> Errors);

public sealed class BatchOutputService
{
    private static readonly string[] Categories = [DefectCategoryRule.Insulation, DefectCategoryRule.Other];

    public async Task<BatchResult> ClassifyAsync(string outputRoot, CancellationToken cancellationToken = default,
        Action<int, int>? progress = null)
    {
        var errors = new List<string>();
        var success = 0;
        var boxedRoot = Path.Combine(outputRoot, "缺陷圈示图");
        if (!Directory.Exists(boxedRoot)) return new(0, 0, []);
        foreach (var category in Categories)
        {
            var source = Path.Combine(boxedRoot, category);
            var target = Path.Combine(outputRoot, category);
            if (!Directory.Exists(source)) continue;
            Directory.CreateDirectory(target);
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var destination = Path.Combine(target, Path.GetFileName(file));
                    await using var input = File.OpenRead(file);
                    await using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None);
                    await input.CopyToAsync(output, cancellationToken);
                    success++;
                }
                catch (Exception error) { errors.Add($"{file}: {error.Message}"); }
                progress?.Invoke(success, errors.Count);
            }
        }
        return new(success, errors.Count, errors);
    }

    public async Task<BatchResult> CompleteOriginalsAsync(string inputRoot, string outputRoot,
        CancellationToken cancellationToken = default, Action<int, int>? progress = null)
    {
        var errors = new List<string>();
        var success = 0;
        var boxedRoot = Path.Combine(outputRoot, "缺陷圈示图");
        if (!Directory.Exists(boxedRoot)) return new(0, 0, []);
        var inputs = Directory.EnumerateFiles(inputRoot, "*", SearchOption.AllDirectories)
            .Where(x => !PathRules.IsOutputArtifact(Path.GetRelativePath(inputRoot, x)))
            .ToDictionary(x => Path.GetFileName(x), StringComparer.OrdinalIgnoreCase);
        foreach (var category in Categories)
        {
            var source = Path.Combine(boxedRoot, category);
            if (!Directory.Exists(source)) continue;
            var target = Path.Combine(outputRoot, "缺陷原图", category);
            Directory.CreateDirectory(target);
            foreach (var boxed in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var name = Path.GetFileName(boxed);
                    if (!inputs.TryGetValue(name, out var original)) continue;
                    var destination = Path.Combine(target, name);
                    if (File.Exists(destination)) continue;
                    await using var input = File.OpenRead(original);
                    await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    await input.CopyToAsync(output, cancellationToken);
                    success++;
                }
                catch (Exception error) { errors.Add($"{boxed}: {error.Message}"); }
                progress?.Invoke(success, errors.Count);
            }
        }
        return new(success, errors.Count, errors);
    }

    // 规范命名前的预览：只计算待重命名清单，不做任何修改。
    public IReadOnlyList<(string OldPath, string NewPath)> PlanCleanOutputNames(string outputRoot)
    {
        var plan = new List<(string, string)>();
        foreach (var directory in new[] { "缺陷圈示图", "缺陷原图", "危急缺陷" })
        {
            var root = Path.Combine(outputRoot, directory);
            if (!Directory.Exists(root)) continue;
            foreach (var oldPath in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToArray())
            {
                var clean = FileNameRules.Clean(Path.GetFileName(oldPath));
                if (clean == Path.GetFileName(oldPath)) continue;
                var newPath = Path.Combine(Path.GetDirectoryName(oldPath)!, clean);
                if (File.Exists(newPath)) continue;
                plan.Add((oldPath, newPath));
            }
        }
        return plan;
    }

    public Task<BatchResult> CleanOutputNamesAsync(string outputRoot,
        CancellationToken cancellationToken = default, Action<int, int>? progress = null)
    {
        var changed = 0;
        var failed = 0;
        var errors = new List<string>();
        foreach (var directory in new[] { "缺陷圈示图", "缺陷原图", "危急缺陷" })
        {
            var root = Path.Combine(outputRoot, directory);
            if (!Directory.Exists(root)) continue;
            foreach (var oldPath in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).ToArray())
            {
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var clean = FileNameRules.Clean(Path.GetFileName(oldPath));
                    if (clean == Path.GetFileName(oldPath)) continue;
                    var newPath = Path.Combine(Path.GetDirectoryName(oldPath)!, clean);
                    if (File.Exists(newPath)) continue;
                    File.Move(oldPath, newPath);
                    changed++;
                }
                catch (Exception error) { failed++; errors.Add($"{oldPath}: {error.Message}"); }
                progress?.Invoke(changed, failed);
            }
        }
        return Task.FromResult(new BatchResult(changed, failed, errors));
    }
}
