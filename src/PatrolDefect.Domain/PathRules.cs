using System.Text.RegularExpressions;

namespace PatrolDefect.Domain;

public static class PathRules
{
    private const string TowerPattern = @"(?:#\s*[0-9]+(?:[-~_][0-9]+|[A-Za-z])?(?:[-~_]#?\s*[0-9]+(?:[-~_][0-9]+|[A-Za-z])*)?(?:号?[杆塔基]|#)?|[0-9]+\s*#\s*(?:号?[杆塔基])(?!(?:支线|主线|联络线|专线|回线|线路|线))|[0-9]+\s*#(?![\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#]*(?:支线|主线|联络线|专线|回线|线路|线))|[0-9]+\s*号(?:杆塔|[杆塔基])|[0-9]+\s*(?:杆塔|[杆塔基])|第\s*[0-9]+(?:[-~_][0-9]+|[A-Za-z])?\s*号?[杆塔基]|[0-9]+[-~_][0-9]+(?:号?[杆塔基]|跨|档)|(?:[PTGNptgn]|Tower|Pole)\s*[-_]?\s*[0-9]+(?:[-~_][0-9]+|[A-Za-z])?|^[0-9]+(?:[-_][0-9]+)?$)";
    private const string LinePattern = @"(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|工程)";
    private const string VoltagePattern = @"(?:10|35|110|220|500|750|1000)\s*(?:k|kV|KV|千伏)";
    private static readonly Regex TowerRegex = new(TowerPattern, RegexOptions.IgnoreCase);

    public static bool IsTowerFolderName(string name)
    {
        var text = name.Trim();
        if (text.Length == 0) return false;
        if (Regex.IsMatch(text, @"^(?:DCIM|[0-9]+MEDIA|PANORAMA|PANO|可见光|红外|红外测温|测温|细部|全景|通道|无人机|照片|图片|待检|未检|新建文件夹|其他|其它)$", RegexOptions.IgnoreCase))
            return false;
        if (Regex.IsMatch(text, LinePattern) || Regex.IsMatch(text, VoltagePattern, RegexOptions.IgnoreCase))
            return false;
        return TowerRegex.IsMatch(text);
    }

    public static ParsedPhotoPath Parse(string rootPath, string fullPath)
    {
        var relative = Path.GetRelativePath(rootPath, fullPath);
        var rootName = Path.GetFileName(Path.TrimEndingDirectorySeparator(rootPath));
        return ParseRelative(rootName.Length > 0 ? rootName : "默认线路", relative);
    }

    // 目录（无文件名）解析：与原版 extractLineAndTowerFromDirParts 一致，不做文件名兜底。
    public static ParsedPhotoPath ParseDirectory(string rootName, string relativeDirectory)
    {
        var parts = relativeDirectory.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        var directories = parts;
        var line = rootName;
        var tower = "";
        var towerIndex = Array.FindLastIndex(directories, IsTowerFolderName);
        if (towerIndex >= 0)
        {
            tower = directories[towerIndex].Trim();
            if (towerIndex > 0) line = directories[towerIndex - 1].Trim();
        }
        else if (directories.Length > 0)
        {
            var last = directories[^1].Trim();
            if (Regex.IsMatch(last, LinePattern) || Regex.IsMatch(last, VoltagePattern, RegexOptions.IgnoreCase))
                line = last;
            else if (directories.Length >= 2)
                line = directories[0].Trim();
        }
        return new ParsedPhotoPath(line.Length > 0 ? line : rootName, tower, relativeDirectory, "");
    }

    public static ParsedPhotoPath ParseRelative(string rootName, string relative)
    {
        var parts = relative.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        var directories = parts.SkipLast(1).ToArray();
        var fileName = parts.LastOrDefault() ?? "";
        var stem = Regex.Replace(fileName, @"\.[^.]+$", "");
        var line = rootName;
        var tower = "";
        var towerIndex = Array.FindLastIndex(directories, IsTowerFolderName);
        if (towerIndex >= 0)
        {
            tower = directories[towerIndex].Trim();
            if (towerIndex > 0) line = directories[towerIndex - 1].Trim();
        }
        else if (directories.Length > 0)
        {
            var last = directories[^1].Trim();
            if (Regex.IsMatch(last, LinePattern) || Regex.IsMatch(last, VoltagePattern, RegexOptions.IgnoreCase))
                line = last;
            else if (directories.Length >= 2)
                line = directories[0].Trim();
        }

        if (tower.Length == 0 || tower == "默认杆塔")
        {
            var camera = Regex.IsMatch(stem, @"^(?:DJI|IMG|DSC|DCIM|PANO|VID|SCREENSHOT|QQ图片|微信图片)", RegexOptions.IgnoreCase);
            var segments = Regex.Split(stem, @"[_\s]+").Where(x => x.Length > 0).ToArray();
            for (var index = 0; index < segments.Length; index++)
            {
                var segment = segments[index];
                var match = TowerRegex.Match(segment);
                if (match.Success && (match.Value == segment || Regex.IsMatch(segment, @"^[#PTGN0-9]", RegexOptions.IgnoreCase)))
                {
                    tower = Regex.Replace(match.Value, @"\s+", "");
                    break;
                }
                if (!camera && index <= 1 && Regex.IsMatch(segment, @"^[0-9]+$"))
                {
                    tower = "#" + segment.PadLeft(2, '0');
                    break;
                }
            }
            if (tower.Length == 0)
            {
                var match = TowerRegex.Match(stem);
                if (match.Success) tower = Regex.Replace(match.Value, @"\s+", "");
            }
        }
        if (line.Length == 0 || line == "默认线路")
        {
            var cleaned = Regex.Replace(stem, @"(?:导线|避雷线|接地线|地线|引流线|拉线|跳线)(?:线夹|绑带|连接)?", "");
            const string characters = @"[\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]";
            var voltage = Regex.Match(cleaned, VoltagePattern + characters + "*?(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|线|工程)", RegexOptions.IgnoreCase);
            var generic = Regex.Match(cleaned, characters + "{2,}?" + LinePattern);
            line = voltage.Success ? voltage.Value.Trim() : generic.Success ? generic.Value.Trim() : rootName;
        }
        if (tower.Length == 0) tower = "默认杆塔";
        var location = stem;
        if (line.Length > 0 && line != "默认线路") location = location.Replace(line, "");
        if (tower != "默认杆塔") location = location.Replace(tower, "");
        location = Regex.Replace(location, @"^10k[Vv]?[\u4e00-\u9fa5\u2160-\u217f0-9_#\-]+?__", "", RegexOptions.IgnoreCase);
        location = Regex.Replace(location, @"^[_\-—\s#]+|[_\-—\s#]+$", "").Trim();
        return new ParsedPhotoPath(line, tower, relative, location.Length > 0 ? location : stem);
    }

    public static bool IsOutputArtifact(string relativePath)
    {
        var parts = relativePath.Split(
            [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
            StringSplitOptions.RemoveEmptyEntries);
        return parts.Any(x => x is "缺陷圈示图" or "缺陷原图" or "危急缺陷" or "全绝缘缺陷" or "其他缺陷");
    }

    public static bool ShouldSkipDirectory(string name) =>
        name.StartsWith('.') || IsOutputArtifact(name);
}
