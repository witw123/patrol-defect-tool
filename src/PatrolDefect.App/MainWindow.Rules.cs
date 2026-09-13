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
        RenderSelectedTags();
        RenderAvailableTags();
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
        _rulesReady = false;
        _rules.Categories.Clear();
        foreach (var (category, tags) in template.Categories) _rules.Categories[category] = tags.ToArray();
        _rules.Recommendations.Clear();
        foreach (var (source, targets) in template.Recommendations) _rules.Recommendations[source] = targets.ToArray();
        _criticalTags = (template.CriticalTags ?? []).ToHashSet(StringComparer.Ordinal);
        _candidatePool = template.CandidatePool?.ToArray() ?? [];
        _rulesReady = true;
        RenderAvailableTags();
    }

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
        RenderAvailableTags();
        UpdateNamePreview();
    }

    // 右侧分组标签面板（原版 renderSide）：【部件/分类】组 + 关联推荐组，
    // 危急标签整行标红并带危急徽章，行内提供 危急切换 / 隐藏 快捷操作。
    private void RenderAvailableTags()
    {
        if (!_rulesReady) return;
        TagGroupsPanel.Children.Clear();
        var search = TagSearch.Text.Trim();
        var component = ComponentText.Text.Trim();

        var groups = new List<(string Title, IReadOnlyList<string> Tags)>();
        if (search.Length > 0)
        {
            var matches = _rules.Categories.Values.SelectMany(x => x)
                .Where(tag => !_hiddenTags.Contains(tag) && tag.Contains(search, StringComparison.OrdinalIgnoreCase))
                .Distinct().ToList();
            if (matches.Count > 0) groups.Add(($@"搜索：{search}", matches));
        }
        else
        {
            if (_rules.Categories.TryGetValue(component, out var own))
                groups.Add((component, [.. own.Where(tag => !_hiddenTags.Contains(tag))]));
            foreach (var (key, values) in _rules.Recommendations)
            {
                if (key == component) continue;
                if (component.Length == 0 ||
                    component.Contains(key, StringComparison.Ordinal) ||
                    key.Contains(component, StringComparison.Ordinal))
                {
                    var tags = values.Where(tag => !_hiddenTags.Contains(tag)).ToList();
                    if (tags.Count > 0) groups.Add((key, tags));
                }
            }
            if (groups.Count == 0 && _rules.Categories.Keys.FirstOrDefault() is { } first)
                groups.Add((first, [.. _rules.Categories[first].Where(tag => !_hiddenTags.Contains(tag))]));
        }

        foreach (var (title, tags) in groups)
            TagGroupsPanel.Children.Add(BuildTagGroup(title, tags));
        RenderHiddenRestore();
    }

    private Border BuildTagGroup(string title, IReadOnlyList<string> tags)
    {
        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        header.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(6, 1, 6, 2),
            Background = Solid(0xFFF39C12),
            Child = new TextBlock
            {
                Text = $"【{title}】", FontSize = 12,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                Foreground = Solid(0xFFFFFFFF)
            }
        });
        header.Children.Add(new TextBlock { Text = "关联推荐", FontSize = 11, Foreground = Solid(0xFFF39C12), VerticalAlignment = VerticalAlignment.Center });
        header.Children.Add(new Border
        {
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(6, 0, 6, 1),
            Background = Solid(0xFFF39C12),
            Child = new TextBlock { Text = tags.Count.ToString(), FontSize = 10, Foreground = Solid(0xFFFFFFFF) }
        });
        var panel = new StackPanel { Spacing = 2 };
        panel.Children.Add(header);
        foreach (var tag in tags) panel.Children.Add(BuildTagRow(tag));
        return new Border
        {
            BorderBrush = Solid(0xFFF5B041),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 4, 6, 6),
            Child = panel
        };
    }

    private Border BuildTagRow(string tag)
    {
        var critical = _criticalTags.Contains(tag);
        var row = new Grid { ColumnSpacing = 6, Background = Solid(0x00FFFFFF) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(new TextBlock
        {
            Text = tag.TrimStart('_'),
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
            FontSize = 13,
            Foreground = Solid(critical ? 0xFFC0392B : 0xFF1F2937)
        });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        if (critical)
        {
            actions.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 0, 4, 1),
                Background = Solid(0xFFC0392B),
                Child = new TextBlock { Text = "危急", FontSize = 10, Foreground = Solid(0xFFFFFFFF) }
            });
        }
        var criticalButton = new Button
        {
            Padding = new Thickness(3, 0, 3, 0), BorderThickness = new Thickness(0),
            Background = Solid(0x00FFFFFF),
            Content = new TextBlock { Text = critical ? "✓" : "⚠", FontSize = 11, Foreground = Solid(critical ? 0xFF2E7D32 : 0xFFE67E22) }
        };
        ToolTipService.SetToolTip(criticalButton, critical ? "取消危急属性" : "设为危急缺陷");
        criticalButton.Click += (_, _) => ToggleCriticalFromSide(tag);
        actions.Children.Add(criticalButton);
        var hideButton = new Button
        {
            Padding = new Thickness(3, 0, 3, 0), BorderThickness = new Thickness(0),
            Background = Solid(0x00FFFFFF),
            Content = new FontIcon { Glyph = "\uE890", FontSize = 11 }
        };
        ToolTipService.SetToolTip(hideButton, "隐藏此标签");
        hideButton.Click += (_, _) => HideTag(tag);
        actions.Children.Add(hideButton);
        Grid.SetColumn(actions, 1);
        row.Children.Add(actions);

        // 整行点击 = 应用该标签（与原版一致）。
        row.PointerReleased += (_, args) =>
        {
            if (args.GetCurrentPoint(row).Properties.IsLeftButtonPressed)
            {
                AddTag(tag);
                args.Handled = true;
            }
        };
        return new Border { Child = row, Padding = new Thickness(4, 2, 2, 2), CornerRadius = new CornerRadius(3) };
    }

    // 侧栏危急切换（原版 toggleCriticalDefect）：立即生效并持久化到项目规则。
    private void ToggleCriticalFromSide(string tag)
    {
        if (_saving || _opening) return;
        if (!_criticalTags.Remove(tag)) _criticalTags.Add(tag);
        try
        {
            _store?.SaveRuleSetting(TemplateService.Serialize(CurrentRules()));
            RenderAvailableTags();
            StatusText.Text = _criticalTags.Contains(tag)
                ? $"已将【{tag.TrimStart('_')}】设为危急缺陷" : $"已取消【{tag.TrimStart('_')}】的危急缺陷属性";
        }
        catch (Exception error)
        {
            StatusText.Text = $"危急属性保存失败：{error.Message}";
        }
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

    private void RenderHiddenRestore() { }

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
