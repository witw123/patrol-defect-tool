using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using PatrolDefect.Infrastructure;

namespace PatrolDefect.App;

// 批处理进度对话框：实时成功/失败计数，结束后展示失败文件列表（阶段 5 完成标准）。
public sealed partial class MainWindow
{
    private async Task RunBatchAsync(string title, string operation,
        Func<CancellationToken, IProgress<(int Success, int Failed)>, Task<BatchResult>> work)
    {
        if (_saving || _opening) return;
        _saving = true;
        try
        {
            var cts = new CancellationTokenSource();
            var counts = new TextBlock { Text = "处理中…" };
            var dialog = new ContentDialog
            {
                Title = title,
                Content = new StackPanel { Spacing = 12, Children =
                {
                    new ProgressRing { IsActive = true, Width = 36, Height = 36 },
                    counts
                } },
                PrimaryButtonText = "取消",
                XamlRoot = Content.XamlRoot
            };
            var progress = new Progress<(int Success, int Failed)>(x =>
                counts.Text = $"成功 {x.Success} · 失败 {x.Failed}");
            var workTask = Task.Run(() => work(cts.Token, progress));
            var shownTask = dialog.ShowAsync().AsTask();
            var finished = await Task.WhenAny(workTask, shownTask);
            if (finished == shownTask)
            {
                cts.Cancel();
                var partial = await workTask;
                RecordOperation(operation, "", false, $"cancelled, success {partial.Success}, failed {partial.Failed}");
                return;
            }
            var result = await workTask;
            DispatcherQueue.TryEnqueue(dialog.Hide);
            await shownTask;
            var summary = $"成功 {result.Success} · 失败 {result.Failed}";
            StackPanel content = new() { Spacing = 8 };
            content.Children.Add(new TextBlock { Text = summary });
            if (result.Errors.Count > 0)
            {
                content.Children.Add(new TextBlock { Text = "失败文件：", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
                var errors = new TextBox
                {
                    Text = string.Join(Environment.NewLine, result.Errors),
                    IsReadOnly = true,
                    AcceptsReturn = true,
                    TextWrapping = TextWrapping.NoWrap,
                    Height = 200
                };
                ScrollViewer.SetVerticalScrollBarVisibility(errors, ScrollBarVisibility.Auto);
                ScrollViewer.SetHorizontalScrollBarVisibility(errors, ScrollBarVisibility.Auto);
                content.Children.Add(errors);
            }
            await new ContentDialog
            {
                Title = title + "完成",
                Content = content,
                CloseButtonText = "确定",
                XamlRoot = Content.XamlRoot
            }.ShowAsync();
            RecordOperation(operation, "", result.Failed == 0,
                $"success {result.Success}, failed {result.Failed}" +
                (result.Errors.Count > 0 ? Environment.NewLine + string.Join(Environment.NewLine, result.Errors) : ""));
        }
        catch (Exception error)
        {
            StatusText.Text = $"{title}失败：{error.Message}";
            RecordOperation(operation, "", false, error.ToString());
        }
        finally
        {
            _saving = false;
        }
    }
}
