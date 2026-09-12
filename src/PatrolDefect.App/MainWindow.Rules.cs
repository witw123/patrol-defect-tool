using System.Text.Json;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Shapes;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;

namespace PatrolDefect.App;

public sealed partial class MainWindow
{
    private readonly RuleCatalog _rules = RuleCatalog.LoadDefaults();
    private readonly List<string> _selectedTags = [];
    private bool _rulesReady;
    private bool _restoringDraft;
    private bool _secondaryEdit;
    private HashSet<string> _criticalTags = [];
    private string[] _candidatePool = [];
    private HashSet<string> _hiddenTags = new(StringComparer.Ordinal);

    private sealed record PhotoDraft(string Component, string[] Tags, string Section, int Conclusion);

    private void InitializeRules()
    {
        _rulesReady = true;
        _criticalTags = _rules.CriticalTags.ToHashSet(StringComparer.Ordinal);
        _candidatePool = TemplateService.FromCatalog(_rules, _criticalTags).CandidatePool!;
        CategoryBox.ItemsSource = _rules.Categories.Keys.ToArray();
        CategoryBox.SelectedIndex = 0;
        RenderSelectedTags();
    }

    private async void ExportTemplate_Click(object sender, RoutedEventArgs e)
    {
        if (_opening || _saving) return;
        _opening = true;
        try
        {
        var picker = new Windows.Storage.Pickers.FileSavePicker();
        picker.FileTypeChoices.Add("JSON 模板", [".json"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSaveFileAsync();
        if (file is null) return;
        TemplateService.Export(file.Path, CurrentRules());
        StatusText.Text = "模板已导出";
        }
        catch (Exception error) { StatusText.Text = $"导出失败：{error.Message}"; }
        finally { _opening = false; }
    }

    private async void ImportTemplate_Click(object sender, RoutedEventArgs e)
    {
        if (_opening || _saving) return;
        _opening = true;
        try
        {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        picker.FileTypeFilter.Add(".json");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(this));
        var file = await picker.PickSingleFileAsync();
        if (file is null) return;
        var incoming = TemplateService.Import(file.Path);
        var dialog = new ContentDialog { Title = "导入缺陷标签与推荐规则",
            Content = $"{file.Name}\n分类：{incoming.Categories.Count}，推荐源：{incoming.Recommendations.Count}\n导出时间：{incoming.ExportTime}",
            PrimaryButtonText = "智能合并", SecondaryButtonText = "完全覆盖", CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Close, XamlRoot = Content.XamlRoot };
        var choice = await dialog.ShowAsync();
        if (choice == ContentDialogResult.None) return;
        var current = CurrentRules();
        var result = choice == ContentDialogResult.Primary
            ? TemplateService.Merge(current, incoming) : TemplateService.Overwrite(current, incoming);
        CommitRules(result);
        StatusText.Text = "模板已导入";
        }
        catch (Exception error) { StatusText.Text = $"导入失败，规则未更改：{error.Message}"; }
        finally { _opening = false; }
    }

    private void RestoreRuleSetting(string json)
    {
        ApplyRules(TemplateService.Parse(json));
    }

    private RuleTemplate CurrentRules() => TemplateService.FromCatalog(_rules, _criticalTags, _candidatePool);

    private async void EditRules_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening || _store is null) return;
        _opening = true;
        try
        {
            var editor = new RuleEditor(CurrentRules());
            var dialog = new ContentDialog { Title = "分类与推荐规则", Content = editor,
                PrimaryButtonText = "保存修改", CloseButtonText = "取消", XamlRoot = Content.XamlRoot };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary) CommitRules(editor.Template);
        }
        catch (Exception error) { StatusText.Text = $"规则编辑失败：{error.Message}"; }
        finally { _opening = false; }
    }

    private void CommitRules(RuleTemplate template)
    {
        if (_store is null) throw new InvalidOperationException("请先打开项目再修改规则。");
        _store.SaveRuleSetting(TemplateService.Serialize(template));
        ApplyRules(template);
    }

    private void ApplyRules(RuleTemplate template)
    {
        var selected = CategoryBox.SelectedItem as string;
        _rulesReady = false;
        _rules.Categories.Clear();
        foreach (var (category, tags) in template.Categories) _rules.Categories[category] = tags.ToArray();
        _rules.Recommendations.Clear();
        foreach (var (source, targets) in template.Recommendations) _rules.Recommendations[source] = targets.ToArray();
        _criticalTags = (template.CriticalTags ?? []).ToHashSet(StringComparer.Ordinal);
        _candidatePool = template.CandidatePool?.ToArray() ?? [];
        CategoryBox.ItemsSource = _rules.Categories.Keys.ToArray();
        CategoryBox.SelectedItem = selected is not null && _rules.Categories.ContainsKey(selected) ? selected : _rules.Categories.Keys.FirstOrDefault();
        _rulesReady = true;
        RenderAvailableTags();
    }

    private void CategoryBox_Changed(object sender, SelectionChangedEventArgs e) => RenderAvailableTags();
    private void TagSearch_Changed(object sender, TextChangedEventArgs e) => RenderAvailableTags();
    private void SectionText_Changed(object sender, TextChangedEventArgs e)
    {
        if (_restoringDraft) return;
        SetDirty(true);
        UpdateNamePreview();
    }

    private void ComponentText_Changed(object sender, TextChangedEventArgs e)
    {
        if (!_rulesReady) return;
        var component = ComponentText.Text.Trim();
        var related = new List<string>();
        var seen = new HashSet<string> { component };
        void Add(IEnumerable<string> items)
        {
            foreach (var item in items) if (seen.Add(item)) related.Add(item);
        }
        if (component.Length > 0)
        {
            if (_rules.Recommendations.TryGetValue(component, out var direct)) Add(direct);
            foreach (var (key, values) in _rules.Recommendations)
                if (component.Contains(key) || key.Contains(component)) Add(values);
        }
        RecommendationText.Text = related.Count > 0 ? "关联：" + string.Join("、", related) : "";
        if (_rules.Categories.ContainsKey(component)) CategoryBox.SelectedItem = component;
        UpdateNamePreview();
    }

    private void RenderAvailableTags()
    {
        if (!_rulesReady) return;
        var search = TagSearch.Text.Trim();
        IEnumerable<string> tags = search.Length > 0 ? _rules.Categories.Values.SelectMany(x => x) :
            CategoryBox.SelectedItem is string category && _rules.Categories.TryGetValue(category, out var available) ? available : [];
        AvailableTags.Items.Clear();
        foreach (var tag in tags.Where(tag => !_hiddenTags.Contains(tag) &&
            (search.Length == 0 || tag.Contains(search, StringComparison.OrdinalIgnoreCase))))
        {
            var label = new TextBlock { Text = tag.TrimStart('_'), TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center };
            if (_criticalTags.Contains(tag))
                label.Foreground = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Firebrick);
            var row = new Grid { Tag = tag };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(label);
            var hide = new Button { Content = new FontIcon { Glyph = "" }, Padding = new Thickness(4),
                Tag = tag, Background = null, BorderThickness = new Thickness(0) };
            ToolTipService.SetToolTip(hide, "隐藏此标签（可用“恢复已隐藏”找回）");
            Grid.SetColumn(hide, 1);
            hide.Click += (_, _) => HideTag(tag);
            row.Children.Add(hide);
            AvailableTags.Items.Add(row);
        }
        RenderHiddenRestore();
    }

    // 原版 hideDefect：隐藏标签仅从候选列表移除，目录与危急属性保持不变。
    private void HideTag(string tag)
    {
        if (tag is null || !_hiddenTags.Add(tag)) return;
        SaveHiddenTags();
        RenderAvailableTags();
        StatusText.Text = $"已隐藏标签：{tag.TrimStart('_')}";
    }

    private void RestoreHidden_Click(object sender, RoutedEventArgs e)
    {
        if (_hiddenTags.Count == 0) return;
        _hiddenTags.Clear();
        SaveHiddenTags();
        RenderAvailableTags();
        StatusText.Text = "已恢复全部隐藏标签";
    }

    private void SaveHiddenTags() => SaveSetting("hidden_tags", System.Text.Json.JsonSerializer.Serialize(_hiddenTags));

    private void RenderHiddenRestore()
    {
        if (RestoreHiddenTagsButton is not null)
            RestoreHiddenTagsButton.Visibility = _hiddenTags.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void AvailableTags_Click(object sender, ItemClickEventArgs e)
    {
        if (_saving || _opening) return;
        if (e.ClickedItem is FrameworkElement { Tag: string tag }) AddTag(tag);
    }

    private void AddCustomTag_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening) return;
        var tag = DefectText.Text.Trim();
        if (tag.Length == 0) return;
        AddTag(tag.StartsWith('_') ? tag : "_" + tag);
        DefectText.Text = "";
    }

    private void AddTag(string tag)
    {
        if (!_selectedTags.Contains(tag))
        {
            _selectedTags.Add(tag);
            _undoHistory.Add("tag:" + tag);
        }
        SetDirty(true);
        RenderSelectedTags();
        if (tag.Contains("裸导线") && SectionText.Text.Length == 0 && _currentPhoto is not null)
        {
            var index = Array.FindIndex(_photos.ToArray(), p => p.Id == _currentPhoto.Id);
            var nextTower = index >= 0 && index + 1 < _photos.Count ? _photos[index + 1].TowerName : "";
            SectionText.Text = SectionRules.Suggest(_currentPhoto.TowerName, nextTower);
        }
        UpdateNamePreview();
    }

    private void RenderSelectedTags()
    {
        SelectedTagsPanel.Children.Clear();
        foreach (var tag in _selectedTags)
        {
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(new TextBlock { Text = tag.TrimStart('_'), TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center });
            var remove = new Button { Content = new SymbolIcon(Symbol.Cancel), Padding = new Thickness(4), Tag = tag };
            ToolTipService.SetToolTip(remove, "移除标签");
            Grid.SetColumn(remove, 1);
            remove.Click += (_, _) =>
            {
                if (_saving || _opening) return;
                _selectedTags.Remove(tag);
                SetDirty(true);
                RenderSelectedTags();
                UpdateNamePreview();
            };
            row.Children.Add(remove);
            SelectedTagsPanel.Children.Add(row);
        }
    }

    private void UpdateNamePreview()
    {
        if (!_rulesReady || _currentPhoto is null || _root is null) return;
        var parsed = PathRules.Parse(_root, _currentPhoto.FullPath);
        NamePreview.Text = FileNameRules.Preview(System.IO.Path.GetFileName(_currentPhoto.FullPath),
            _selectedTags, SectionText.Text, parsed);
        if (!_restoringDraft) PersistDraft();
    }

    private void PersistDraft()
    {
        if (_store is null || _currentPhoto is null || _restoringDraft) return;
        _store.SaveDraft(_currentPhoto.Id, JsonSerializer.Serialize(new PhotoDraft(ComponentText.Text,
            _selectedTags.ToArray(), SectionText.Text, ConclusionBox.SelectedIndex)));
    }

    // 返回是否存在草稿：无草稿时按原版 getDefectTagsForFile 语义回填已保存标签。
    private bool RestoreDraft(PhotoRecord photo)
    {
        _restoringDraft = true;
        try
        {
            _selectedTags.Clear();
            var json = _store?.LoadDraft(photo.Id);
            var draft = json is null ? null : JsonSerializer.Deserialize<PhotoDraft>(json);
            ComponentText.Text = draft?.Component ?? PathRules.Parse(_root!, photo.FullPath).Location;
            if (draft is not null) _selectedTags.AddRange(draft.Tags);
            SectionText.Text = draft?.Section ?? "";
            ConclusionBox.SelectedIndex = draft?.Conclusion ?? 0;
            _secondaryEdit = false;
            RenderSelectedTags();
            UpdateNamePreview();
            return draft is not null;
        }
        finally { _restoringDraft = false; }
    }

    // 已保存标签自动回填：按已知标签目录把连续标签串拆回独立标签。
    private void BackfillSavedTags(PhotoRecord photo)
    {
        if (_store is null || !_marked.Contains(photo.Id)) return;
        var saved = _store.LoadMarks(photo.Id).Select(mark => mark.DefectTag)
            .FirstOrDefault(tag => !string.IsNullOrEmpty(tag));
        if (string.IsNullOrEmpty(saved) || _selectedTags.Contains(saved)) return;
        var known = _rules.Categories.Values.SelectMany(x => x).Distinct()
            .OrderByDescending(tag => tag.Length).ToArray();
        var remaining = saved;
        var restored = new List<string>();
        while (remaining.Length > 0)
        {
            var match = known.FirstOrDefault(tag => tag.Length > 0 && remaining.StartsWith(tag, StringComparison.Ordinal));
            if (match is null)
            {
                restored.Add(remaining);
                break;
            }
            restored.Add(match);
            remaining = remaining[match.Length..];
        }
        var added = false;
        foreach (var tag in restored)
            if (!_selectedTags.Contains(tag)) { _selectedTags.Add(tag); added = true; }
        if (!added) return;
        RenderSelectedTags();
        UpdateNamePreview();
    }

    private void StrokeSlider_Changed(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (!_rulesReady) return;
        RenderBoxes();
        if (_settingsReady) SaveSetting("stroke", StrokeSlider.Value.ToString("0"));
    }

    private void ClearSecondary_Click(object sender, RoutedEventArgs e)
    {
        if (_saving || _opening) return;
        SetDirty(_boxes.Count > 0 || _selectedTags.Count > 0 || SectionText.Text.Length > 0);
        _boxes.Clear();
        _undoHistory.Clear();
        _selectedBox = -1;
        _selectedTags.Clear();
        SectionText.Text = "";
        _secondaryEdit = true;
        RenderSelectedTags();
        RenderBoxes();
        UpdateNamePreview();
    }
}
