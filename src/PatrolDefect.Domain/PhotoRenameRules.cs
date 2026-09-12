using System.Globalization;

namespace PatrolDefect.Domain;

// 与原版 HTML computeNewFileName 对齐：重命名照片时仅替换部件部分，保留线路杆塔前缀。
public static class PhotoRenameRules
{
    public static string ComputeNewFileName(string oldFileName, string oldLocation, string newLocationInput)
    {
        var dot = oldFileName.LastIndexOf('.');
        var extension = dot >= 0 ? oldFileName[dot..] : "";
        var stem = dot >= 0 ? oldFileName[..dot] : oldFileName;

        var input = (newLocationInput ?? "").Trim();
        if (input.Length > 0 && extension.Length > 0 &&
            input.EndsWith(extension, StringComparison.OrdinalIgnoreCase))
            input = input[..^extension.Length].Trim();
        if (input.Length == 0) return oldFileName;

        if (input.Contains("__") || TryFullPrefix(stem, input))
            return input + extension;

        var location = (oldLocation ?? "").Trim();
        if (location.Length > 0)
        {
            var index = stem.LastIndexOf(location, StringComparison.Ordinal);
            if (index >= 0)
                return string.Concat(stem.AsSpan(0, index), input.AsSpan(), stem.AsSpan(index + location.Length),
                    extension.AsSpan());
        }

        var doubleIndex = stem.LastIndexOf("__", StringComparison.Ordinal);
        if (doubleIndex >= 0) return stem[..(doubleIndex + 2)] + input + extension;

        var singleIndex = stem.LastIndexOf('_');
        if (singleIndex >= 0) return stem[..(singleIndex + 1)] + input + extension;

        return input + extension;
    }

    // 输入已包含完整前缀（与原名第一个下划线前的部分一致）时直接使用。
    private static bool TryFullPrefix(string stem, string input)
    {
        var index = stem.IndexOf('_');
        if (index < 0) return false;
        var prefix = stem[..(index + 1)];
        return prefix.Length > 0 && input.StartsWith(prefix, StringComparison.Ordinal);
    }

    public static bool ContainsInvalidCharacters(string fileName) =>
        fileName.IndexOfAny(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) >= 0;

    public static string? Validate(string oldFileName, string newFileName, string oldRelativeDirectory,
        IEnumerable<string> siblingFiles)
    {
        if (newFileName == oldFileName) return "名称未变化。";
        if (ContainsInvalidCharacters(newFileName))
            return "图片名称不能包含下列字符: \\ / : * ? \" < > |";
        var clash = siblingFiles.Any(other => string.Equals(
            Path.GetFileName(other), newFileName, StringComparison.OrdinalIgnoreCase));
        return clash ? $"该杆塔目录下已存在同名图片【{newFileName}】，请换一个名称" : null;
    }
}
