namespace PatrolDefect.Domain;

public static class FileNameRules
{
    public static string Build(string originalName, IEnumerable<DefectMark> marks)
    {
        var tags = marks.Select(x => x.DefectTag.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.Ordinal);
        return Preview(originalName, tags);
    }

    public static string Preview(string originalName, IEnumerable<string> appended,
        string section = "", ParsedPhotoPath? parsed = null)
    {
        if (originalName.Length == 0) return "";
        var dot = originalName.LastIndexOf('.');
        var extension = dot < 0 ? originalName[^1..] : originalName[dot..];
        var stem = SectionRules.CustomBase(originalName, section,
            parsed ?? new ParsedPhotoPath("默认线路", "默认杆塔", originalName));
        return stem + string.Concat(appended) + extension;
    }

    public static string Clean(string fileName)
    {
        var dot = fileName.LastIndexOf('.');
        if (dot < 0) return fileName;
        var extension = fileName[dot..];
        var parts = fileName[..dot].Split('_').ToList();
        // Match cleanDefectFileName: only the designated component/sequence is cleaned.
        const string sequence = @"[\s（\(【\[#\-_]*[0-9一二三四五六七八九十]+[\s）\)】\]#\-_]*";
        static string TrimSequence(string text) =>
            System.Text.RegularExpressions.Regex.Replace(text, sequence + "$", "");
        static bool IsSequence(string text) =>
            System.Text.RegularExpressions.Regex.IsMatch(text, "^" + sequence + "$");
        if (parts.Count >= 3)
        {
            parts[2] = TrimSequence(parts[2]);
            if (parts.Count >= 4 && IsSequence(parts[3])) parts.RemoveAt(3);
        }
        else if (parts.Count == 2)
        {
            if (IsSequence(parts[1])) parts.RemoveAt(1);
            else parts[1] = TrimSequence(parts[1]);
        }
        else
        {
            parts[0] = TrimSequence(parts[0]);
        }
        return string.Join("_", parts) + extension;
    }
}
