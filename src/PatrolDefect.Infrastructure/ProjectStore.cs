using Microsoft.Data.Sqlite;
using PatrolDefect.Domain;

namespace PatrolDefect.Infrastructure;

public sealed class ProjectStore : IDisposable
{
    private readonly SqliteConnection _connection;

    public ProjectStore(string projectRoot)
    {
        var dir = Path.Combine(projectRoot, ".patrol-defect");
        Directory.CreateDirectory(dir);
        _connection = new SqliteConnection($"Data Source={Path.Combine(dir, "project.db")}");
        _connection.Open();
        using var command = _connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS Project (Id INTEGER PRIMARY KEY, PhotoRoot TEXT NOT NULL, OutputRoot TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS Photo (Id INTEGER PRIMARY KEY, RelativePath TEXT NOT NULL UNIQUE, FullPath TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS DefectMark (Id INTEGER PRIMARY KEY AUTOINCREMENT, PhotoId INTEGER NOT NULL, X REAL NOT NULL, Y REAL NOT NULL, Width REAL NOT NULL, Height REAL NOT NULL, StrokeWidth REAL NOT NULL DEFAULT 10, Component TEXT NOT NULL, DefectTag TEXT NOT NULL, Conclusion TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS OutputArtifact (PhotoId INTEGER NOT NULL, FullPath TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS ViewedPhoto (PhotoId INTEGER PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS PhotoDraft (PhotoId INTEGER PRIMARY KEY, Json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS RuleSetting (Id INTEGER PRIMARY KEY CHECK(Id=1), Json TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS AppSetting (Key TEXT PRIMARY KEY, Value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS OperationLog (
                Id INTEGER PRIMARY KEY AUTOINCREMENT, OccurredAt TEXT NOT NULL,
                Operation TEXT NOT NULL, RelativePath TEXT NOT NULL,
                Succeeded INTEGER NOT NULL, Detail TEXT NOT NULL);
            """;
        command.ExecuteNonQuery();
    }

    public IReadOnlyList<PhotoRecord> SavePhotos(IEnumerable<PhotoRecord> photos)
    {
        var result = new List<PhotoRecord>();
        using var transaction = _connection.BeginTransaction();
        foreach (var photo in photos)
        {
            using var command = _connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO Photo(RelativePath, FullPath) VALUES ($relative, $full)
                ON CONFLICT(RelativePath) DO UPDATE SET FullPath=excluded.FullPath;
                SELECT Id FROM Photo WHERE RelativePath=$relative;
                """;
            command.Parameters.AddWithValue("$relative", photo.RelativePath);
            command.Parameters.AddWithValue("$full", photo.FullPath);
            result.Add(photo with { Id = Convert.ToInt64(command.ExecuteScalar()) });
        }
        transaction.Commit();
        return result;
    }

    public void RegisterArtifacts(long photoId, params string[] paths)
    {
        using var transaction = _connection.BeginTransaction();
        foreach (var path in paths)
        {
            using var command = _connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO OutputArtifact(PhotoId, FullPath) VALUES ($photo, $path)";
            command.Parameters.AddWithValue("$photo", photoId);
            command.Parameters.AddWithValue("$path", Path.GetFullPath(path));
            command.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public IReadOnlyList<string> LoadArtifacts(long photoId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT FullPath FROM OutputArtifact WHERE PhotoId=$photo";
        command.Parameters.AddWithValue("$photo", photoId);
        using var reader = command.ExecuteReader();
        var paths = new List<string>();
        while (reader.Read()) paths.Add(reader.GetString(0));
        return paths;
    }

    public IReadOnlyList<(long PhotoId, string Path)> LoadAllArtifacts()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT PhotoId, FullPath FROM OutputArtifact";
        using var reader = command.ExecuteReader();
        var result = new List<(long, string)>();
        while (reader.Read()) result.Add((reader.GetInt64(0), reader.GetString(1)));
        return result;
    }

    public long? FindArtifactPhotoId(string path)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT PhotoId FROM OutputArtifact WHERE FullPath=$path LIMIT 1";
        command.Parameters.AddWithValue("$path", Path.GetFullPath(path));
        return command.ExecuteScalar() is long id ? id : null;
    }

    public void ForgetArtifact(long photoId, string path)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "DELETE FROM OutputArtifact WHERE PhotoId=$photo AND FullPath=$path";
        command.Parameters.AddWithValue("$photo", photoId);
        command.Parameters.AddWithValue("$path", path);
        command.ExecuteNonQuery();
    }

    public void SaveProject(string inputRoot, string outputRoot)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO Project(Id, PhotoRoot, OutputRoot) VALUES (1, $input, $output)
            ON CONFLICT(Id) DO UPDATE SET PhotoRoot = excluded.PhotoRoot, OutputRoot = excluded.OutputRoot;
            """;
        command.Parameters.AddWithValue("$input", inputRoot);
        command.Parameters.AddWithValue("$output", outputRoot);
        command.ExecuteNonQuery();
    }

    public (string InputRoot, string OutputRoot)? LoadProject()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT PhotoRoot, OutputRoot FROM Project WHERE Id=1";
        using var reader = command.ExecuteReader();
        return reader.Read() ? (reader.GetString(0), reader.GetString(1)) : null;
    }

    public void RecordOperation(string operation, string relativePath, bool succeeded, string detail)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO OperationLog(OccurredAt, Operation, RelativePath, Succeeded, Detail)
            VALUES($time, $operation, $path, $success, $detail)
            """;
        command.Parameters.AddWithValue("$time", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$operation", operation);
        command.Parameters.AddWithValue("$path", relativePath);
        command.Parameters.AddWithValue("$success", succeeded ? 1 : 0);
        command.Parameters.AddWithValue("$detail", detail);
        command.ExecuteNonQuery();
    }

    public IReadOnlyList<ProjectOperation> LoadOperations(int limit = 100)
    {
        if (limit is < 1 or > 10000) throw new ArgumentOutOfRangeException(nameof(limit));
        using var command = _connection.CreateCommand();
        command.CommandText = """
            SELECT OccurredAt, Operation, RelativePath, Succeeded, Detail
            FROM OperationLog ORDER BY Id DESC LIMIT $limit
            """;
        command.Parameters.AddWithValue("$limit", limit);
        using var reader = command.ExecuteReader();
        var result = new List<ProjectOperation>();
        while (reader.Read())
            result.Add(new ProjectOperation(DateTimeOffset.Parse(reader.GetString(0),
                System.Globalization.CultureInfo.InvariantCulture), reader.GetString(1),
                reader.GetString(2), reader.GetBoolean(3), reader.GetString(4)));
        return result;
    }

    public void SaveMark(DefectMark mark)
        => SaveMark(mark, null);

    public void SaveDraft(long photoId, string json)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO PhotoDraft(PhotoId, Json) VALUES($photo, $json)
            ON CONFLICT(PhotoId) DO UPDATE SET Json=excluded.Json
            """;
        command.Parameters.AddWithValue("$photo", photoId);
        command.Parameters.AddWithValue("$json", json);
        command.ExecuteNonQuery();
    }

    public string? LoadDraft(long photoId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT Json FROM PhotoDraft WHERE PhotoId=$photo";
        command.Parameters.AddWithValue("$photo", photoId);
        return command.ExecuteScalar() as string;
    }

    public void SaveRuleSetting(string json)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "INSERT INTO RuleSetting(Id, Json) VALUES(1, $json) ON CONFLICT(Id) DO UPDATE SET Json=excluded.Json";
        command.Parameters.AddWithValue("$json", json);
        command.ExecuteNonQuery();
    }

    public string? LoadRuleSetting()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT Json FROM RuleSetting WHERE Id=1";
        return command.ExecuteScalar() as string;
    }

    public void SaveSetting(string key, string value)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = """
            INSERT INTO AppSetting(Key, Value) VALUES($key, $value)
            ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value
            """;
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    public string? LoadSetting(string key)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT Value FROM AppSetting WHERE Key=$key";
        command.Parameters.AddWithValue("$key", key);
        return command.ExecuteScalar() as string;
    }

    public void ReplaceMarks(long photoId, IReadOnlyList<DefectMark> marks)
    {
        if (marks.Any(mark => mark.PhotoId != photoId))
            throw new ArgumentException("Every mark must belong to the selected photo.", nameof(marks));
        if (marks.Select(mark => mark.Id).Distinct().Count() != marks.Count)
            throw new ArgumentException("Mark IDs must be unique.", nameof(marks));
        using var transaction = _connection.BeginTransaction();
        using (var command = _connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = "DELETE FROM DefectMark WHERE PhotoId=$photo";
            command.Parameters.AddWithValue("$photo", photoId);
            command.ExecuteNonQuery();
        }
        foreach (var mark in marks) SaveMark(mark, transaction);
        transaction.Commit();
    }

    private void SaveMark(DefectMark mark, SqliteTransaction? transaction)
    {
        using var command = _connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO DefectMark(Id, PhotoId, X, Y, Width, Height, StrokeWidth, Component, DefectTag, Conclusion)
            VALUES ($id, $photo, $x, $y, $w, $h, $stroke, $component, $tag, $conclusion)
            ON CONFLICT(Id) DO UPDATE SET X=$x, Y=$y, Width=$w, Height=$h,
              StrokeWidth=$stroke, Component=$component, DefectTag=$tag, Conclusion=$conclusion
              WHERE DefectMark.PhotoId=$photo;
            """;
        command.Parameters.AddWithValue("$id", mark.Id);
        command.Parameters.AddWithValue("$photo", mark.PhotoId);
        command.Parameters.AddWithValue("$x", mark.X);
        command.Parameters.AddWithValue("$y", mark.Y);
        command.Parameters.AddWithValue("$w", mark.Width);
        command.Parameters.AddWithValue("$h", mark.Height);
        command.Parameters.AddWithValue("$stroke", mark.StrokeWidth);
        command.Parameters.AddWithValue("$component", mark.Component);
        command.Parameters.AddWithValue("$tag", mark.DefectTag);
        command.Parameters.AddWithValue("$conclusion", mark.Conclusion);
        if (command.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("Mark ID belongs to a different photo.");
    }

    public IReadOnlyList<DefectMark> LoadMarks(long photoId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT Id, PhotoId, X, Y, Width, Height, StrokeWidth, Component, DefectTag, Conclusion FROM DefectMark WHERE PhotoId=$photo";
        command.Parameters.AddWithValue("$photo", photoId);
        using var reader = command.ExecuteReader();
        var result = new List<DefectMark>();
        while (reader.Read())
            result.Add(new DefectMark(reader.GetInt64(0), reader.GetInt64(1), reader.GetDouble(2), reader.GetDouble(3),
                reader.GetDouble(4), reader.GetDouble(5), reader.GetDouble(6), reader.GetString(7), reader.GetString(8), reader.GetString(9)));
        return result;
    }

    public void DeleteMarks(long photoId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "DELETE FROM DefectMark WHERE PhotoId=$photo";
        command.Parameters.AddWithValue("$photo", photoId);
        command.ExecuteNonQuery();
    }

    public HashSet<long> LoadViewedPhotos()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT PhotoId FROM ViewedPhoto";
        using var reader = command.ExecuteReader();
        var result = new HashSet<long>();
        while (reader.Read()) result.Add(reader.GetInt64(0));
        return result;
    }

    // 已标语义与原版一致：以输出成果为权威来源，危急缺陷独立统计、不计入已标。
    private static bool IsCriticalPath(string path) =>
        string.Equals(Path.GetFileName(Path.GetDirectoryName(path) ?? ""),
            "危急缺陷", StringComparison.Ordinal);

    public HashSet<long> LoadMarkedPhotos()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT DISTINCT PhotoId, FullPath FROM OutputArtifact";
        using var reader = command.ExecuteReader();
        var result = new HashSet<long>();
        while (reader.Read())
            if (!IsCriticalPath(reader.GetString(1))) result.Add(reader.GetInt64(0));
        return result;
    }

    public IReadOnlyDictionary<long, int> LoadMarkCounts()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT PhotoId, FullPath FROM OutputArtifact";
        using var reader = command.ExecuteReader();
        var result = new Dictionary<long, int>();
        while (reader.Read())
        {
            if (IsCriticalPath(reader.GetString(1))) continue;
            var id = reader.GetInt64(0);
            result[id] = result.GetValueOrDefault(id) + 1;
        }
        return result;
    }

    public HashSet<long> LoadCriticalPhotoIds()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "SELECT DISTINCT PhotoId, FullPath FROM OutputArtifact";
        using var reader = command.ExecuteReader();
        var result = new HashSet<long>();
        while (reader.Read())
            if (IsCriticalPath(reader.GetString(1))) result.Add(reader.GetInt64(0));
        return result;
    }

    public int ClearViewed()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "DELETE FROM ViewedPhoto";
        return command.ExecuteNonQuery();
    }

    public void RenamePhotoPath(long photoId, string newRelativePath, string newFullPath)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "UPDATE Photo SET RelativePath=$relative, FullPath=$full WHERE Id=$id";
        command.Parameters.AddWithValue("$relative", newRelativePath);
        command.Parameters.AddWithValue("$full", newFullPath);
        command.Parameters.AddWithValue("$id", photoId);
        if (command.ExecuteNonQuery() != 1)
            throw new InvalidOperationException($"照片 {photoId} 不存在，无法更新重命名结果。");
    }

