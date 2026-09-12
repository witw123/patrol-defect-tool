using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;
using IoPath = System.IO.Path;

namespace PatrolDefect.App;

// 目录树渲染：线路/杆塔/照片三级统计徽章 + 双击重命名（对照原版 refreshTreeStats 与
// performRenameLineFolder / performRenameTowerFolder / performRenamePhoto）。
public sealed partial class MainWindow
{
    private IReadOnlyDictionary<long, int> _markCounts = new Dictionary<long, int>();
    private object? _lastInvoked;
    private long _lastInvokeTick;

    private void RenderTree()
    {
        PhotoTree.RootNodes.Clear();
        _markCounts = _store?.LoadMarkCounts() ?? new Dictionary<long, int>();
        var filtered = _photos.Where(IsVisible).ToArray();
        var towers = new Dictionary<string, Dictionary<string, List<PhotoRecord>>>();
        foreach (var group in filtered.GroupBy(photo => photo.LineName))
        {
            var map = new Dictionary<string, List<PhotoRecord>>();
            foreach (var tower in group.GroupBy(photo => photo.TowerName))
                map[tower.Key] = tower.ToList();
            towers[group.Key] = map;
        }
        // 原版 discoveredDirs：空杆塔文件夹同样显示在目录树中，保证杆塔数与实际一致。
        if (_root is not null)
        {
            var rootName = IoPath.GetFileName(Path.TrimEndingDirectorySeparator(_root));
            foreach (var directory in _discoveredDirs)
            {
                if (PathRules.IsOutputArtifact(directory)) continue;
                var parsed = PathRules.ParseDirectory(rootName, directory);
                if (parsed.TowerName.Length == 0 || !PathRules.IsTowerFolderName(parsed.TowerName)) continue;
                if (!towers.TryGetValue(parsed.LineName, out var map))
                    towers[parsed.LineName] = map = [];
                if (!map.TryGetValue(parsed.TowerName, out var list))
                    map[parsed.TowerName] = list = [];
            }
        }
        foreach (var lineEntry in towers)
        {
            var lineStats = LineSummary(lineEntry.Key, filtered);
            var line = new TreeViewNode { Content = new LineNode(lineEntry.Key, lineStats) };
            foreach (var towerEntry in lineEntry.Value)
            {
                var towerStats = TowerSummary(lineEntry.Key, towerEntry.Key, filtered);
                var towerNode = new TreeViewNode { Content = new TowerNode(lineEntry.Key, towerEntry.Key, towerStats) };
                foreach (var photo in towerEntry.Value)
                    towerNode.Children.Add(new TreeViewNode { Content = new PhotoNode(photo, PhotoLabel(photo)) });
                line.Children.Add(towerNode);
            }
            PhotoTree.RootNodes.Add(line);
        }
        UpdateSummary();
        UpdateCounter();
        StatusText.Text = $"显示 {filtered.Length}/{_photos.Count} 张照片";
    }

    // 原版 autoFitLeftPanelWidth：按最长名称估算左栏宽度（中文字宽近似 12px，其余 7px）。
    private void AutoFitLeftWidth()
    {
        var maxWidth = 0d;
        foreach (var photo in _photos)
            maxWidth = Math.Max(maxWidth, EstimateWidth(photo.RelativePath));
        foreach (var line in _photos.Select(photo => photo.LineName).Distinct())
            maxWidth = Math.Max(maxWidth, EstimateWidth(line));
        maxWidth += 130;
        var windowWidth = RootGrid.ActualWidth > 0 ? RootGrid.ActualWidth : 1280;
        var optimal = Math.Clamp(maxWidth, 280, Math.Max(300, windowWidth * 0.55));
        LeftColumn.Width = new GridLength(Math.Ceiling(optimal));
    }

    private static double EstimateWidth(string text) => text.Sum(character =>
        character > 0x2E80 ? 12.0 : char.IsAsciiLetterOrDigit(character) ? 6.8 : 8.0);

