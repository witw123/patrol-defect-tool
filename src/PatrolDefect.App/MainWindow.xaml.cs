using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Pickers;
using WinRT.Interop;
using PatrolDefect.Application;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;
using IoPath = System.IO.Path;
using Key = Windows.System.VirtualKey;

namespace PatrolDefect.App;

public sealed partial class MainWindow : Window
{
    private readonly PhotoScanner _scanner = new();
    private ProjectStore? _store;
    private IReadOnlyList<PhotoRecord> _photos = [];
    private string? _root;
    private string? _outputRoot;
    private bool _opening;
    private PhotoRecord? _currentPhoto;
    private string _filter = "all";
    private ImageFit _fit;
    private int _loadVersion;
    private bool _saving;
    private double _zoom = 1;
    private double _panX;
    private double _panY;
    private HashSet<long> _viewed = [];
    private HashSet<long> _marked = [];
    private IReadOnlyList<string> _discoveredDirs = [];

    public MainWindow()
    {
        InitializeComponent();
        CanvasHost.SizeChanged += (_, _) => UpdateImageFit();
        ConclusionBox.ItemsSource = Enum.GetNames<PhotoConclusion>();
        ConclusionBox.SelectedIndex = 0;
        ConclusionBox.SelectionChanged += (_, _) =>
        {
            if (_rulesReady && !_restoringDraft) SetDirty(true);
            PersistDraft();
        };
        InitializeRules();
        AttachResizers(LeftResizer, isLeft: true);
        AttachResizers(RightResizer, isLeft: false);
        Activated += OnFirstActivated;
    }

    // 关闭重启后恢复上次项目：会话文件记录上次输入/输出目录。
    private static string SessionPath => Path.Combine(App.LogDirectory, "session.json");

    private bool _firstActivated;

    private async void OnFirstActivated(object sender, WindowActivatedEventArgs args)
    {
        if (_firstActivated) return;
        _firstActivated = true;
        Activated -= OnFirstActivated;
        await TryRestoreLastProjectAsync();
    }

    private async Task TryRestoreLastProjectAsync()
    {
        try
        {
            if (!File.Exists(SessionPath)) return;
            var session = System.Text.Json.JsonSerializer.Deserialize<LastSession>(File.ReadAllText(SessionPath));
            if (session?.InputRoot is not { } inputRoot || !Directory.Exists(inputRoot)) return;
            await OpenProjectAsync(inputRoot, session.OutputRoot);
            StatusText.Text = $"已恢复上次项目：{inputRoot}（{_photos.Count} 张照片）";
        }
        catch
        {
            // 恢复失败按未打开处理，用户可手动选择目录。
        }
    }

    private void SaveSession()
    {
        try
        {
            Directory.CreateDirectory(App.LogDirectory);
            File.WriteAllText(SessionPath, System.Text.Json.JsonSerializer.Serialize(
                new LastSession(_root ?? "", _outputRoot ?? "")));
        }
        catch { /* 会话记录失败不阻塞 */ }
    }

    private sealed record LastSession(string InputRoot, string OutputRoot);

