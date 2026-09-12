using PatrolDefect.Application;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;
using Xunit;

namespace PatrolDefect.Infrastructure.Tests;

public sealed class ProjectTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "PatrolTests", Guid.NewGuid().ToString("N"));

    public ProjectTests() => Directory.CreateDirectory(_root);

    private PhotoRecord Photo(string relative, long scanId) =>
        new(scanId, relative, Path.Combine(_root, relative), "线路", "#001");

    [Fact]
    public void Rescanning_reordered_files_preserves_ids_and_marks()
    {
        long savedId;
        using (var store = new ProjectStore(_root))
        {
            savedId = store.SavePhotos([Photo("塔1/照片.jpg", 1)])[0].Id;
            store.SaveMark(new DefectMark(1, savedId, .1, .2, .3, .4, 10, "部件", "缺陷", "DefectFound"));
        }
        using (var store = new ProjectStore(_root))
        {
            var photos = store.SavePhotos([Photo("塔2/照片.jpg", 1), Photo("塔1/照片.jpg", 2)]);
            Assert.Equal(savedId, photos[1].Id);
            Assert.NotEqual(savedId, photos[0].Id);
            Assert.Single(store.LoadMarks(photos[1].Id));
            Assert.Empty(store.LoadMarks(photos[0].Id));
        }
    }

    [Fact]
    public void Cancel_only_removes_registered_paths_for_selected_photo()
    {
        using var store = new ProjectStore(_root);
        var photos = store.SavePhotos([Photo("塔1/照片.jpg", 1), Photo("塔2/照片.jpg", 2)]);
        var first = Path.Combine(_root, "照片_缺陷.jpg");
        var second = Path.Combine(_root, "照片_缺陷_2.jpg");
        File.WriteAllText(first, "first");
        File.WriteAllText(second, "second");
        store.RegisterArtifacts(photos[0].Id, first);
        store.RegisterArtifacts(photos[1].Id, second);
        Assert.Equal(1, new OutputRepository().DeleteArtifacts(store, photos[0].Id));
        Assert.False(File.Exists(first));
        Assert.True(File.Exists(second));
        Assert.Single(store.LoadArtifacts(photos[1].Id));
        Assert.Empty(store.LoadArtifacts(photos[0].Id));
    }

    [Fact]
    public void Operation_log_preserves_timestamp_failure_details_and_order()
    {
        var before = DateTimeOffset.UtcNow;
        using (var store = new ProjectStore(_root))
        {
            store.RecordOperation("OpenProject", "", true, "opened");
            store.RecordOperation("SaveArtifacts", "塔1/照片.jpg", false, "Access denied");
        }
        using var reopened = new ProjectStore(_root);
        var latest = Assert.Single(reopened.LoadOperations(1));
        Assert.Equal("SaveArtifacts", latest.Operation);
        Assert.False(latest.Succeeded);
        Assert.Equal("塔1/照片.jpg", latest.RelativePath);
        Assert.Equal("Access denied", latest.Detail);
        Assert.InRange(latest.OccurredAt, before, DateTimeOffset.UtcNow);
        Assert.Equal(2, reopened.LoadOperations().Count);
    }

    [Fact]
    public void Output_folder_is_independent_and_survives_reopen()
    {
        var output = Path.Combine(_root, "separate-output");
        using (var store = new ProjectStore(_root))
        {
            Assert.Null(store.LoadProject());
            store.SaveProject(_root, output);
        }
        using var reopened = new ProjectStore(_root);
        Assert.Equal((_root, output), reopened.LoadProject()!.Value);
        reopened.SavePhotos([Photo("塔1/照片.jpg", 1)]);
        Assert.Equal(output, reopened.LoadProject()!.Value.OutputRoot);
    }

    [Fact]
    public void Repeated_saves_replace_marks_and_collision_rolls_back()
    {
        using var store = new ProjectStore(_root);
        var photos = store.SavePhotos([Photo("塔1/照片.jpg", 1), Photo("塔2/照片.jpg", 2)]);
        var first = new DefectMark(100, photos[0].Id, .1, .1, .2, .2, 10, "部件", "缺陷", "DefectFound");
        store.ReplaceMarks(photos[0].Id, [first]);
        var revised = first with { Id = 200, Width = .3 };
        store.ReplaceMarks(photos[0].Id, [revised]);
        Assert.Equal(revised, Assert.Single(store.LoadMarks(photos[0].Id)));
        store.SaveMark(first with { Id = 300, PhotoId = photos[1].Id });
        Assert.Throws<InvalidOperationException>(() =>
            store.ReplaceMarks(photos[0].Id, [revised with { Id = 300 }]));
        Assert.Equal(revised, Assert.Single(store.LoadMarks(photos[0].Id)));
        Assert.Single(store.LoadMarks(photos[1].Id));
    }

    [Fact]
    public void Viewed_state_survives_reopen_and_mark_cancellation()
    {
        long id;
        using (var store = new ProjectStore(_root))
        {
            id = store.SavePhotos([Photo("塔1/照片.jpg", 1)])[0].Id;
            store.MarkViewed(id);
            store.MarkViewed(id);
            store.SaveMark(new DefectMark(1, id, .1, .1, .2, .2, 10, "部件", "缺陷", "DefectFound"));
            store.DeleteMarks(id);
        }
        using var reopened = new ProjectStore(_root);
        Assert.Equal(id, Assert.Single(reopened.LoadViewedPhotos()));
        Assert.Empty(reopened.LoadMarkedPhotos());
    }

    [Fact]
    public void Scanner_skips_html_output_and_dot_directories()
    {
        foreach (var directory in new[] { "线路/#001/DCIM", "缺陷圈示图", ".cache", "缺陷原图", "危急缺陷" })
        {
            var path = Path.Combine(_root, directory);
            Directory.CreateDirectory(path);
            File.WriteAllText(Path.Combine(path, "照片.jpg"), "fixture");
        }
        var photo = Assert.Single(new PhotoScanner().Scan(_root));
        Assert.Equal("线路", photo.LineName);
        Assert.Equal("#001", photo.TowerName);
    }

    [Fact]
    public void Mark_counts_clear_viewed_and_settings_survive_reopen()
    {
        using (var store = new ProjectStore(_root))
        {
            var photos = store.SavePhotos([Photo(@"塔1\照片.jpg", 1), Photo(@"塔1\照片2.jpg", 2)]);
            var first = Path.Combine(_root, "缺陷圈示图", "全绝缘缺陷", "out.jpg");
            Directory.CreateDirectory(Path.GetDirectoryName(first)!);
            File.WriteAllText(first, "fixture");
            var second = Path.Combine(_root, "缺陷圈示图", "其他缺陷", "out2.jpg");
            Directory.CreateDirectory(Path.GetDirectoryName(second)!);
            File.WriteAllText(second, "fixture");
            var critical = Path.Combine(_root, "危急缺陷", "out.jpg");
            Directory.CreateDirectory(Path.GetDirectoryName(critical)!);
            File.WriteAllText(critical, "fixture");
            store.RegisterArtifacts(photos[0].Id, first, critical);
            store.RegisterArtifacts(photos[1].Id, second);
            store.SaveMark(new DefectMark(1, photos[0].Id, .1, .1, .2, .2, 10, "部件", "缺陷", "DefectFound"));

            // 已标与计数以成果为权威来源，危急缺陷独立统计不计入已标。
            Assert.Equal(1, store.LoadMarkCounts()[photos[0].Id]);
            Assert.Equal(1, store.LoadMarkCounts()[photos[1].Id]);
            Assert.Contains(photos[0].Id, store.LoadMarkedPhotos());
            Assert.Contains(photos[1].Id, store.LoadMarkedPhotos());
            Assert.Equal(photos[0].Id, Assert.Single(store.LoadCriticalPhotoIds()));
            store.MarkViewed(photos[0].Id);
            store.SaveSetting("theme", "dark");
            Assert.Equal("dark", store.LoadSetting("theme"));
        }
        using var reopened = new ProjectStore(_root);
        Assert.Equal(2, reopened.LoadMarkCounts().Values.Sum());
        Assert.Equal(2, reopened.LoadMarkedPhotos().Count);
        Assert.Single(reopened.LoadCriticalPhotoIds());
        reopened.ClearViewed();
        Assert.Empty(reopened.LoadViewedPhotos());
        Assert.Equal("dark", reopened.LoadSetting("theme"));
    }

    [Fact]
    public void Sync_imports_outputs_via_manifest_and_stem_fallback()
    {
        var outputRoot = Path.Combine(_root, "output");
        using (var store = new ProjectStore(_root))
        {
            var photos = store.SavePhotos([Photo(@"塔1\照片.jpg", 1), Photo(@"塔2\另一张.png", 2)]);
            Directory.CreateDirectory(outputRoot);
            var matched = Path.Combine(outputRoot, "缺陷圈示图", "全绝缘缺陷", "照片_导线-裸导线.jpg");
            Directory.CreateDirectory(Path.GetDirectoryName(matched)!);
            File.WriteAllText(matched, "fixture");
            var unmatched = Path.Combine(outputRoot, "危急缺陷", "另一张.png");
            Directory.CreateDirectory(Path.GetDirectoryName(unmatched)!);
            File.WriteAllText(unmatched, "fixture");
            new OutputRepository().Sync(store, photos, outputRoot);
            Assert.Single(store.LoadArtifacts(photos[0].Id));
            Assert.Single(store.LoadArtifacts(photos[1].Id));
        }

        // 清单存在时按 origName/relPath 精确映射导入（含无清单时的文件名兜底已覆盖）。
        using var reopened = new ProjectStore(_root);
        var manifest = new OutputManifestService().Read(outputRoot);
        Assert.Equal(2, manifest.Count);
        Assert.Contains("缺陷圈示图/全绝缘缺陷/照片_导线-裸导线.jpg", manifest.Keys);
        Assert.Equal("照片.jpg", manifest["缺陷圈示图/全绝缘缺陷/照片_导线-裸导线.jpg"].OrigName);
    }

    [Fact]
    public void Photo_path_rename_updates_row_and_keeps_other_photos()
    {
        using var store = new ProjectStore(_root);
        var photos = store.SavePhotos([Photo(@"塔1\照片.jpg", 1), Photo(@"塔1\照片2.jpg", 2)]);
        store.MarkViewed(photos[0].Id);
        var newPath = Path.Combine(_root, "塔1", "新名称.jpg");
        store.RenamePhotoPath(photos[0].Id, Path.Combine("塔1", "新名称.jpg"), newPath);
        var rescanned = store.SavePhotos(
        [
            new PhotoRecord(1, Path.Combine("塔1", "新名称.jpg"), newPath, "线路", "#001"),
            new PhotoRecord(1, Path.Combine("塔1", "照片2.jpg"), Path.Combine(_root, "塔1", "照片2.jpg"), "线路", "#001")
        ]);
        var renamed = rescanned.Single(photo => photo.RelativePath == Path.Combine("塔1", "新名称.jpg"));
        Assert.Equal(photos[0].Id, renamed.Id);
        Assert.Equal(photos[0].Id, Assert.Single(store.LoadViewedPhotos()));
        Assert.Contains(photos[1].Id, rescanned.Select(photo => photo.Id));
    }

    [Fact]
    public void Tower_prefix_rewrite_moves_photos_and_keeps_ids()
    {
        using var store = new ProjectStore(_root);
        var photos = store.SavePhotos([Photo(@"线路\塔1\照片.jpg", 1), Photo(@"线路\塔1\照片2.jpg", 2)]);
        store.SaveMark(new DefectMark(1, photos[0].Id, .1, .1, .2, .2, 10, "部件", "缺陷", "DefectFound"));
        var updated = store.RewritePhotoPrefix(_root,
            Path.Combine("线路", "塔1"), Path.Combine("线路", "塔2"));
        Assert.Equal(2, updated);
        using var reopened = new ProjectStore(_root);
        var rescanned = reopened.SavePhotos(
        [
            new PhotoRecord(1, Path.Combine("线路", "塔2", "照片.jpg"),
                Path.Combine(_root, "线路", "塔2", "照片.jpg"), "线路", "塔2"),
            new PhotoRecord(1, Path.Combine("线路", "塔2", "照片2.jpg"),
                Path.Combine(_root, "线路", "塔2", "照片2.jpg"), "线路", "塔2")
        ]);
        Assert.All(rescanned, photo => Assert.Equal("塔2", photo.TowerName));
        Assert.Equal(photos[0].Id, rescanned[0].Id);
        Assert.Equal(photos[1].Id, rescanned[1].Id);
        Assert.Single(reopened.LoadMarks(photos[0].Id));
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(_root, recursive: true);
    }
}