    // 原版 updateHud 的位置计数：筛选时显示筛选集合内位置与总数。
    private void UpdateCounter()
    {
        if (CounterText is null) return;
        if (_currentPhoto is null || _photos.Count == 0)
        {
            CounterText.Text = "— / —";
            return;
        }
        var currentIndex = _indexById.GetValueOrDefault(_currentPhoto.Id, -1);
        if (_filter == "all")
        {
            CounterText.Text = currentIndex >= 0 ? $"{currentIndex + 1} / {_photos.Count}" : "— / —";
            return;
        }
        var filtered = _photos.Where(IsVisible).ToList();
        var position = filtered.FindIndex(photo => photo.Id == _currentPhoto.Id);
        var label = _filter switch { "marked" => "已标记", "unmarked" => "未标记", "unviewed" => "未看", _ => "筛选" };
        CounterText.Text = $"{(position >= 0 ? position + 1 : "—")} / {filtered.Count} [{label}]";
    }

    private string PhotoLabel(PhotoRecord photo)
    {
        var viewed = _viewed.Contains(photo.Id);
        var marked = _marked.Contains(photo.Id);
        var label = photo.RelativePath;
        if (viewed) label += " ✔";
        if (marked) label += _markCounts.TryGetValue(photo.Id, out var count) && count > 1
            ? $" 【已标×{count}】" : " 【已标】";
        if (_critical.Contains(photo.Id)) label += " 【危急】";
        return label;
    }

    private string LineSummary(string line, IEnumerable<PhotoRecord> scope)
    {
        var photos = scope.Where(photo => photo.LineName == line).ToArray();
        var viewed = photos.Count(photo => _viewed.Contains(photo.Id));
        var marked = photos.Count(photo => _marked.Contains(photo.Id));
        return $"{line}（{photos.Length}张 · 已看{viewed} · 已标{marked}）";
    }

    private string TowerSummary(string line, string tower, IEnumerable<PhotoRecord> scope)
    {
        var photos = scope.Where(photo => photo.LineName == line && photo.TowerName == tower).ToArray();
        var viewed = photos.Count(photo => _viewed.Contains(photo.Id));
        var marked = photos.Count(photo => _marked.Contains(photo.Id));
        var defects = photos.Sum(photo => _markCounts.TryGetValue(photo.Id, out var count) ? count : 0);
        var defectText = defects > marked ? $" · {defects}处" : "";
        return $"{tower}（{photos.Length}张 · 已看{viewed} · 已标{marked}{defectText}）";
    }

    private void UpdateSummary()
    {
        if (TreeSummaryText is null) return;
        var viewed = _photos.Count(photo => _viewed.Contains(photo.Id));
        var marked = _photos.Count(photo => _marked.Contains(photo.Id));
        var defects = _markCounts.Values.Sum();
        var towers = _photos.Select(photo => (photo.LineName, photo.TowerName)).Distinct().Count();
        var fullTowers = _photos.GroupBy(photo => (photo.LineName, photo.TowerName))
            .Count(group => group.All(photo => _viewed.Contains(photo.Id)));
        TreeSummaryText.Text = $"共 {_photos.Count} 张 · 已看 {viewed} · 已标 {marked} · 缺陷 {defects} 处 · 杆塔 {towers}（全部已看 {fullTowers}）";
        MarkedStatusText.Text = _currentPhoto is null ? "未标记"
            : (_marked.Contains(_currentPhoto.Id)
                ? $"已标记 ({(_currentBaseIsBoxed ? "圈示图" : "原图")})" : "未标记")
            + (_critical.Contains(_currentPhoto.Id) ? " · 危急" : "")
            + (_dirty ? " · 有未保存修改" : "");
    }

