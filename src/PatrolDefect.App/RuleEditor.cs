using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;

namespace PatrolDefect.App;

// Edits a detached template. The caller commits it only after the dialog is accepted.
internal sealed class RuleEditor : Grid
{
    public RuleTemplate Template { get; }
    private readonly ComboBox _mode = new();
    private readonly TextBox _search = new() { PlaceholderText = "搜索分类、部件或候选词" };
    private readonly ListView _names = new() { SelectionMode = ListViewSelectionMode.Single };
    private readonly ListView _items = new() { SelectionMode = ListViewSelectionMode.Single };
    private readonly TextBox _name = new() { Header = "名称" };
    private readonly TextBox _item = new() { Header = "标签或关联目标" };
    private readonly CheckBox _critical = new() { Content = "危急缺陷" };
    private readonly CheckBox _bilateral = new() { Content = "双向关联", IsChecked = true };
    private readonly TextBox _moveTarget = new();
    private readonly TextBlock _error = new() { TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _detail = new() { Spacing = 8 };
    private bool _rendering;
    private int Mode => _mode.SelectedIndex;
    private string? Selected => _names.SelectedItem as string;
    private Dictionary<string, string[]> Map => Mode == 0 ? Template.Categories : Template.Recommendations;

    public RuleEditor(RuleTemplate current)
    {
        Template = TemplateService.Clone(current);
        Width = 680;
        Height = 520;
        RowSpacing = 8;
        RowDefinitions.Add(new() { Height = GridLength.Auto });
        RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        RowDefinitions.Add(new() { Height = GridLength.Auto });
        _mode.ItemsSource = new[] { "缺陷分类总表", "部件推荐关系", "候选词池" };
        _mode.SelectedIndex = 0;
        Children.Add(_mode);
        var body = new Grid { ColumnSpacing = 12 };
        body.ColumnDefinitions.Add(new() { Width = new GridLength(240) });
        body.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        SetRow(body, 1);
        Children.Add(body);
        var left = new Grid { RowSpacing = 8 };
        left.RowDefinitions.Add(new() { Height = GridLength.Auto });
        left.RowDefinitions.Add(new() { Height = new GridLength(1, GridUnitType.Star) });
        left.RowDefinitions.Add(new() { Height = GridLength.Auto });
        left.RowDefinitions.Add(new() { Height = GridLength.Auto });
        left.Children.Add(_search);
        SetRow(_names, 1); left.Children.Add(_names);
        SetRow(_name, 2); left.Children.Add(_name);
        var nameTools = Tools(
            (Symbol.Add, "新增", AddName), (Symbol.Edit, "重命名", RenameName),
            (Symbol.Delete, "删除", DeleteName));
        SetRow(nameTools, 3); left.Children.Add(nameTools);
        body.Children.Add(left);
        _items.Height = 235;
        _detail.Children.Add(_items);
        _detail.Children.Add(_item);
        _detail.Children.Add(_critical);
        _detail.Children.Add(_bilateral);
        _moveTarget = new TextBox { Header = "移动选中项到目标（分类/部件名）" };
        _detail.Children.Add(_moveTarget);
        _detail.Children.Add(Tools((Symbol.Add, "添加标签或关系", AddItem),
            (Symbol.Edit, "修改选中项", RenameItem), (Symbol.Delete, "删除选中项", DeleteItem),
            (Symbol.Clear, "清空当前列表", ClearItems),
            (Symbol.Previous, "上移选中项", () => MoveItem(-1)),
            (Symbol.Next, "下移选中项", () => MoveItem(1)),
            (Symbol.Send, "移动到目标分类", MoveToTarget)));
        var right = new ScrollViewer { Content = _detail, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        SetColumn(right, 1); body.Children.Add(right);
        var footer = new StackPanel { Spacing = 4 };
        footer.Children.Add(_error);
        var reset = new Button { Content = "恢复当前页默认规则" };
        reset.Click += (_, _) => Run(Reset);
        footer.Children.Add(reset);
        SetRow(footer, 2); Children.Add(footer);
        _mode.SelectionChanged += (_, _) => Refresh();
        _search.TextChanged += (_, _) => Refresh();
        _names.SelectionChanged += (_, _) => ShowItems();
        _items.SelectionChanged += (_, _) =>
        {
            _item.Text = _items.SelectedItem as string ?? "";
            _rendering = true;
            _critical.IsChecked = Template.CriticalTags?.Contains(_item.Text) == true;
            _rendering = false;
        };
        _critical.Checked += (_, _) => SetCritical(true);
        _critical.Unchecked += (_, _) => SetCritical(false);
        Refresh();
    }

    private StackPanel Tools(params (Symbol Icon, string Label, Action Action)[] actions)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        foreach (var (icon, label, action) in actions)
        {
            var button = new Button { Content = new SymbolIcon(icon), Padding = new Thickness(8) };
            ToolTipService.SetToolTip(button, label);
            button.Click += (_, _) => Run(action);
            panel.Children.Add(button);
        }
        return panel;
    }

    private void Run(Action action)
    {
        try { action(); _error.Text = ""; }
        catch (Exception error) { _error.Text = error.Message; }
    }

    private void Refresh(string? select = null)
    {
        var previous = select ?? Selected;
        var names = Mode == 2 ? Template.CandidatePool ?? [] : Map.Keys.ToArray();
        _names.ItemsSource = names.Where(name => name.Contains(_search.Text, StringComparison.OrdinalIgnoreCase) ||
            (Mode == 0 && Template.Categories[name].Any(tag => tag.Contains(_search.Text, StringComparison.OrdinalIgnoreCase)))).ToArray();
        _names.SelectedItem = previous;
        _detail.Visibility = Mode == 2 ? Visibility.Collapsed : Visibility.Visible;
        _critical.Visibility = Mode == 0 ? Visibility.Visible : Visibility.Collapsed;
        _bilateral.Visibility = Mode == 1 ? Visibility.Visible : Visibility.Collapsed;
        ShowItems();
    }

    private void ShowItems()
    {
        _name.Text = Selected ?? "";
        _items.ItemsSource = Mode != 2 && Selected is string key && Map.TryGetValue(key, out var items) ? items : [];
    }

    private static string Required(string text)
    {
        var value = text.Trim();
        if (value.Length == 0) throw new InvalidOperationException("名称不能为空。");
        return value;
    }

    private void AddName()
    {
        var name = Required(_name.Text);
        if (Mode == 2)
        {
            Template.CandidatePool = (Template.CandidatePool ?? []).Concat(
                System.Text.RegularExpressions.Regex.Split(name, @"[,，\s]+")).Distinct().ToArray();
        }
        else
        {
            if (Map.ContainsKey(name)) throw new InvalidOperationException("已存在同名项。");
            Map.Add(name, []);
            Template.CandidatePool = (Template.CandidatePool ?? []).Append(name).Distinct().ToArray();
        }
        Refresh(name);
    }

    private void RenameName()
    {
        var old = Selected ?? throw new InvalidOperationException("先选择要修改的项。");
        var name = Required(_name.Text);
        if (old == name) return;
        if (Template.Categories.ContainsKey(name) || Template.Recommendations.ContainsKey(name) ||
            (Template.CandidatePool ?? []).Contains(name)) throw new InvalidOperationException("目标名称已经存在。");
        foreach (var map in new[] { Template.Categories, Template.Recommendations })
            if (map.Remove(old, out var values)) map[name] = values;
        foreach (var key in Template.Recommendations.Keys.ToArray())
            Template.Recommendations[key] = Template.Recommendations[key].Select(x => x == old ? name : x).Distinct().ToArray();
        Template.CandidatePool = (Template.CandidatePool ?? []).Select(x => x == old ? name : x).Distinct().ToArray();
        Refresh(name);
    }

    private void DeleteName()
    {
        if (Selected is not string name) return;
        if (Mode == 2) Template.CandidatePool = (Template.CandidatePool ?? []).Where(x => x != name).ToArray();
        else if (Mode == 1) Template.Recommendations.Remove(name);
        else
        {
            Template.Categories.Remove(name);
            var remaining = Template.Categories.Values.SelectMany(x => x).ToHashSet();
            Template.CriticalTags = (Template.CriticalTags ?? []).Where(remaining.Contains).ToArray();
            Template.Recommendations.Remove(name);
            foreach (var key in Template.Recommendations.Keys.ToArray())
                Template.Recommendations[key] = Template.Recommendations[key].Where(x => x != name).ToArray();
        }
        Refresh();
    }

    private string TagValue()
    {
        var text = Required(_item.Text);
        return Mode == 0 && !text.StartsWith('_') ? "_" + text : text;
    }

    private void AddItem()
    {
        var source = Selected ?? throw new InvalidOperationException("先选择分类或部件。");
        var values = Mode == 0 ? new[] { TagValue() } :
            System.Text.RegularExpressions.Regex.Split(Required(_item.Text), @"[,，\s]+");
        foreach (var value in values)
        {
            if (Mode == 1 && value == source) continue;
            Map[source] = Map[source].Append(value).Distinct().ToArray();
            if (Mode == 1)
            {
                Template.CandidatePool = (Template.CandidatePool ?? []).Append(value).Distinct().ToArray();
                if (_bilateral.IsChecked == true)
                    Template.Recommendations[value] = Template.Recommendations.GetValueOrDefault(value, [])
                        .Append(source).Distinct().ToArray();
            }
        }
        ShowItems();
    }

    private void RenameItem()
    {
        if (Selected is not string source || _items.SelectedItem is not string old) return;
        var value = TagValue();
        if (old != value && Map[source].Contains(value)) throw new InvalidOperationException("已存在相同项。");
        Map[source] = Map[source].Select(x => x == old ? value : x).ToArray();
        if (Mode == 0)
            Template.CriticalTags = (Template.CriticalTags ?? []).Select(x => x == old ? value : x).Distinct().ToArray();
        ShowItems();
    }

    private void DeleteItem()
    {
        if (Selected is not string source || _items.SelectedItem is not string item) return;
        Map[source] = Map[source].Where(x => x != item).ToArray();
        if (Mode == 0) Template.CriticalTags = (Template.CriticalTags ?? []).Where(x => x != item).ToArray();
        ShowItems();
    }

    private void ClearItems()
    {
        if (Selected is not string source) return;
        var removed = Map[source].ToHashSet();
        Map[source] = [];
        if (Mode == 0) Template.CriticalTags = (Template.CriticalTags ?? []).Where(x => !removed.Contains(x)).ToArray();
        ShowItems();
    }

    // 原版 moveOrReorderTag：标签可在分类内排序，也可跨分类移动。
    private void MoveItem(int delta)
    {
        if (Mode == 2) return;
        if (Selected is not string source || _items.SelectedItem is not string item) return;
        var values = Map[source].ToList();
        var index = values.IndexOf(item);
        var target = index + delta;
        if (index < 0 || target < 0 || target >= values.Count) return;
        values.RemoveAt(index);
        values.Insert(target, item);
        Map[source] = values.ToArray();
        ShowItems();
        _items.SelectedItem = item;
    }

    private void MoveToTarget()
    {
        if (Mode == 2) return;
        if (Selected is not string source || _items.SelectedItem is not string item)
            throw new InvalidOperationException("先选择要移动的项。");
        var destination = Required(_moveTarget.Text);
        if (destination == source) throw new InvalidOperationException("目标与当前分类相同。");
        if (Mode == 0 && !Template.Categories.ContainsKey(destination))
            Template.Categories.Add(destination, []);
        if (Mode == 1 && !Template.Recommendations.ContainsKey(destination))
            Template.Recommendations.Add(destination, []);
        var map = Mode == 0 ? Template.Categories : Template.Recommendations;
        map[source] = map[source].Where(x => x != item).ToArray();
        map[destination] = map[destination].Append(item).Distinct().ToArray();
        if (Mode == 0) Template.CandidatePool = (Template.CandidatePool ?? []).Append(destination).Distinct().ToArray();
        Refresh(destination);
    }

    private void SetCritical(bool critical)
    {
        if (_rendering || Mode != 0 || _items.SelectedItem is not string tag) return;
        var set = (Template.CriticalTags ?? []).ToHashSet();
        if (critical) set.Add(tag); else set.Remove(tag);
        Template.CriticalTags = set.ToArray();
    }

    private void Reset()
    {
        var defaults = RuleCatalog.LoadDefaults();
        if (Mode == 0)
        {
            Template.Categories = defaults.Categories;
            Template.CriticalTags = defaults.CriticalTags;
        }
        else if (Mode == 1) Template.Recommendations = defaults.Recommendations;
        else Template.CandidatePool = TemplateService.FromCatalog(defaults, defaults.CriticalTags.ToHashSet()).CandidatePool;
        Refresh();
    }
}
