namespace PatrolDefect.Domain;

public readonly record struct ImageFit(double Left, double Top, double Width, double Height)
{
    public static ImageFit Calculate(double hostWidth, double hostHeight, double imageWidth, double imageHeight)
    {
        if (imageWidth <= 0 || imageHeight <= 0) return default;
        var scale = Math.Min(Math.Max(10, hostWidth - 12) / imageWidth,
            Math.Max(10, hostHeight - 12) / imageHeight);
        var width = Math.Floor(imageWidth * scale + .5);
        var height = Math.Floor(imageHeight * scale + .5);
        return new((hostWidth - width) / 2, (hostHeight - height) / 2, width, height);
    }

    public bool Contains(double x, double y) =>
        Width > 0 && Height > 0 && x >= Left && y >= Top && x <= Left + Width && y <= Top + Height;
}