    private async void PhotoTree_ItemInvoked(TreeView sender, TreeViewItemInvokedEventArgs args)
    {
        var content = args.InvokedItem is TreeViewNode node ? node.Content : args.InvokedItem;
        if (content is not (PhotoNode or TowerNode or LineNode))
        {
            if (content is PhotoRecord photo) await LoadPhoto(photo);
            return;
        }
        var tick = Environment.TickCount64;
        if (ReferenceEquals(_lastInvoked, content) && tick - _lastInvokeTick < 700)
        {
            _lastInvoked = null;
            switch (content)
            {
                case PhotoNode photo:
                    await RenamePhotoDialog(photo.Photo);
                    break;
                case TowerNode tower:
                    await RenameTowerDialog(tower);
                    break;
                case LineNode line:
                    await RenameLineDialog(line);
                    break;
            }
            return;
        }
        _lastInvoked = content;
        _lastInvokeTick = tick;
        if (content is PhotoNode selected) await LoadPhoto(selected.Photo);
    }

    private void AutoFitWidth_Click(object sender, RoutedEventArgs e) => AutoFitLeftWidth();

    private void ExpandAll_Click(object sender, RoutedEventArgs e)
    {
        foreach (var line in PhotoTree.RootNodes) line.IsExpanded = true;
    }

    private void CollapseAll_Click(object sender, RoutedEventArgs e)
    {
        foreach (var line in PhotoTree.RootNodes)
        {
            line.IsExpanded = false;
            foreach (var tower in line.Children) tower.IsExpanded = false;
        }
    }

    private async void ResetViewed_Click(object sender, RoutedEventArgs e)
    {
        if (_store is null || _saving || _opening) return;
        var confirm = new ContentDialog
        {
            Title = "重置已看记录",
            Content = "将清除所有照片的已看记录，目录树与统计会同步更新。确定继续吗？",
            PrimaryButtonText = "重置",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = Content.XamlRoot
        };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        _store.ClearViewed();
        _viewed.Clear();
        RenderTree();
        StatusText.Text = "已重置全部已看记录";
        RecordOperation("ResetViewed", "", true, "");
    }

    private ContentDialog RenameDialog(string title, string initial, out TextBox input)
    {
        input = new TextBox { Text = initial };
        return new ContentDialog
        {
            Title = title,
            Content = input,
            PrimaryButtonText = "重命名",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = Content.XamlRoot
        };
    }

    // 原版 computeNewFileName：仅替换部件部分，保留线路与杆塔前缀。
    private async Task RenamePhotoDialog(PhotoRecord photo)
    {
        if (_store is null || _root is null || _saving || _opening) return;
        var parsed = PathRules.Parse(_root, photo.FullPath);
        var dialog = RenameDialog($"重命名照片：{IoPath.GetFileName(photo.FullPath)}",
            parsed.Location, out var input);
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        var oldName = IoPath.GetFileName(photo.FullPath);
        var directory = IoPath.GetDirectoryName(photo.FullPath)!;
        var newFileName = PhotoRenameRules.ComputeNewFileName(oldName, parsed.Location, input.Text);
        var error = PhotoRenameRules.Validate(oldName, newFileName, directory, Directory.EnumerateFiles(directory));
        if (error is not null)
        {
            StatusText.Text = error;
            return;
        }
        var newFullPath = IoPath.Combine(directory, newFileName);
        var newRelative = IoPath.GetRelativePath(_root, newFullPath);
        try
        {
            File.Move(photo.FullPath, newFullPath);
            _store.RenamePhotoPath(photo.Id, newRelative, newFullPath);
        }
        catch (Exception diskError)
        {
            if (File.Exists(newFullPath) && !File.Exists(photo.FullPath))
                try { File.Move(newFullPath, photo.FullPath); } catch { }
            StatusText.Text = $"重命名照片失败：{diskError.Message}";
            RecordOperation("RenamePhoto", photo.RelativePath, false, diskError.ToString());
            return;
        }
        await RescanAfterRename();
        StatusText.Text = $"已重命名照片：{newFileName}";
        RecordOperation("RenamePhoto", newRelative, true, newFileName);
    }

