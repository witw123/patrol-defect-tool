using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Key = Windows.System.VirtualKey;

namespace PatrolDefect.App;

// 设置：深色模式、自定义快捷键、鼠标手势、侧栏宽度、线宽与首次使用提示。
// 原版对应 applyTheme / loadPersisted / initResizers / initNotice。
public sealed partial class MainWindow
{
    private Key? _shortcutPrev;
    private Key? _shortcutNext;
    private Key? _shortcutSave;
    private bool _settingsReady;

    private void SaveSetting(string key, string value)
    {
        try { _store?.SaveSetting(key, value); }
        catch { /* 设置写入失败不阻塞操作 */ }
    }

    private string? LoadSetting(string key) => _store?.LoadSetting(key);

    // 打开项目后恢复持久化设置并应用。
    private void RestoreSettings()
    {
        _settingsReady = false;
        try
        {
            // 与原版一致默认浅色主题；设置中可切换深色。
            RootGrid.RequestedTheme = LoadSetting("theme") == "dark" ? ElementTheme.Dark : ElementTheme.Light;
            if (LoadSetting("stroke") is { } stroke && double.TryParse(stroke, out var width))
                StrokeSlider.Value = Math.Clamp(width, StrokeSlider.Minimum, StrokeSlider.Maximum);
            if (LoadSetting("left_width") is { } left && double.TryParse(left, out var leftWidth) && leftWidth >= 240)
                LeftColumn.Width = new GridLength(leftWidth);
            if (LoadSetting("right_width") is { } right && double.TryParse(right, out var rightWidth) && rightWidth >= 220)
                RightColumn.Width = new GridLength(rightWidth);
            _clickNavigate = LoadSetting("click_navigate") == "1";
            if (LoadSetting("hidden_tags") is { } hidden)
                _hiddenTags = new HashSet<string>(
                    System.Text.Json.JsonSerializer.Deserialize<string[]>(hidden) ?? [],
                    StringComparer.Ordinal);
            _shortcutPrev = ParseShortcut(LoadSetting("shortcut_prev"));
            _shortcutNext = ParseShortcut(LoadSetting("shortcut_next"));
            _shortcutSave = ParseShortcut(LoadSetting("shortcut_save"));
        }
        finally
        {
            _settingsReady = true;
        }
    }

    private static Key? ParseShortcut(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Enum.TryParse(name, ignoreCase: true, out Key key) ? key : null;
    }

