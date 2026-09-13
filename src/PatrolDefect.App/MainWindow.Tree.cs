using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;
using IoPath = System.IO.Path;

namespace PatrolDefect.App;

// 目录树渲染：对照原版 HTML 的三级展示与统计——
// 线路 → 杆塔【#001】→ 部件位置 + 已看/已标徽章；筛选按钮带数量；
// 底部信息卡显示当前线路/杆塔/部件/标记/已看/缺陷状态。
// 树为自绘行（原版即自定义 DOM），完全掌控展开/折叠与徽章样式。
public sealed partial class MainWindow
{
    private IReadOnlyDictionary<long, int> _markCounts = new Dictionary<long, int>();
    private readonly Dictionary<string, bool> _expandedTowers = new(StringComparer.Ordinal);
    private readonly Dictionary<long, FrameworkElement> _photoRows = new();

    private sealed class TreeRow
    {
        public required string Kind;      // line / tower / photo
        public required string Title;
        public required int Depth;
        public string ExpandKey = "";
        public required object[] Chips;
        public object? Payload;           // LineNode / TowerNode / PhotoRecord
    }

    private void RenderTree()
    {
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
            var rootFolder = IoPath.GetFileName(Path.TrimEndingDirectorySeparator(_root));
            foreach (var directory in _discoveredDirs)
            {
                if (PathRules.IsOutputArtifact(directory)) continue;
                var parsed = PathRules.ParseDirectory(rootFolder, directory);
                if (parsed.TowerName.Length == 0 || !PathRules.IsTowerFolderName(parsed.TowerName)) continue;
                if (!towers.TryGetValue(parsed.LineName, out var map))
                    towers[parsed.LineName] = map = [];
                if (!map.TryGetValue(parsed.TowerName, out var list))
                    map[parsed.TowerName] = list = [];
            }
        }

        TreePanel.Children.Clear();
        _photoRows.Clear();
        var currentKey = _currentPhoto is null ? null : $"P:{_currentPhoto.Id}";

        foreach (var lineEntry in towers)
        {
            var lineTowers = lineEntry.Value.Count;
            var lineFull = lineEntry.Value.Values.Count(photos =>
                photos.Count > 0 && photos.All(photo => _viewed.Contains(photo.Id)));
            var lineKey = "L:" + lineEntry.Key;
            TreePanel.Children.Add(BuildTreeRow(new TreeRow
            {
                Kind = "line",
                Title = lineEntry.Key,
                Depth = 0,
                ExpandKey = lineKey,
                Chips = [$"已看 {lineFull}/{lineTowers}基"],
                Payload = new LineNode(lineEntry.Key)
            }));
            if (!_expandedTowers.TryGetValue(lineKey, out var lineOpen)) lineOpen = true;
            if (!lineOpen) continue;

            foreach (var towerEntry in lineEntry.Value)
            {
                var towerKey = $"T:{lineEntry.Key}::{towerEntry.Key}";
                var towerViewed = towerEntry.Value.Count(photo => _viewed.Contains(photo.Id));
                var towerMarked = towerEntry.Value.Count(photo => _marked.Contains(photo.Id));
                TreePanel.Children.Add(BuildTreeRow(new TreeRow
                {
                    Kind = "tower",
                    Title = $"【{towerEntry.Key}】",
                    Depth = 1,
                    ExpandKey = towerKey,
                    Chips = [$"{towerEntry.Value.Count}张 · 已看{towerViewed} · 已标{towerMarked}"],
                    Payload = new TowerNode(lineEntry.Key, towerEntry.Key)
                }));
                if (!_expandedTowers.TryGetValue(towerKey, out var towerOpen)) towerOpen = false;
                if (!towerOpen) continue;

                foreach (var photo in towerEntry.Value)
                {
                    var element = BuildTreeRow(new TreeRow
                    {
                        Kind = "photo",
                        Title = PhotoLocation(photo),
                        Depth = 2,
                        Chips =
                        [
                            _viewed.Contains(photo.Id) ? "已看" : "",
                            _marked.Contains(photo.Id)
                                ? _markCounts.TryGetValue(photo.Id, out var count) && count > 1 ? $"已标×{count}" : "已标" : "",
                            _critical.Contains(photo.Id) ? "!危急" : ""
                        ],
                        Payload = photo
                    });
                    _photoRows[photo.Id] = element;
                    if (currentKey == $"P:{photo.Id}")
                    {
                        ((Border)element).Background = Solid(0xFFFDECEC);
                        ((Border)element).BorderBrush = Solid(0xFFC0392B);
                        ((Border)element).BorderThickness = new Thickness(1);
                    }
                    TreePanel.Children.Add(element);
                }
            }
        }

