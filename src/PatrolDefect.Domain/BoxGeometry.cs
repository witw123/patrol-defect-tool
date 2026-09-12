namespace PatrolDefect.Domain;

// 与原版 HTML clampBox / moveBox / resizeBox 对齐的矩形几何。
// 坐标单位由调用方决定（原图像素或比例），min 与边界使用同一单位。
public static class BoxGeometry
{
    public static (double X, double Y, double Width, double Height) Clamp(
        double x, double y, double width, double height, double boundsWidth, double boundsHeight)
    {
        var x1 = Math.Clamp(x, 0, boundsWidth);
        var y1 = Math.Clamp(y, 0, boundsHeight);
        var x2 = Math.Clamp(x + width, 0, boundsWidth);
        var y2 = Math.Clamp(y + height, 0, boundsHeight);
        return (Math.Min(x1, x2), Math.Min(y1, y2), Math.Abs(x2 - x1), Math.Abs(y2 - y1));
    }

    public static (double X, double Y, double Width, double Height) Move(
        double x, double y, double width, double height, double dx, double dy,
        double boundsWidth, double boundsHeight)
        => Clamp(x + dx, y + dy, width, height, boundsWidth, boundsHeight);

    public static (double X, double Y, double Width, double Height) Resize(
        double x, double y, double width, double height, string handle,
        double pointerX, double pointerY, double boundsWidth, double boundsHeight, double min)
    {
        var right = x + width;
        var bottom = y + height;
        var moveLeft = handle is "nw" or "w" or "sw";
        var moveRight = handle is "ne" or "e" or "se";
        var moveTop = handle is "nw" or "n" or "ne";
        var moveBottom = handle is "sw" or "s" or "se";
        if (moveLeft) x = Math.Min(pointerX, right - min);
        if (moveRight) right = Math.Max(pointerX, x + min);
        if (moveTop) y = Math.Min(pointerY, bottom - min);
        if (moveBottom) bottom = Math.Max(pointerY, y + min);
        return Clamp(Math.Min(x, right), Math.Min(y, bottom),
            Math.Abs(right - x), Math.Abs(bottom - y), boundsWidth, boundsHeight);
    }
}