    private async void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening) return;
        _opening = true;
        try
        {
            var picker = new FolderPicker();
            picker.FileTypeFilter.Add("*");
            InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
            var folder = await picker.PickSingleFolderAsync();
            if (folder is null) return;
            await OpenProjectAsync(folder.Path, null);
            ShowFirstUseNotice();
        }
        catch (Exception error)
        {
            StatusText.Text = $"打开项目失败：{error.Message}";
        }
        finally { _opening = false; }
    }

    // 共享的项目打开流程：扫描、入库、恢复规则与设置。
    private async Task OpenProjectAsync(string inputRoot, string? sessionOutputRoot)
    {
        var (photos, directories) = await Task.Run(() => _scanner.ScanWithDirectories(inputRoot));
        var nextStore = new ProjectStore(inputRoot);
        try
        {
            photos = nextStore.SavePhotos(photos);
        }
        catch
        {
            nextStore.Dispose();
            throw;
        }
        _store?.Dispose();
        _store = nextStore;
        _root = inputRoot;
        _photos = photos;
        _discoveredDirs = directories;
        _indexById = photos.Select((photo, index) => (photo.Id, index))
            .ToDictionary(x => x.Id, x => x.index);
        _outputRoot = _store.LoadProject()?.OutputRoot;
        if (string.IsNullOrEmpty(_outputRoot) && !string.IsNullOrEmpty(sessionOutputRoot) &&
            Directory.Exists(sessionOutputRoot))
            _outputRoot = sessionOutputRoot;
        _store.SaveProject(_root, _outputRoot ?? "");
        _viewed = _store.LoadViewedPhotos();
        _marked = _store.LoadMarkedPhotos();
        var storedRules = _store.LoadRuleSetting();
        if (!string.IsNullOrWhiteSpace(storedRules)) RestoreRuleSetting(storedRules);
        else
        {
            var defaults = RuleCatalog.LoadDefaults();
            ApplyRules(TemplateService.FromCatalog(defaults, defaults.CriticalTags.ToHashSet()));
        }
        RestoreSettings();
        _currentPhoto = null;
        _loadVersion++;
        _cache.Clear();
        _boxedArtifactPath = null;
        MarkCanvas.Children.Clear();
        _boxes.Clear();
        PreviewImage.Source = null;
        FolderText.Text = _root;
        OutputText.Text = string.IsNullOrEmpty(_outputRoot) ? "输出目录未设置" : _outputRoot;
        RenderTree();
        AutoFitLeftWidth();
        StatusText.Text = $"已扫描 {_photos.Count} 张照片";
        RecordOperation("OpenProject", "", true, $"{_photos.Count} photos");
        SaveSession();
    }

    private async void OutputFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_opening || _saving || _root is null || _store is null) return;
        _opening = true;
        try { await ChooseOutputFolder(); }
        catch (Exception error) { StatusText.Text = $"输出目录设置失败：{error.Message}"; }
        finally { _opening = false; }
    }

    private async Task<bool> ChooseOutputFolder()
    {
        var picker = new FolderPicker();
        picker.FileTypeFilter.Add("*");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        var folder = await picker.PickSingleFolderAsync();
        if (folder is null) return false;
        _store!.SaveProject(_root!, folder.Path);
        _outputRoot = folder.Path;
        OutputText.Text = _outputRoot;
        SaveSession();
        RecordOperation("SetOutputDirectory", "", true, _outputRoot);
        return true;
    }

    private void RecordOperation(string operation, string path, bool success, string detail)
    {
        try { _store?.RecordOperation(operation, path, success, detail); }
        catch (Exception error)
        {
            StatusText.Text += $"；操作日志写入失败：{error.Message}";
        }
    }

    private bool IsVisible(PhotoRecord photo)
    {
        return _filter switch
        {
            "marked" => _marked.Contains(photo.Id),
            "unmarked" => !_marked.Contains(photo.Id),
            "unviewed" => !_viewed.Contains(photo.Id),
            _ => true
        };
    }

    private void SetFilter(string filter)
    {
        _filter = filter;
        RenderTree();
    }

    private void FilterAll_Click(object sender, RoutedEventArgs e) => SetFilter("all");
    private void FilterMarked_Click(object sender, RoutedEventArgs e) => SetFilter("marked");
    private void FilterUnmarked_Click(object sender, RoutedEventArgs e) => SetFilter("unmarked");
    private void FilterUnviewed_Click(object sender, RoutedEventArgs e) => SetFilter("unviewed");

    private async void BackToProgress_Click(object sender, RoutedEventArgs e) => await BackToProgress();

    private async Task BackToProgress()
    {
        var photo = PhotoNavigation.FurthestViewed(_photos, _viewed);
        if (photo is null) return;
        if (!IsVisible(photo)) SetFilter("all");
        await LoadPhoto(photo);
    }

    private void SelectCurrentTreeNode()
    {
        foreach (var line in PhotoTree.RootNodes)
        {
            line.IsExpanded = false;
            foreach (var tower in line.Children)
            {
                tower.IsExpanded = false;
                foreach (var node in tower.Children)
                {
                    if (node.Content is not PhotoRecord photo || photo.Id != _currentPhoto?.Id) continue;
                    line.IsExpanded = true;
                    tower.IsExpanded = true;
                    PhotoTree.SelectedNode = node;
                }
            }
        }
    }

    private async void CancelMarked_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening || _root is null || _currentPhoto is null || _store is null) return;
        _saving = true;
        var photo = _currentPhoto;
        try
        {
        var confirmation = new ContentDialog
        {
            Title = "取消当前成果",
            Content = $"删除 {photo.RelativePath} 已登记的成果文件和标注？输入原图保留。",
            PrimaryButtonText = "删除成果",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = Content.XamlRoot
        };
        if (await confirmation.ShowAsync() != ContentDialogResult.Primary) return;
        try
        {
            var count = new OutputRepository().DeleteArtifacts(_store, photo.Id);
            _store.DeleteMarks(photo.Id);
            WriteManifest();
            _boxedArtifactPath = null;
            RefreshMarkedState();
            _saving = false;
            await LoadPhoto(photo);
            StatusText.Text = $"已取消当前成果，删除 {count} 个文件";
            RecordOperation("CancelArtifacts", photo.RelativePath, true, $"{count} files");
        }
        catch (Exception error)
        {
            StatusText.Text = $"取消未完成，保留剩余记录：{error.Message}";
            RecordOperation("CancelArtifacts", photo.RelativePath, false, error.ToString());
        }
        }
        finally { _saving = false; }
    }

    private void SyncOutput_Click(object sender, RoutedEventArgs e)
    {
        if (_store is null || _outputRoot is null) { StatusText.Text = "请先设置输出目录"; return; }
        var count = new OutputRepository().Sync(_store, _photos, _outputRoot);
        RefreshMarkedState();
        StatusText.Text = $"已从输出目录同步 {count} 条记录";
    }

    // 已标状态以输出成果为权威来源；危急缺陷独立统计（与原版 markedFiles/criticalFiles 一致）。
    private HashSet<long> _critical = [];
    private void RefreshMarkedState()
    {
        if (_store is null) return;
        _marked = _store.LoadMarkedPhotos();
        _critical = _store.LoadCriticalPhotoIds();
        RenderTree();
        UpdateBaseToggle();
    }

    private void WriteManifest()
    {
        if (_store is null || _outputRoot is null) return;
        try { new OutputManifestService().Write(_outputRoot, _store, _photos); }
        catch (Exception error) { StatusText.Text += $"；输出清单写入失败：{error.Message}"; }
    }

    private async void ClassifyOutput_Click(object sender, RoutedEventArgs e)
    {
        if (_outputRoot is null) { StatusText.Text = "请先设置输出目录"; return; }
        var outputRoot = _outputRoot;
        await RunBatchAsync("一键分类", "ClassifyOutput",
            (token, progress) => new BatchOutputService().ClassifyAsync(outputRoot, token,
                (s, f) => progress.Report((s, f))));
        if (_store is not null)
        {
            new OutputRepository().Sync(_store, _photos, outputRoot);
            WriteManifest();
            RefreshMarkedState();
        }
    }

    private async void CompleteOriginals_Click(object sender, RoutedEventArgs e)
    {
        if (_root is null || _outputRoot is null) { StatusText.Text = "请先打开项目并设置输出目录"; return; }
        var (inputRoot, outputRoot) = (_root, _outputRoot);
        await RunBatchAsync("补全原图", "CompleteOriginals",
            (token, progress) => new BatchOutputService().CompleteOriginalsAsync(inputRoot, outputRoot, token,
                (s, f) => progress.Report((s, f))));
        if (_store is not null)
        {
            new OutputRepository().Sync(_store, _photos, outputRoot);
            WriteManifest();
            RefreshMarkedState();
        }
    }

    private async void CleanOutputNames_Click(object sender, RoutedEventArgs e)
    {
        if (_outputRoot is null) { StatusText.Text = "请先设置输出目录"; return; }
        var outputRoot = _outputRoot;
        var plan = await Task.Run(() => new BatchOutputService().PlanCleanOutputNames(outputRoot));
        if (plan.Count == 0)
        {
            StatusText.Text = "规范命名：没有需要修改的历史文件名";
            return;
        }
        var preview = new TextBox
        {
            Text = string.Join(Environment.NewLine, plan.Take(200)
                .Select(item => $"{Path.GetFileName(item.OldPath)} → {Path.GetFileName(item.NewPath)}")),
            IsReadOnly = true, AcceptsReturn = true, Height = 220
        };
        ScrollViewer.SetVerticalScrollBarVisibility(preview, ScrollBarVisibility.Auto);
        var confirm = new ContentDialog
        {
            Title = $"规范命名预览（共 {plan.Count} 个文件）",
            Content = preview,
            PrimaryButtonText = "执行重命名",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = Content.XamlRoot
        };
        if (await confirm.ShowAsync() != ContentDialogResult.Primary) return;
        await RunBatchAsync("规范命名", "CleanOutputNames",
            (token, progress) => new BatchOutputService().CleanOutputNamesAsync(outputRoot, token,
                (s, f) => progress.Report((s, f))));
        if (_store is not null)
        {
            new OutputRepository().Sync(_store, _photos, outputRoot);
            WriteManifest();
            RefreshMarkedState();
        }
    }

    private void CancelCritical_Click(object sender, RoutedEventArgs e)
    {
        if (_store is null || _currentPhoto is null || _outputRoot is null) return;
        var count = new OutputRepository().DeleteCritical(_store, _currentPhoto.Id);
        WriteManifest();
        RefreshMarkedState();
        StatusText.Text = $"已撤回 {count} 个危急成果";
        RecordOperation("CancelCritical", _currentPhoto.RelativePath, true, count.ToString());
    }

    // 原版 ensureSectionRangeIfBareWire：裸导线保存前必须确认命名区段。
    private async Task<bool> EnsureSectionIfBareWireAsync()
    {
        if (!_selectedTags.Any(tag => tag.Contains("裸导线"))) return true;
        var input = new TextBox { Text = SectionText.Text, PlaceholderText = "#001-#100" };
        var sectionDialog = new ContentDialog
        {
            Title = "裸导线区段命名", Content = input,
            PrimaryButtonText = "保存", CloseButtonText = "取消", XamlRoot = Content.XamlRoot
        };
        if (await sectionDialog.ShowAsync() != ContentDialogResult.Primary) return false;
        SectionText.Text = input.Text.Trim();
        return true;
    }

    // 原版 saveCriticalOnly：独立覆盖保存当前圈示图到「危急缺陷」，与主保存互不影响，保存后清空红框。
    private async void SaveCriticalOnly_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening || _fit.Width <= 0 || _root is null || _currentPhoto is null
            || _store is null || _outputRoot is null) return;
        _saving = true;
        try
        {
            if (_boxes.Count == 0)
            {
                var warning = new ContentDialog
                {
                    Title = "保存提示确认",
                    Content = "当前图片【尚未圈示红框】，确定要直接将圈示图保存到「危急缺陷」文件夹吗？",
                    PrimaryButtonText = "保存", CloseButtonText = "取消", XamlRoot = Content.XamlRoot
                };
                if (await warning.ShowAsync() != ContentDialogResult.Primary) return;
            }
            if (await EnsureSectionIfBareWireAsync() is false) return;
            var idBase = DateTime.UtcNow.Ticks;
            var marks = _boxes.Select((box, index) => new DefectMark(
                idBase + index,
                _currentPhoto.Id,
                Math.Clamp(box.X, 0, 1),
                Math.Clamp(box.Y, 0, 1),
                Math.Clamp(box.Width, 0, 1),
                Math.Clamp(box.Height, 0, 1),
                StrokeSlider.Value,
                ComponentText.Text.Trim(),
                string.Concat(_selectedTags),
                ConclusionBox.SelectedItem?.ToString() ?? nameof(PhotoConclusion.Pending))).ToArray();
            new OutputRepository().DeleteCritical(_store, _currentPhoto.Id);
            var criticalPath = await new OutputService().SaveCriticalOnlyAsync(_currentPhoto, marks,
                _outputRoot, NamePreview.Text);
            _store.RegisterArtifacts(_currentPhoto.Id, criticalPath);
            WriteManifest();
            _boxes.Clear();
            _undoHistory.Clear();
            _selectedBox = -1;
            _dirty = false;
            RenderBoxes();
            RefreshMarkedState();
            RecordOperation("SaveCriticalOnly", _currentPhoto.RelativePath, true, criticalPath);
            StatusText.Text = $"已独立覆盖保存圈示图到「危急缺陷」：{IoPath.GetFileName(criticalPath)}";
        }
        catch (Exception error)
        {
            StatusText.Text = $"危急保存失败：{error.Message}";
            RecordOperation("SaveCriticalOnly", _currentPhoto?.RelativePath ?? "", false, error.ToString());
        }
        finally
        {
            _saving = false;
        }
    }

    private async void PrevPhoto_Click(object sender, RoutedEventArgs e) => await SelectRelativePhoto(-1);

    private async void NextPhoto_Click(object sender, RoutedEventArgs e) => await SelectRelativePhoto(1);

    private void UpdateImageFit()
    {
        if (PreviewImage.Source is not BitmapImage image) return;
        _fit = ImageFit.Calculate(CanvasHost.ActualWidth, CanvasHost.ActualHeight,
            image.PixelWidth, image.PixelHeight);
        ApplyViewport();
    }

    private async void RootGrid_KeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (_saving || _opening || Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(Content.XamlRoot)
            is TextBox or PasswordBox or RichEditBox or ComboBox) return;
        var control = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Key.Control)
            .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        var alt = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(Key.Menu)
            .HasFlag(Windows.UI.Core.CoreVirtualKeyStates.Down);
        if (control && e.Key is Key.Z)
        {
            UndoLastAction();
            e.Handled = true;
            return;
        }
        if (e.Key == Key.C && !control && !alt)
        {
            await BackToProgress();
            e.Handled = true;
            return;
        }
        if (e.Key is Key.Space || (alt && e.Key is Key.S) || (_shortcutSave is { } saveKey && e.Key == saveKey))
        {
            Save_Click(sender, new RoutedEventArgs());
            e.Handled = true;
            return;
        }
        if ((e.Key is Key.A or Key.Left || (_shortcutPrev is { } prevKey && e.Key == prevKey)) && !control)
        {
            await SelectRelativePhoto(-1);
            e.Handled = true;
        }
        else if ((e.Key is Key.D or Key.Right || (_shortcutNext is { } nextKey && e.Key == nextKey)) && !control)
        {
            await SelectRelativePhoto(1);
            e.Handled = true;
        }
        else if (e.Key is Key.Delete or Key.Back)
        {
            if (_selectedBox >= 0) DeleteSelectedBox();
            e.Handled = true;
        }
    }

    private async Task SelectRelativePhoto(int offset)
    {
        var next = PhotoNavigation.Next(_photos, _currentPhoto?.Id, offset, IsVisible);
        if (next is not null) await LoadPhoto(next);
    }

    private readonly ImageCache _cache = new();
    private string? _boxedArtifactPath;
    private bool _currentBaseIsBoxed;
    private Dictionary<long, int> _indexById = [];

    // 原版 getImage：已标记照片默认以缺陷圈示图为底图，可切换纯净原图。
    private string? PickBoxedArtifact(long photoId)
    {
        if (_store is null) return null;
        return _store.LoadArtifacts(photoId)
            .Where(path => string.Equals(Path.GetFileName(Path.GetDirectoryName(path) ?? ""),
                "缺陷圈示图", StringComparison.Ordinal) && File.Exists(path))
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();
    }

    private (string Path, bool IsBoxed) ResolveBasePath(PhotoRecord photo, bool? showBoxed)
    {
        _boxedArtifactPath = PickBoxedArtifact(photo.Id);
        var boxed = showBoxed ?? !string.IsNullOrEmpty(_boxedArtifactPath);
        if (boxed && _boxedArtifactPath is { } path && File.Exists(path)) return (path, true);
        return (photo.FullPath, false);
    }

    private (string Path, int Index)? NeighborBase(int index)
    {
        if (index < 0 || index >= _photos.Count) return null;
        var photo = _photos[index];
        if (!_marked.Contains(photo.Id)) return (photo.FullPath, index);
        var boxed = PickBoxedArtifact(photo.Id);
        return boxed is null ? (photo.FullPath, index) : (boxed, index);
    }

    private async void ToggleBase_Click(object sender, RoutedEventArgs e)
    {
        if (_currentPhoto is null || string.IsNullOrEmpty(_boxedArtifactPath)) return;
        await LoadPhoto(_currentPhoto, showBoxed: !_currentBaseIsBoxed);
    }

    private async Task LoadPhoto(PhotoRecord photo, bool? showBoxed = null)
    {
        if (_saving || _opening) return;
        var version = ++_loadVersion;
        try
        {
            var index = _indexById.TryGetValue(photo.Id, out var known) ? known : FindPhotoIndex(photo);
            var (basePath, isBoxed) = ResolveBasePath(photo, showBoxed);
            var bitmap = await _cache.GetAsync(basePath, index);
            if (version != _loadVersion || bitmap is null) return;
            _currentPhoto = photo;
            _currentBaseIsBoxed = isBoxed;
            _zoom = 1;
            _panX = 0;
            _panY = 0;
            MarkCanvas.Children.Clear();
            PreviewImage.Source = bitmap;
            UpdateImageFit();
            LoadWorkingBoxes(photo.Id);
            var hadDraft = RestoreDraft(photo);
            if (!hadDraft) BackfillSavedTags(photo);
            _dirty = false;
            UpdateSummary();
            _store?.MarkViewed(photo.Id);
            _viewed.Add(photo.Id);
            SelectCurrentTreeNode();
            StatusText.Text = $"{photo.RelativePath} · {bitmap.PixelWidth} × {bitmap.PixelHeight}";
            UpdateCounter();
            _cache.SetCurrentIndex(index);
            var neighbors = new[] { 1, -1, 2 }
                .Select(NeighborBase)
                .Where(candidate => candidate is not null)
                .Select(candidate => candidate!.Value)
                .ToList();
            _ = _cache.PreloadAsync(neighbors);
            UpdateBaseToggle();
        }
        catch (Exception error)
        {
            if (version == _loadVersion) StatusText.Text = $"图片加载失败：{error.Message}";
        }
    }

    private int FindPhotoIndex(PhotoRecord photo)
    {
        for (var i = 0; i < _photos.Count; i++)
            if (_photos[i].Id == photo.Id) return i;
        return -1;
    }

    private void UpdateBaseToggle()
    {
        if (_currentPhoto is null || _marked is null) return;
        var hasBoxed = !string.IsNullOrEmpty(_boxedArtifactPath);
        ToggleBaseButton.Visibility = hasBoxed ? Visibility.Visible : Visibility.Collapsed;
        ToggleBaseButton.Content = _currentBaseIsBoxed ? "查看原图" : "查看圈示图";
        MarkedStatusText.Text = _marked.Contains(_currentPhoto.Id)
            ? $"已标记 ({(_currentBaseIsBoxed ? "圈示图" : "原图")})" : "未标记";
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening || _fit.Width <= 0 || _root is null || _currentPhoto is null || _store is null) return;
        _saving = true;
        try
        {
        if ((string.IsNullOrEmpty(_outputRoot) || !Directory.Exists(_outputRoot)) && !await ChooseOutputFolder()) return;
        if (MarkCanvas.Children.Count == 0 || _selectedTags.Count == 0)
        {
            var warning = new ContentDialog
            {
                Title = "保存提示确认", Content = "当前图片未画红框或未添加缺陷标签，仍要保存成果吗？",
                PrimaryButtonText = "保存", CloseButtonText = "取消", XamlRoot = Content.XamlRoot
            };
            if (await warning.ShowAsync() != ContentDialogResult.Primary) return;
        }
        if (await EnsureSectionIfBareWireAsync() is false) return;
        var idBase = DateTime.UtcNow.Ticks;
        var marks = _boxes.Select((box, index) => new DefectMark(
            idBase + index,
            _currentPhoto.Id,
            Math.Clamp(box.X, 0, 1),
            Math.Clamp(box.Y, 0, 1),
            Math.Clamp(box.Width, 0, 1),
            Math.Clamp(box.Height, 0, 1),
            StrokeSlider.Value,
            ComponentText.Text.Trim(),
            string.Concat(_selectedTags),
            ConclusionBox.SelectedItem?.ToString() ?? nameof(PhotoConclusion.Pending))).ToArray();
        var previousArtifacts = _secondaryEdit ? [] : _store.LoadArtifacts(_currentPhoto.Id).ToArray();
        var output = await new OutputService().SaveAsync(_currentPhoto, marks, _outputRoot!,
            outputName: NamePreview.Text, tags: _selectedTags.ToArray());
        _store.RegisterArtifacts(_currentPhoto.Id, output.BoxedPath, output.OriginalPath);
        if (CriticalCheck.IsChecked == true || _selectedTags.Any(tag => _criticalTags.Contains(tag)))
        {
            var criticalDirectory = IoPath.Combine(_outputRoot!, "危急缺陷");
            Directory.CreateDirectory(criticalDirectory);
            var criticalPath = IoPath.Combine(criticalDirectory, IoPath.GetFileName(output.BoxedPath));
            File.Copy(output.BoxedPath, criticalPath, overwrite: true);
            _store.RegisterArtifacts(_currentPhoto.Id, criticalPath);
        }
        _store.ReplaceMarks(_currentPhoto.Id, marks);
        foreach (var path in previousArtifacts)
        {
            File.Delete(path);
            _store.ForgetArtifact(_currentPhoto.Id, path);
        }
        WriteManifest();
        RefreshMarkedState();
        PersistDraft();
        _secondaryEdit = false;
        _dirty = false;
        RecordOperation("SaveArtifacts", _currentPhoto.RelativePath, true,
            output.BoxedPath + Environment.NewLine + output.OriginalPath);
        _boxedArtifactPath = output.BoxedPath;
        SelectCurrentTreeNode();
        UpdateBaseToggle();
        var dialog = new ContentDialog
        {
            Title = "保存成功",
            Content = $"已保存圈示图：{output.BoxedPath}",
            CloseButtonText = "确定",
            XamlRoot = Content.XamlRoot
        };
        await dialog.ShowAsync();
        }
        catch (Exception error)
        {
            StatusText.Text = $"保存失败：{error.Message}";
            RecordOperation("SaveArtifacts", _currentPhoto?.RelativePath ?? "", false, error.ToString());
        }
        finally
        {
            _saving = false;
        }
    }
}
