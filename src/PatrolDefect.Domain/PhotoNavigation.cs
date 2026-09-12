namespace PatrolDefect.Domain;

public static class PhotoNavigation
{
    public static PhotoRecord? FurthestViewed(IReadOnlyList<PhotoRecord> photos, IReadOnlySet<long> viewed) =>
        photos.LastOrDefault(photo => viewed.Contains(photo.Id)) ?? photos.FirstOrDefault();

    public static PhotoRecord? Next(IReadOnlyList<PhotoRecord> photos, long? currentId, int direction,
        Func<PhotoRecord, bool> visible)
    {
        var currentIndex = -1;
        for (var i = 0; i < photos.Count; i++)
            if (photos[i].Id == currentId) { currentIndex = i; break; }
        var step = direction < 0 ? -1 : 1;
        if (currentIndex < 0) currentIndex = step > 0 ? -1 : photos.Count;
        for (var i = currentIndex + step; i >= 0 && i < photos.Count; i += step)
            if (visible(photos[i])) return photos[i];
        return null;
    }
}
