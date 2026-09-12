using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;
using PatrolDefect.Domain;

namespace PatrolDefect.Application;

public sealed class PhotoComparer : IComparer<PhotoRecord>
{
    public static PhotoComparer Instance { get; } = new();
    private static readonly CollatorHandle Collator = CreateCollator();
    private static readonly object CollatorLock = new();

    public int Compare(PhotoRecord? a, PhotoRecord? b)
    {
        if (ReferenceEquals(a, b)) return 0;
        if (a is null) return -1;
        if (b is null) return 1;
        var result = NaturalCompare(a.LineName, b.LineName);
        if (result != 0) return result;
        result = TowerNumber(a.TowerName).CompareTo(TowerNumber(b.TowerName));
        if (result != 0) return result;
        result = NaturalCompare(a.TowerName, b.TowerName);
        if (result != 0) return result;
        result = NaturalCompare(DirectoryOf(a.RelativePath), DirectoryOf(b.RelativePath));
        if (result != 0) return result;
        return NaturalCompare(NameOf(a.RelativePath), NameOf(b.RelativePath));
    }

    private static double TowerNumber(string tower)
    {
        var match = Regex.Match(tower, "[0-9]+");
        return match.Success ? double.Parse(match.Value, System.Globalization.CultureInfo.InvariantCulture) : 999999;
    }

    private static string DirectoryOf(string path)
    {
        var normalized = path.Replace('\\', '/');
        var separator = normalized.LastIndexOf('/');
        return separator < 0 ? "" : normalized[..separator];
    }

    private static string NameOf(string path) => path.Replace('\\', '/').Split('/')[^1];

    private static int NaturalCompare(string left, string right)
    {
        lock (CollatorLock)
            return ucol_strcoll(Collator, left, left.Length, right, right.Length);
    }

    private static CollatorHandle CreateCollator()
    {
        var status = 0;
        var handle = new CollatorHandle(ucol_open("zh_CN@colNumeric=yes;colStrength=primary", ref status));
        if (status > 0 || handle.IsInvalid)
        {
            handle.Dispose();
            throw new InvalidOperationException($"ICU collation initialization failed: {status}");
        }
        return handle;
    }

    private sealed class CollatorHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public CollatorHandle(IntPtr pointer) : base(true) => SetHandle(pointer);
        protected override bool ReleaseHandle() { ucol_close(handle); return true; }
    }

    [DllImport("icuin.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern IntPtr ucol_open([MarshalAs(UnmanagedType.LPStr)] string locale, ref int status);

    [DllImport("icuin.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true)]
    private static extern void ucol_close(IntPtr collator);

    [DllImport("icuin.dll", CallingConvention = CallingConvention.Cdecl, ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int ucol_strcoll(CollatorHandle collator, string left, int leftLength,
        string right, int rightLength);
}
