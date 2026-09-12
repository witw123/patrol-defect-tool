using Microsoft.UI.Xaml.Media.Imaging;

namespace PatrolDefect.App;

// 图片解码缓存：容量按与当前照片的距离淘汰（原版 CACHE_LIMIT=4），
// 单路预加载相邻照片，切图换代后过期任务直接丢弃，防止缓存挤出当前有用图片。
internal sealed class ImageCache
{
    private const int Limit = 4;
    private const int KeepDistance = 2;

    private sealed record Entry(BitmapImage Image, int Index);

    private readonly Dictionary<string, Entry> _entries = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Task<BitmapImage?>> _inFlight = new(StringComparer.OrdinalIgnoreCase);
    private int _currentIndex = -1;
    private int _generation;

    public Task<BitmapImage?> GetAsync(string path, int index) => GetCoreAsync(path, index, primary: true);

    public void SetCurrentIndex(int index)
    {
        _currentIndex = index;
        _generation++;
        Evict();
    }

    public void Clear()
    {
        _generation++;
        _entries.Clear();
        _currentIndex = -1;
    }

    // 相邻照片预加载：主加载换代后旧队列自动失效。
    public async Task PreloadAsync(IReadOnlyList<(string Path, int Index)> requests)
    {
        var generation = _generation;
        foreach (var (path, index) in requests)
        {
            if (generation != _generation) return;
            if (_entries.ContainsKey(path) || _inFlight.ContainsKey(path)) continue;
            await GetCoreAsync(path, index, primary: false);
        }
    }

    private async Task<BitmapImage?> GetCoreAsync(string path, int index, bool primary)
    {
        if (_entries.TryGetValue(path, out var cached)) return cached.Image;
        if (_inFlight.TryGetValue(path, out var running)) return await running;
        var task = DecodeAsync(path, index, primary);
        _inFlight[path] = task;
        try
        {
            return await task;
        }
        finally
        {
            _inFlight.Remove(path);
        }
    }

    private async Task<BitmapImage?> DecodeAsync(string path, int index, bool primary)
    {
        try
        {
            var bitmap = new BitmapImage();
            var stream = await Task.Run(() => File.OpenRead(path));
            await using (stream)
            {
                await bitmap.SetSourceAsync(stream.AsRandomAccessStream());
            }
            // 原版内存防线：解码完成时用户已大幅切走（>2 张）则不入缓存。
            if (!primary && _currentIndex >= 0 && Math.Abs(index - _currentIndex) > KeepDistance)
                return null;
            _entries[path] = new Entry(bitmap, index);
            Evict();
            return bitmap;
        }
        catch
        {
            return null;
        }
    }

    private void Evict()
    {
        if (_entries.Count <= Limit) return;
        foreach (var victim in _entries.OrderByDescending(x => Math.Abs(x.Value.Index - _currentIndex)).ToArray())
        {
            if (_entries.Count <= Limit) break;
            if (victim.Value.Index == _currentIndex) continue;
            _entries.Remove(victim.Key);
        }
    }
}