    private async Task RenameTowerDialog(TowerNode tower)
    {
        if (_store is null || _root is null || _saving || _opening) return;
        var dialog = RenameDialog($"重命名杆塔：{tower.Tower}", tower.Tower, out var input);
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var newName = input.Text.Trim();
        if (newName.Length == 0 || newName == tower.Tower)
        {
            StatusText.Text = "名称为空或未变化。";
            return;
        }
        var sample = _photos.FirstOrDefault(photo => photo.LineName == tower.Line && photo.TowerName == tower.Tower);
        if (sample is null) return;
        var towerDirectory = IoPath.GetDirectoryName(sample.FullPath)!;
        if (!string.Equals(IoPath.GetFileName(towerDirectory), tower.Tower, StringComparison.Ordinal))
        {
            StatusText.Text = "该杆塔没有独立文件夹，无法在磁盘上重命名。";
            return;
        }
        var newDirectory = IoPath.Combine(IoPath.GetDirectoryName(towerDirectory)!, newName);
        var oldPrefix = IoPath.GetRelativePath(_root, towerDirectory);
        var newPrefix = IoPath.GetRelativePath(_root, newDirectory);
        try
        {
            if (Directory.Exists(newDirectory)) throw new IOException("目标杆塔文件夹已存在。");
            Directory.Move(towerDirectory, newDirectory);
            _store.RewritePhotoPrefix(_root, oldPrefix, newPrefix);
        }
        catch (Exception diskError)
        {
            if (!Directory.Exists(towerDirectory) && Directory.Exists(newDirectory))
                try { Directory.Move(newDirectory, towerDirectory); } catch { }
            StatusText.Text = $"重命名杆塔失败：{diskError.Message}";
            RecordOperation("RenameTower", oldPrefix, false, diskError.ToString());
            return;
        }
        await RescanAfterRename();
        StatusText.Text = $"已重命名杆塔：{newName}";
        RecordOperation("RenameTower", newPrefix, true, newName);
    }

    private async Task RenameLineDialog(LineNode line)
    {
        if (_store is null || _root is null || _saving || _opening) return;
        var dialog = RenameDialog($"重命名线路：{line.Name}", line.Name, out var input);
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var newName = input.Text.Trim();
        if (newName.Length == 0 || newName == line.Name)
        {
            StatusText.Text = "名称为空或未变化。";
            return;
        }
        var lineDirectory = IoPath.Combine(_root, line.Name);
        if (!Directory.Exists(lineDirectory))
        {
            StatusText.Text = "该线路对应输入根目录本身，请在资源管理器中修改文件夹名称。";
            return;
        }
        var newDirectory = IoPath.Combine(_root, newName);
        try
        {
            if (Directory.Exists(newDirectory)) throw new IOException("目标线路文件夹已存在。");
            Directory.Move(lineDirectory, newDirectory);
            _store.RewritePhotoPrefix(_root, line.Name, newName);
        }
        catch (Exception diskError)
        {
            if (!Directory.Exists(lineDirectory) && Directory.Exists(newDirectory))
                try { Directory.Move(newDirectory, lineDirectory); } catch { }
            StatusText.Text = $"重命名线路失败：{diskError.Message}";
            RecordOperation("RenameLine", line.Name, false, diskError.ToString());
            return;
        }
        await RescanAfterRename();
        StatusText.Text = $"已重命名线路：{newName}";
        RecordOperation("RenameLine", newName, true, newName);
    }

    // 重命名后重建索引；照片 ID 按相对路径保持不变，标注与已看记录随之保留。
    private async Task RescanAfterRename()
    {
        var photos = await Task.Run(() => _scanner.Scan(_root!));
        photos = _store!.SavePhotos(photos);
        _photos = photos;
        _indexById = photos.Select((photo, index) => (photo.Id, index))
            .ToDictionary(x => x.Id, x => x.index);
        _marked = _store.LoadMarkedPhotos();
        RenderTree();
        if (_currentPhoto is { } current)
        {
            var reloaded = photos.FirstOrDefault(photo => photo.Id == current.Id);
            if (reloaded is not null) await LoadPhoto(reloaded);
        }
    }
}

internal sealed record LineNode(string Name, string Label)
{
    public override string ToString() => Label;
}

internal sealed record TowerNode(string Line, string Tower, string Label)
{
    public override string ToString() => Label;
}

internal sealed record PhotoNode(PhotoRecord Photo, string Label)
{
    public override string ToString() => Label;
}