    private async void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (_opening || _saving) return;
        var theme = new CheckBox { Content = "黑夜模式", MinWidth = 120 };
        var gesture = new CheckBox { Content = "图片区域左键下一张、右键上一张" };
        var prev = new TextBox { Header = "上一张快捷键（如 A、F1、Space）" };
        var next = new TextBox { Header = "下一张快捷键" };
        var save = new TextBox { Header = "保存快捷键" };
        theme.IsChecked = RootGrid.RequestedTheme == ElementTheme.Dark;
        gesture.IsChecked = _clickNavigate;
        prev.Text = _shortcutPrev?.ToString() ?? "";
        next.Text = _shortcutNext?.ToString() ?? "";
        save.Text = _shortcutSave?.ToString() ?? "";
        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(theme);
        panel.Children.Add(gesture);
        panel.Children.Add(new TextBlock { Text = "自定义快捷键（方向键与 A/D/C/Ctrl+Z 恒可用，留空恢复默认）", TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(prev);
        panel.Children.Add(next);
        panel.Children.Add(save);
        var dialog = new ContentDialog
        {
            Title = "设置",
            Content = new ScrollViewer { Content = panel, VerticalScrollBarVisibility = ScrollBarVisibility.Auto },
            PrimaryButtonText = "保存",
            CloseButtonText = "取消",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = Content.XamlRoot
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        RootGrid.RequestedTheme = theme.IsChecked == true ? ElementTheme.Dark : ElementTheme.Light;
        SaveSetting("theme", theme.IsChecked == true ? "dark" : "light");
        _clickNavigate = gesture.IsChecked == true;
        SaveSetting("click_navigate", _clickNavigate ? "1" : "0");
        _shortcutPrev = ParseShortcut(prev.Text.Trim());
        _shortcutNext = ParseShortcut(next.Text.Trim());
        _shortcutSave = ParseShortcut(save.Text.Trim());
        SaveSetting("shortcut_prev", _shortcutPrev?.ToString() ?? "");
        SaveSetting("shortcut_next", _shortcutNext?.ToString() ?? "");
        SaveSetting("shortcut_save", _shortcutSave?.ToString() ?? "");
        StatusText.Text = "设置已保存";
    }

    // 原版 initNotice：首次使用说明，可勾选“不再提示”。
    private async void ShowFirstUseNotice()
    {
        if (LoadSetting("no_prompt") == "1") return;
        var noPrompt = new CheckBox { Content = "不再提示" };
        var dialog = new ContentDialog
        {
            Title = "使用说明",
            Content = new ScrollViewer
            {
                Content = new StackPanel { Spacing = 8,
                    Children =
                    {
                        new TextBlock { Text = "1. 打开照片目录后，左侧目录树按线路、杆塔、照片三级显示，双击名称可重命名。", TextWrapping = TextWrapping.Wrap },
                        new TextBlock { Text = "2. 画布中左键拖拽绘制红框；点击红框选中后可移动、八向调整；右上角圆钮删除选中框。", TextWrapping = TextWrapping.Wrap },
                        new TextBlock { Text = "3. 右键拖动平移图片，滚轮缩放，双击恢复适应窗口。", TextWrapping = TextWrapping.Wrap },
                        new TextBlock { Text = "4. 快捷键：A/D 或方向键翻图，空格或 Alt+S 保存，Ctrl+Z 撤回，Delete 删除选中框，C 返回最后已看。", TextWrapping = TextWrapping.Wrap },
                        new TextBlock { Text = "5. 右侧选择部件与缺陷标签后保存，成果输出到输出目录，可在设置中自定义快捷键与深色模式。", TextWrapping = TextWrapping.Wrap },
                        noPrompt
                    }
                },
                MaxHeight = 400,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto
            },
            PrimaryButtonText = "开始使用",
            XamlRoot = Content.XamlRoot
        };
        await dialog.ShowAsync();
        if (noPrompt.IsChecked == true) SaveSetting("no_prompt", "1");
    }

    // 原版 initResizers：拖动调整左右栏宽度。
    private void AttachResizers(CanvasSurface handle, bool isLeft)
    {
        double? startX = null;
        double? startWidth = null;
        handle.PointerEntered += (_, _) => handle.SetCursor(Microsoft.UI.Input.InputSystemCursorShape.SizeWestEast);
        handle.PointerExited += (_, _) => handle.ResetCursor();
        handle.PointerPressed += (_, args) =>
        {
            startX = args.GetCurrentPoint(RootGrid).Position.X;
            startWidth = isLeft ? LeftColumn.Width.Value : RightColumn.Width.Value;
            handle.CapturePointer(args.Pointer);
            args.Handled = true;
        };
        handle.PointerMoved += (_, args) =>
        {
            if (startX is null || startWidth is null) return;
            var delta = args.GetCurrentPoint(RootGrid).Position.X - startX.Value;
            var width = isLeft ? startWidth.Value + delta : startWidth.Value - delta;
            if (isLeft) LeftColumn.Width = new GridLength(Math.Clamp(width, 240, 700));
            else RightColumn.Width = new GridLength(Math.Clamp(width, 220, 700));
            args.Handled = true;
        };
        handle.PointerReleased += (_, args) =>
        {
            if (startX is not null)
            {
                var width = isLeft ? LeftColumn.Width.Value : RightColumn.Width.Value;
                SaveSetting(isLeft ? "left_width" : "right_width", width.ToString("0"));
                startX = null;
                startWidth = null;
            }
            handle.ReleasePointerCapture(args.Pointer);
            args.Handled = true;
        };
    }
}