    // 将 oldPrefix 段下的照片相对路径替换到新前缀，保持照片 ID 不变。
    // 兼容正反斜杠两种历史分隔符，统一写回系统分隔符。
    public int RewritePhotoPrefix(string root, string oldPrefix, string newPrefix)
    {
        var separator = Path.DirectorySeparatorChar;
        var oldRelative = oldPrefix.Replace('/', separator) + separator;
        var updated = 0;
        using var transaction = _connection.BeginTransaction();
        using (var select = _connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = "SELECT Id, RelativePath FROM Photo";
            using var reader = select.ExecuteReader();
            var pending = new List<(long Id, string Relative)>();
            while (reader.Read())
            {
                var relative = reader.GetString(1);
                var normalized = relative.Replace('/', separator);
                if (!normalized.StartsWith(oldRelative, StringComparison.Ordinal)) continue;
                pending.Add((reader.GetInt64(0), newPrefix + separator + normalized[oldRelative.Length..]));
            }
            foreach (var (id, relative) in pending)
            {
                using var update = _connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE Photo SET RelativePath=$relative, FullPath=$full WHERE Id=$id";
                update.Parameters.AddWithValue("$relative", relative);
                update.Parameters.AddWithValue("$full", Path.Combine(root, relative));
                update.Parameters.AddWithValue("$id", id);
                update.ExecuteNonQuery();
                updated++;
            }
        }
        transaction.Commit();
        return updated;
    }

    public void MarkViewed(long photoId)
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "INSERT OR IGNORE INTO ViewedPhoto(PhotoId) VALUES ($photo)";
        command.Parameters.AddWithValue("$photo", photoId);
        command.ExecuteNonQuery();
    }

    public void Dispose() => _connection.Dispose();
}

public sealed record ProjectOperation(DateTimeOffset OccurredAt, string Operation,
    string RelativePath, bool Succeeded, string Detail);
