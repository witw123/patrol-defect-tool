using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Markup;

namespace PatrolDefect.App;

public partial class App : Microsoft.UI.Xaml.Application
{
    private Window? _window;

    public static string LogDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PatrolDefect");

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }

    // 阶段 6：崩溃日志，未处理异常附加写入本地日志文件。
    public App()
    {
        InitializeComponent();
        UnhandledException += (_, args) =>
        {
            try
            {
                Directory.CreateDirectory(LogDirectory);
                File.AppendAllText(Path.Combine(LogDirectory, "crash.log"),
                    $"{DateTimeOffset.Now:O}{Environment.NewLine}{args.Message}{Environment.NewLine}{args.Exception}{Environment.NewLine}{new string('-', 60)}{Environment.NewLine}");
            }
            catch { /* 日志写入失败不再抛出 */ }
        };
    }
}
