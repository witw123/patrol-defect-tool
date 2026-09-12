using System.Globalization;
using System.Numerics;
using System.Text.RegularExpressions;

namespace PatrolDefect.Domain;

public static class SectionRules
{
    public static bool IsRange(string text) =>
        text.Count(c => c == '#') >= 2 ||
        Regex.IsMatch(text, @"^#?[0-9]{2,}[-_~]#?[0-9]{2,}$") ||
        Regex.IsMatch(text, @"^#?[0-9]+[-_][0-9]+[-_~]#?[0-9]+");

    public static string Suggest(string tower, string nextTower = "")
    {
        if (nextTower.Length > 0 && tower.Length > 0 && tower != nextTower &&
            tower != "默认杆塔" && nextTower != "默认杆塔")
            return Prefix(tower) + "-" + Prefix(nextTower);
        if (tower.Length == 0 || tower == "默认杆塔") return "#001-#002";
        if (IsRange(tower)) return tower;
        var prefix = tower.StartsWith('#') ? "#" : "";
        var sub = Regex.Match(tower, @"^#?([0-9]+)[-_]([0-9]+)$");
        if (sub.Success)
        {
            var main = sub.Groups[1].Value;
            var number = BigInteger.Parse(sub.Groups[2].Value, CultureInfo.InvariantCulture);
            return $"{prefix}{main}-{number}-{prefix}{main}-{number + 1}";
        }
        var single = Regex.Match(tower, @"^#?([0-9]+)([A-Za-z]?)$");
        if (single.Success)
        {
            var digits = single.Groups[1].Value;
            var suffix = single.Groups[2].Value;
            var next = (BigInteger.Parse(digits, CultureInfo.InvariantCulture) + 1)
                .ToString(CultureInfo.InvariantCulture).PadLeft(digits.Length, '0');
            return $"{prefix}{digits}{suffix}-{prefix}{next}{suffix}";
        }
        return tower + "-";
    }

    public static string CustomBase(string name, string section, ParsedPhotoPath parsed)
    {
        if (name.Length == 0) return "";
        var dot = name.LastIndexOf('.');
        var raw = dot < 0 ? name[..^1] : name[..dot];
        section = section.Trim();
        if (section.Length == 0) return raw;
        var range = new Regex(@"#?[0-9]+(?:[-_][0-9]+)?[-_~]#?[0-9]+(?:[-_][0-9]+)?");
        if (range.IsMatch(raw)) return range.Replace(raw, _ => section, 1);
        if (parsed.TowerName != "默认杆塔" && raw.Contains(parsed.TowerName))
        {
            var index = raw.IndexOf(parsed.TowerName, StringComparison.Ordinal);
            return raw[..index] + section + raw[(index + parsed.TowerName.Length)..];
        }
        var bare = parsed.TowerName.TrimStart('#');
        if (bare.Length > 0)
        {
            var segment = new Regex(@"([_\s])#?" + Regex.Escape(bare) + @"([_\s]|$)", RegexOptions.IgnoreCase);
            if (segment.IsMatch(raw))
                return segment.Replace(raw, m => m.Groups[1].Value + section + m.Groups[2].Value, 1);
        }
        if (parsed.LineName.Length > 0 && parsed.LineName != "默认线路")
            return parsed.LineName + "_" + section + (parsed.Location.Length > 0 ? "_" + parsed.Location : "_" + raw);
        return section + "_" + raw;
    }

    private static string Prefix(string text) => text.StartsWith('#') ? text : "#" + text;
}