        UpdateSummary();
        UpdateCounter();
        UpdateFilterButtons();
        StatusText.Text = $"显示 {filtered.Length}/{_photos.Count} 张照片";
    }

    private FrameworkElement BuildTreeRow(TreeRow row)
    {
        var content = new Grid { ColumnSpacing = 6 };
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        content.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var prefix = row.Kind switch
        {
            "tower" => _expandedTowers.GetValueOrDefault(row.ExpandKey) ? "▾ " : "▸ ",
            "line" => _expandedTowers.GetValueOrDefault(row.ExpandKey, true) ? "▾ " : "▸ ",
            _ => ""
        };
        content.Children.Add(new TextBlock
        {
            Text = prefix + row.Title,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 13,
            FontWeight = row.Kind == "photo" ? Microsoft.UI.Text.FontWeights.Normal : Microsoft.UI.Text.FontWeights.SemiBold
        });

        var chips = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 3,
            VerticalAlignment = VerticalAlignment.Center
        };
        foreach (var chip in row.Chips)
        {
            if (chip is not string text || text.Length == 0) continue;
            var critical = text.StartsWith('!');
            chips.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 0, 4, 1),
                Background = critical ? Solid(0xFFC0392B) : Solid(0xFFE8F5E9),
                Child = new TextBlock
                {
                    Text = critical ? text[1..] : text,
                    FontSize = 10,
                    Foreground = critical ? Solid(0xFFFFFFFF) : Solid(0xFF2E7D32)
                }
            });
        }
        content.Children.Add(chips);
        Grid.SetColumn(chips, 1);

        var button = new Button
        {
            Content = content,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(row.Depth * 16 + 6, 3, 6, 3),
            BorderThickness = new Thickness(0),
            Background = Solid(0x00000000),
            CornerRadius = new CornerRadius(3),
            MinWidth = 0
        };
        button.Click += (_, _) =>
        {
            switch (row)
            {
                case { Kind: "photo", Payload: PhotoRecord photo }:
                    _ = LoadPhoto(photo);
                    break;
                case { Kind: "line" or "tower" }:
                    _expandedTowers[row.ExpandKey] = !_expandedTowers.GetValueOrDefault(
                        row.ExpandKey, row.Kind == "line");
                    RenderTree();
                    break;
            }
        };
        button.DoubleTapped += (_, _) =>
        {
            switch (row.Payload)
            {
                case PhotoRecord photo:
                    _ = RenamePhotoDialog(photo);
                    break;
                case TowerNode tower:
                    _ = RenameTowerDialog(tower);
                    break;
                case LineNode line:
                    _ = RenameLineDialog(line);
                    break;
            }
        };
        return button;
    }

    // 原版行为：切到某张照片时展开其杆塔并收起其他杆塔，滚动到可见位置。
    private void SelectCurrentTreeRow()
    {
        if (_currentPhoto is null) return;
        foreach (var key in _expandedTowers.Keys.Where(key => key.StartsWith('T')).ToArray())
            _expandedTowers[key] = false;
        _expandedTowers[$"T:{_currentPhoto.LineName}::{_currentPhoto.TowerName}"] = true;
        _expandedTowers[$"L:{_currentPhoto.LineName}"] = true;
        RenderTree();
        if (_photoRows.TryGetValue(_currentPhoto.Id, out var row))
            row.StartBringIntoView();
    }

    // 照片条目显示部件位置（与原版一致），完整文件名在工具栏与信息卡展示。
    private string PhotoLocation(PhotoRecord photo)
    {
        if (_root is null) return photo.RelativePath;
        try
        {
            var location = PathRules.Parse(_root, photo.FullPath).Location;
            return location.Length > 0 ? location : IoPath.GetFileName(photo.FullPath);
        }
        catch
        {
            return photo.RelativePath;
        }
    }

    // 原版 updateHud 的位置计数与组标签：筛选时显示筛选集合内位置与总数。
    private void UpdateCounter()
    {
        if (_currentPhoto is null || _photos.Count == 0)
        {
            CounterText.Text = "— / —";
            GroupTagText.Text = "";
            FileNameText.Text = "";
            FileNameChip.Text = "";
            return;
        }
        var currentIndex = _indexById.GetValueOrDefault(_currentPhoto.Id, -1);
        if (_filter == "all")
        {
            CounterText.Text = currentIndex >= 0 ? $"{currentIndex + 1} / {_photos.Count}" : "— / —";
        }
        else
        {
            var filtered = _photos.Where(IsVisible).ToList();
            var position = filtered.FindIndex(photo => photo.Id == _currentPhoto.Id);
            var label = _filter switch { "marked" => "已标记", "unmarked" => "未标记", "unviewed" => "未看", _ => "筛选" };
            CounterText.Text = $"{(position >= 0 ? position + 1 : "—")} / {filtered.Count} 【{label}】";
        }
        GroupTagText.Text = $"【{_currentPhoto.LineName} · {_currentPhoto.TowerName}】";
        var fileName = IoPath.GetFileName(_currentPhoto.FullPath);
        FileNameText.Text = fileName;
        FileNameChip.Text = fileName;
    }

    private void UpdateFilterButtons()
    {
        var total = _photos.Count;
        var marked = _photos.Count(photo => _marked.Contains(photo.Id));
        var unviewed = _photos.Count(photo => !_viewed.Contains(photo.Id));
        FilterAllButton.Content = $"全部 ({total})";
        FilterMarkedButton.Content = $"已标记 ({marked})";
        FilterUnmarkedButton.Content = $"未标记 ({total - marked})";
        FilterUnviewedButton.Content = $"未看 ({unviewed})";
        ApplyFilterLook(FilterAllButton, _filter == "all");
        ApplyFilterLook(FilterMarkedButton, _filter == "marked");
        ApplyFilterLook(FilterUnmarkedButton, _filter == "unmarked");
        ApplyFilterLook(FilterUnviewedButton, _filter == "unviewed");
    }

    private static void ApplyFilterLook(Button button, bool selected)
    {
        button.Background = Solid(selected ? 0xFFC0392B : 0xFFEDF1F6);
        button.Foreground = Solid(selected ? 0xFFFFFFFF : 0xFF1F2937);
    }

    private static SolidColorBrush Solid(uint rgb) =>
        new(Microsoft.UI.ColorHelper.FromArgb(0xFF, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb));

    private void UpdateSummary()
    {
        if (TreeSummaryText is null) return;
        var marked = _photos.Count(photo => _marked.Contains(photo.Id));
        var towers = _photos.Select(photo => (photo.LineName, photo.TowerName)).Distinct().Count();
        var fullTowers = _photos.GroupBy(photo => (photo.LineName, photo.TowerName))
            .Count(group => group.All(photo => _viewed.Contains(photo.Id)));
        var defects = _markCounts.Values.Sum();
        var currentLine = _currentPhoto?.LineName ?? _photos.FirstOrDefault()?.LineName ?? "线路";
        TreeSummaryText.Text = $"{currentLine} · 已标 {marked}/{_photos.Count} · 已看 {fullTowers}/{towers} ({towers}基已查) · 缺陷 {defects}处";

        // 底部信息卡（原版 sideCur 系列）。
        if (_currentPhoto is null)
        {
            CardLine.Text = "—";
            CardTower.Text = "—";
            CardLocation.Text = "—";
            MarkedStatusText.Text = "未标记";
            MarkedStatusText.Foreground = Solid(0xFF9CA3AF);
            CardViewed.Text = "未看";
            CardDefect.Text = "未保存";
            CancelMarkedButton.Visibility = Visibility.Collapsed;
            CancelCriticalButton.Visibility = Visibility.Collapsed;
            ToggleBaseButton.Visibility = Visibility.Collapsed;
            return;
        }
        CardLine.Text = _currentPhoto.LineName;
        CardTower.Text = _currentPhoto.TowerName;
        CardLocation.Text = PhotoLocation(_currentPhoto);
        CardViewed.Text = _viewed.Contains(_currentPhoto.Id) ? "已看" : "未看";
        var criticalNow = _critical.Contains(_currentPhoto.Id);
        MarkedStatusText.Text = _marked.Contains(_currentPhoto.Id)
            ? $"已标记 ({(_currentBaseIsBoxed ? "圈示图" : "原图")})" : "未标记";
        MarkedStatusText.Foreground = Solid(_marked.Contains(_currentPhoto.Id) ? 0xFF2E7D32 : 0xFF9CA3AF);
        CardDefect.Text = _dirty ? "有未保存修改" : criticalNow ? "危急已保存" : _marked.Contains(_currentPhoto.Id) ? "已保存" : "未保存";
        CardDefect.Foreground = Solid(_dirty ? 0xFFC0392B : 0xFF9CA3AF);
        CancelMarkedButton.Visibility = _marked.Contains(_currentPhoto.Id) ? Visibility.Visible : Visibility.Collapsed;
        CancelCriticalButton.Visibility = criticalNow ? Visibility.Visible : Visibility.Collapsed;
        ToggleBaseButton.Visibility = string.IsNullOrEmpty(_boxedArtifactPath) ? Visibility.Collapsed : Visibility.Visible;
        ToggleBaseButton.Content = _currentBaseIsBoxed ? "查看原图" : "查看圈示图";
    }

    private void AutoFitWidth_Click(object sender, RoutedEventArgs e) => AutoFitLeftWidth();

    private void ExpandAll_Click(object sender, RoutedEventArgs e)
    {
        foreach (var line in _photos.Select(photo => photo.LineName).Distinct())
        {
            _expandedTowers[$"L:{line}"] = true;
            foreach (var tower in _photos.Where(photo => photo.LineName == line)
                         .Select(photo => photo.TowerName).Distinct())
                _expandedTowers[$"T:{line}::{tower}"] = true;
        }
        RenderTree();
    }

    private void CollapseAll_Click(object sender, RoutedEventArgs e)
    {
        foreach (var key in _expandedTowers.Keys.ToArray()) _expandedTowers[key] = false;
        RenderTree();
    }

    // 原版 autoFitLeftPanelWidth：按最长名称估算左栏宽度（中文字宽近似 12px，其余 7px）。
    private void AutoFitLeftWidth()
    {
        var maxWidth = 0d;
        foreach (var photo in _photos)
            maxWidth = Math.Max(maxWidth, EstimateWidth(PhotoLocation(photo)));
        foreach (var line in _photos.Select(photo => photo.LineName).Distinct())
            maxWidth = Math.Max(maxWidth, EstimateWidth(line));
        maxWidth += 130;
        var windowWidth = RootGrid.ActualWidth > 0 ? RootGrid.ActualWidth : 1280;
        var optimal = Math.Clamp(maxWidth, 280, Math.Max(300, windowWidth * 0.55));
        LeftColumn.Width = new GridLength(Math.Ceiling(optimal));
    }

    private static double EstimateWidth(string text) => text.Sum(character =>
        character > 0x2E80 ? 12.0 : char.IsAsciiLetterOrDigit(character) ? 6.8 : 8.0);

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
        var (photos, directories) = await Task.Run(() => _scanner.ScanWithDirectories(_root!));
        photos = _store!.SavePhotos(photos);
        _photos = photos;
        _discoveredDirs = directories;
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

internal sealed record LineNode(string Name);

internal sealed record TowerNode(string Line, string Tower);

internal sealed record PhotoNode(PhotoRecord Photo);
