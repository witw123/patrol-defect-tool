using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Microsoft.UI.Xaml.Shapes;
using Windows.Foundation;
using PatrolDefect.Domain;
using PatrolDefect.Infrastructure;

namespace PatrolDefect.App;

// 画布视口与红框编辑，交互语义对照原版 HTML：
// 左键拖拽画框、点框选中、八向手柄调整、右上角圆钮删除选中框、
// 右键/中键平移、滚轮以光标为中心缩放、双击适应窗口、Ctrl+Z 撤回。
public sealed partial class MainWindow
{
    private const double HandleSize = 8;          // 原版 HANDLE_PX
    private const double DeleteButtonRadius = 10;
    private const double DeleteHitRadius = 13;
    private const double DeleteButtonOffset = 12;
    private const double HitTolerance = 4;
    private const double MinZoom = 0.1;
    private const double MaxZoom = 10;
    private const double ZoomStep = 1.15;
    private const double MinBoxPixels = 3;

    private readonly List<MarkBox> _boxes = [];
    private readonly List<string> _undoHistory = [];
    private readonly List<FrameworkElement> _selectionVisuals = [];
    private int _selectedBox = -1;
    private CanvasMode _canvasMode = CanvasMode.Idle;
    private MarkBox _dragOrigin = new(0, 0, 0, 0);
    private string _dragHandle = "";
    private Point _dragStartRatio;
    private Point _dragStartScreen;
    private bool _dragging;
    private bool _panMoved;
    private bool _clickNavigate;
    private bool _dirty;
    private InputSystemCursorShape _cursorShape = InputSystemCursorShape.Arrow;

    private enum CanvasMode { Idle, Draw, Move, Resize, Pan }

    // 图片在画布宿主坐标系中的显示矩形（含缩放与平移）。
    private Rect ImageRect => new(
        _fit.Left + _panX - (_zoom - 1) * _fit.Width / 2,
        _fit.Top + _panY - (_zoom - 1) * _fit.Height / 2,
        _fit.Width * _zoom,
        _fit.Height * _zoom);

    private (double Width, double Height) NaturalPixelSize =>
        (PreviewImage.Source is BitmapSource bitmap ? bitmap.PixelWidth : 0,
         PreviewImage.Source is BitmapSource bitmap2 ? bitmap2.PixelHeight : 0);

    private Point ToRatio(Point screen, Rect image) => new(
        image.Width > 0 ? (screen.X - image.X) / image.Width : 0,
        image.Height > 0 ? (screen.Y - image.Y) / image.Height : 0);

    private Point RatioToScreen(MarkBox box, double xFraction, double yFraction, Rect image) => new(
        image.X + (box.X + box.Width * xFraction) * image.Width,
        image.Y + (box.Y + box.Height * yFraction) * image.Height);

    private double StrokeScreenThickness()
    {
        var (pixelWidth, _) = NaturalPixelSize;
        return pixelWidth > 0 && ImageRect.Width > 0
            ? StrokeSlider.Value * ImageRect.Width / pixelWidth : StrokeSlider.Value;
    }

    private void ApplyViewport()
    {
        var image = ImageRect;
        PreviewImage.Width = image.Width;
        PreviewImage.Height = image.Height;
        MarkCanvas.Width = image.Width;
        MarkCanvas.Height = image.Height;
        Canvas.SetLeft(PreviewImage, image.X);
        Canvas.SetTop(PreviewImage, image.Y);
        Canvas.SetLeft(MarkCanvas, image.X);
        Canvas.SetTop(MarkCanvas, image.Y);
        RenderBoxes();
    }

    private void ResetViewport()
    {
        _zoom = 1;
        _panX = 0;
        _panY = 0;
        ApplyViewport();
    }

    private void CanvasHost_PointerWheelChanged(object sender, PointerRoutedEventArgs e)
    {
        if (_currentPhoto is null || _fit.Width <= 0) return;
        var point = e.GetCurrentPoint(CanvasHost);
        ZoomAt(point.Position, point.Properties.MouseWheelDelta > 0 ? ZoomStep : 1 / ZoomStep);
        e.Handled = true;
    }

    // 原版 zoomAt：保持光标下的图片点不动。
    private void ZoomAt(Point screen, double factor)
    {
        var newZoom = Math.Clamp(_zoom * factor, MinZoom, MaxZoom);
        if (newZoom == _zoom) return;
        var before = ImageRect;
        var ratio = ToRatio(screen, before);
        _zoom = newZoom;
        var after = ImageRect;
        var targetX = screen.X - ratio.X * after.Width;
        var targetY = screen.Y - ratio.Y * after.Height;
        _panX += targetX - after.X;
        _panY += targetY - after.Y;
        ApplyViewport();
    }

    private void CanvasHost_DoubleTapped(object sender, DoubleTappedRoutedEventArgs e)
    {
        if (_currentPhoto is null) return;
        ResetViewport();
        e.Handled = true;
    }

    private void CanvasHost_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (_currentPhoto is null || _saving || _opening) return;
        var point = e.GetCurrentPoint(CanvasHost);
        var position = point.Position;
        if (point.Properties.IsXButton1Pressed)
        {
            _ = SelectRelativePhoto(-1);
            e.Handled = true;
            return;
        }
        if (point.Properties.IsXButton2Pressed)
        {
            _ = SelectRelativePhoto(1);
            e.Handled = true;
            return;
        }
        if (point.Properties.IsRightButtonPressed || point.Properties.IsMiddleButtonPressed)
        {
            _canvasMode = CanvasMode.Pan;
            _dragStartScreen = position;
            _panMoved = false;
            CanvasHost.CapturePointer(e.Pointer);
            e.Handled = true;
            return;
        }
        if (!point.Properties.IsLeftButtonPressed || _fit.Width <= 0 || !_fit.Contains(position.X, position.Y)) return;

        var image = ImageRect;
        var (pixelWidth, pixelHeight) = NaturalPixelSize;
        var ratio = ToRatio(position, image);
        if (_selectedBox >= 0 && _selectedBox < _boxes.Count)
        {
            if (HitsDeleteButton(position))
            {
                DeleteSelectedBox();
                e.Handled = true;
                return;
            }
            var handle = HitHandle(position);
            if (handle is not null)
            {
                _canvasMode = CanvasMode.Resize;
                _dragOrigin = _boxes[_selectedBox];
                _dragHandle = handle;
                _dragStartRatio = ratio;
                _dragging = true;
                CanvasHost.CapturePointer(e.Pointer);
                e.Handled = true;
                return;
            }
        }

        var index = HitBox(position);
        if (index >= 0)
        {
            _selectedBox = index;
            _canvasMode = CanvasMode.Move;
            _dragOrigin = _boxes[index];
            _dragStartRatio = ratio;
            _dragging = true;
            RenderBoxes();
            CanvasHost.CapturePointer(e.Pointer);
            e.Handled = true;
            return;
        }

        _selectedBox = -1;
        _canvasMode = CanvasMode.Draw;
        _dragOrigin = new MarkBox(ratio.X, ratio.Y, 0, 0);
        _dragStartRatio = ratio;
        _dragging = true;
        RenderBoxes();
        CanvasHost.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void CanvasHost_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (_currentPhoto is null) return;
        var position = e.GetCurrentPoint(CanvasHost).Position;
        switch (_canvasMode)
        {
            case CanvasMode.Pan:
                _panX += position.X - _dragStartScreen.X;
                _panY += position.Y - _dragStartScreen.Y;
                if (Math.Abs(position.X - _dragStartScreen.X) + Math.Abs(position.Y - _dragStartScreen.Y) > 2)
                    _panMoved = true;
                _dragStartScreen = position;
                ApplyViewport();
                e.Handled = true;
                return;
            case CanvasMode.Idle:
                UpdateHoverCursor(position);
                return;
        }
        if (!_dragging) return;
        var image = ImageRect;
        var (pixelWidth, pixelHeight) = NaturalPixelSize;
        var ratio = ToRatio(position, image);
        if (_canvasMode == CanvasMode.Draw)
        {
            RenderBoxes(Normalize(_dragStartRatio, ratio));
        }
        else if (_canvasMode == CanvasMode.Move && _selectedBox >= 0 && _selectedBox < _boxes.Count)
        {
            var (x, y, width, height) = BoxGeometry.Move(_dragOrigin.X * pixelWidth, _dragOrigin.Y * pixelHeight,
                _dragOrigin.Width * pixelWidth, _dragOrigin.Height * pixelHeight,
                (ratio.X - _dragStartRatio.X) * pixelWidth, (ratio.Y - _dragStartRatio.Y) * pixelHeight,
                pixelWidth, pixelHeight);
            _boxes[_selectedBox] = new MarkBox(pixelWidth > 0 ? x / pixelWidth : 0, pixelHeight > 0 ? y / pixelHeight : 0,
                pixelWidth > 0 ? width / pixelWidth : 0, pixelHeight > 0 ? height / pixelHeight : 0);
            RenderBoxes();
        }
        else if (_canvasMode == CanvasMode.Resize && _selectedBox >= 0 && _selectedBox < _boxes.Count)
        {
            var (x, y, width, height) = BoxGeometry.Resize(_dragOrigin.X * pixelWidth, _dragOrigin.Y * pixelHeight,
                _dragOrigin.Width * pixelWidth, _dragOrigin.Height * pixelHeight, _dragHandle,
                ratio.X * pixelWidth, ratio.Y * pixelHeight, pixelWidth, pixelHeight, MinBoxPixels);
            _boxes[_selectedBox] = new MarkBox(pixelWidth > 0 ? x / pixelWidth : 0, pixelHeight > 0 ? y / pixelHeight : 0,
                pixelWidth > 0 ? width / pixelWidth : 0, pixelHeight > 0 ? height / pixelHeight : 0);
            RenderBoxes();
        }
        e.Handled = true;
    }

    private static Point Normalize(Point a, Point b) => new(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y));

    private void CanvasHost_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (_canvasMode is CanvasMode.Idle) return;
        var position = e.GetCurrentPoint(CanvasHost).Position;
        var createdBox = false;
        if (_canvasMode == CanvasMode.Draw && _dragging)
        {
            var image = ImageRect;
            var (pixelWidth, pixelHeight) = NaturalPixelSize;
            var ratio = ToRatio(position, image);
            var (x, y, width, height) = BoxGeometry.Clamp(
                Normalize(_dragStartRatio, ratio).X * pixelWidth, Normalize(_dragStartRatio, ratio).Y * pixelHeight,
                Math.Abs(ratio.X - _dragStartRatio.X) * pixelWidth, Math.Abs(ratio.Y - _dragStartRatio.Y) * pixelHeight,
                pixelWidth, pixelHeight);
            if (width >= MinBoxPixels && height >= MinBoxPixels && pixelWidth > 0 && pixelHeight > 0)
            {
                _boxes.Add(new MarkBox(x / pixelWidth, y / pixelHeight, width / pixelWidth, height / pixelHeight));
                _selectedBox = _boxes.Count - 1;
                _undoHistory.Add("box");
                createdBox = true;
            }
        }
        var mode = _canvasMode;
        _canvasMode = CanvasMode.Idle;
        _dragging = false;
        CanvasHost.ReleasePointerCapture(e.Pointer);
        RenderBoxes();
        if (mode is CanvasMode.Draw or CanvasMode.Move or CanvasMode.Resize)
            SetDirty(createdBox || mode is CanvasMode.Move or CanvasMode.Resize);
        // 可选手势：图片区域左键下一张、右键上一张（仅在无拖动时触发）。
        if (_clickNavigate && !createdBox)
        {
            if (mode == CanvasMode.Draw) _ = SelectRelativePhoto(1);
            else if (mode == CanvasMode.Pan && !_panMoved) _ = SelectRelativePhoto(-1);
        }
        e.Handled = true;
    }

    private void CanvasHost_PointerCanceled(object sender, PointerRoutedEventArgs e)
    {
        if ((_canvasMode is CanvasMode.Move or CanvasMode.Resize) && _selectedBox >= 0 && _selectedBox < _boxes.Count)
            _boxes[_selectedBox] = _dragOrigin;
        _canvasMode = CanvasMode.Idle;
        _dragging = false;
        RenderBoxes();
    }

    private void CanvasHost_PointerExited(object sender, PointerRoutedEventArgs e)
    {
        if (_canvasMode == CanvasMode.Idle)
        {
            _cursorShape = InputSystemCursorShape.Arrow;
            CanvasHost.ResetCursor();
        }
    }

    // 原版 hitBox：容差 4 屏幕像素，从最上层往下命中。
    private int HitBox(Point screen)
    {
        var image = ImageRect;
        for (var i = _boxes.Count - 1; i >= 0; i--)
        {
            var box = _boxes[i];
            var bounds = new Rect(
                image.X + box.X * image.Width - HitTolerance,
                image.Y + box.Y * image.Height - HitTolerance,
                box.Width * image.Width + HitTolerance * 2,
                box.Height * image.Height + HitTolerance * 2);
            if (bounds.Contains(screen)) return i;
        }
        return -1;
    }

    private static readonly string[] HandleOrder = ["nw", "ne", "sw", "se", "n", "s", "w", "e"];

    // 原版 hitHandle：8 个手柄，命中半径 8 屏幕像素。
    private string? HitHandle(Point screen)
    {
        if (_selectedBox < 0 || _selectedBox >= _boxes.Count) return null;
        var image = ImageRect;
        var box = _boxes[_selectedBox];
        var right = box.X + box.Width;
        var bottom = box.Y + box.Height;
        Point[] anchors =
        [
            RatioToScreen(box, 0, 0, image), RatioToScreen(box, 1, 0, image),
            RatioToScreen(box, 0, 1, image), RatioToScreen(box, 1, 1, image),
            RatioToScreen(box, 0.5, 0, image), RatioToScreen(box, 0.5, 1, image),
            RatioToScreen(box, 0, 0.5, image), RatioToScreen(box, 1, 0.5, image)
        ];
        for (var i = 0; i < anchors.Length; i++)
        {
            var dx = screen.X - anchors[i].X;
            var dy = screen.Y - anchors[i].Y;
            if (dx * dx + dy * dy <= HandleSize * HandleSize) return HandleOrder[i];
        }
        return null;
    }

    // 原版 hitDeleteBtn：圆钮中心在选中框右上角外侧，命中半径 13 屏幕像素。
    private bool HitsDeleteButton(Point screen)
    {
        if (_selectedBox < 0 || _selectedBox >= _boxes.Count) return false;
        var image = ImageRect;
        var box = _boxes[_selectedBox];
        var center = new Point(
            image.X + (box.X + box.Width) * image.Width + DeleteButtonOffset,
            image.Y + box.Y * image.Height - DeleteButtonOffset);
        var dx = screen.X - center.X;
        var dy = screen.Y - center.Y;
        return dx * dx + dy * dy <= DeleteHitRadius * DeleteHitRadius;
    }

    private void UpdateHoverCursor(Point screen)
    {
        var shape = InputSystemCursorShape.Cross;
        if (_selectedBox >= 0 && _selectedBox < _boxes.Count)
        {
            if (HitsDeleteButton(screen)) shape = InputSystemCursorShape.Hand;
            else if (HitHandle(screen) is { } handle) shape = handle switch
            {
                "nw" or "se" => InputSystemCursorShape.SizeNorthwestSoutheast,
                "ne" or "sw" => InputSystemCursorShape.SizeNortheastSouthwest,
                "n" or "s" => InputSystemCursorShape.SizeNorthSouth,
                _ => InputSystemCursorShape.SizeWestEast
            };
            else if (HitBox(screen) >= 0) shape = InputSystemCursorShape.SizeAll;
        }
        else if (HitBox(screen) >= 0) shape = InputSystemCursorShape.SizeAll;
        SetCursor(shape);
    }

    private void SetCursor(InputSystemCursorShape shape)
    {
        if (_cursorShape == shape) return;
        _cursorShape = shape;
        CanvasHost.SetCursor(shape);
    }

    // 原版 deleteSelectedBox：优先删除选中框；无选中时删除最后一框。
    private void DeleteSelectedBox()
    {
        if (_selectedBox >= 0 && _selectedBox < _boxes.Count)
        {
            _boxes.RemoveAt(_selectedBox);
            _selectedBox = -1;
            StatusText.Text = "已删除选中的红框";
            SetDirty(true);
        }
        else if (_boxes.Count > 0)
        {
            _boxes.RemoveAt(_boxes.Count - 1);
            _selectedBox = -1;
            StatusText.Text = "已删除最近绘制的红框";
            SetDirty(true);
        }
        else
        {
            StatusText.Text = "当前没有可删除的红框";
        }
        RenderBoxes();
    }

    private void SetDirty(bool dirty)
    {
        if (_dirty == dirty) return;
        _dirty = dirty;
        UpdateSummary();
    }

    // 原版 undoLastAction：优先撤回最后一次追加的标签，其次撤回最后绘制的红框。
    private void UndoLastAction()
    {
        if (_undoHistory.Count > 0)
        {
            var action = _undoHistory[^1];
            _undoHistory.RemoveAt(_undoHistory.Count - 1);
            if (action.StartsWith("tag:", StringComparison.Ordinal))
            {
                var tag = action["tag:".Length..];
                if (_selectedTags.Remove(tag))
                {
                    SetDirty(true);
                    RenderSelectedTags();
                    UpdateNamePreview();
                    StatusText.Text = $"已撤回追加的缺陷命名：{tag}";
                }
                return;
            }
            if (action == "box" && _boxes.Count > 0)
            {
                _boxes.RemoveAt(_boxes.Count - 1);
                if (_selectedBox >= _boxes.Count) _selectedBox = -1;
                SetDirty(true);
                RenderBoxes();
                StatusText.Text = "已撤回最近绘制的红框";
                return;
            }
        }
        if (_selectedTags.Count > 0)
        {
            var tag = _selectedTags[^1];
            _selectedTags.RemoveAt(_selectedTags.Count - 1);
            SetDirty(true);
            RenderSelectedTags();
            UpdateNamePreview();
            StatusText.Text = $"已撤回追加的缺陷命名：{tag}";
            return;
        }
        if (_boxes.Count > 0)
        {
            _boxes.RemoveAt(_boxes.Count - 1);
            if (_selectedBox >= _boxes.Count) _selectedBox = -1;
            SetDirty(true);
            RenderBoxes();
            StatusText.Text = "已撤回最近绘制的红框";
            return;
        }
        StatusText.Text = "没有可撤回的操作";
    }

    private void RenderBoxes(Point? liveRatio = null)
    {
        MarkCanvas.Children.Clear();
        _selectionVisuals.Clear();
        if (_currentPhoto is null || ImageRect.Width <= 0) return;
        var image = ImageRect;
        var stroke = StrokeScreenThickness();
        for (var index = 0; index < _boxes.Count; index++)
        {
            var box = _boxes[index];
            var rectangle = CreateRectangle();
            MarkCanvas.Children.Add(rectangle);
            Canvas.SetLeft(rectangle, image.X + box.X * image.Width);
            Canvas.SetTop(rectangle, image.Y + box.Y * image.Height);
            rectangle.Width = box.Width * image.Width;
            rectangle.Height = box.Height * image.Height;
            rectangle.StrokeThickness = stroke;
            if (index == _selectedBox) AddSelectionVisuals(box, image);
        }
        if (liveRatio is { } corner && _canvasMode == CanvasMode.Draw)
        {
            var (x, y, width, height) = NormalizeLive(_dragStartRatio, corner);
            var rectangle = CreateRectangle();
            MarkCanvas.Children.Add(rectangle);
            Canvas.SetLeft(rectangle, image.X + x * image.Width);
            Canvas.SetTop(rectangle, image.Y + y * image.Height);
            rectangle.Width = width * image.Width;
            rectangle.Height = height * image.Height;
            rectangle.StrokeThickness = stroke;
        }
    }

    private static (double X, double Y, double Width, double Height) NormalizeLive(Point a, Point b) => (
        Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Abs(b.X - a.X), Math.Abs(b.Y - a.Y));

    // 原版 drawHandles：白色方块手柄加红色描边，右上角外侧红色圆钮带白色叉号。
    private void AddSelectionVisuals(MarkBox box, Rect image)
    {
        var right = box.X + box.Width;
        var bottom = box.Y + box.Height;
        Point[] anchors =
        [
            RatioToScreen(box, 0, 0, image), RatioToScreen(box, 1, 0, image),
            RatioToScreen(box, 0, 1, image), RatioToScreen(box, 1, 1, image),
            RatioToScreen(box, 0.5, 0, image), RatioToScreen(box, 0.5, 1, image),
            RatioToScreen(box, 0, 0.5, image), RatioToScreen(box, 1, 0.5, image)
        ];
        foreach (var anchor in anchors)
        {
            var handle = new Rectangle
            {
                Width = HandleSize,
                Height = HandleSize,
                Fill = new SolidColorBrush(Microsoft.UI.Colors.White),
                Stroke = new SolidColorBrush(Microsoft.UI.Colors.Red),
                StrokeThickness = 1.5
            };
            MarkCanvas.Children.Add(handle);
            Canvas.SetLeft(handle, anchor.X - image.X - HandleSize / 2);
            Canvas.SetTop(handle, anchor.Y - image.Y - HandleSize / 2);
            _selectionVisuals.Add(handle);
        }
        var centerX = image.X + right * image.Width + DeleteButtonOffset;
        var centerY = image.Y + box.Y * image.Height - DeleteButtonOffset;
        var button = new Ellipse
        {
            Width = DeleteButtonRadius * 2,
            Height = DeleteButtonRadius * 2,
            Fill = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(0xFF, 0xC6, 0x28, 0x28)),
            Stroke = new SolidColorBrush(Microsoft.UI.Colors.White),
            StrokeThickness = 1.5
        };
        MarkCanvas.Children.Add(button);
        Canvas.SetLeft(button, centerX - DeleteButtonRadius - image.X);
        Canvas.SetTop(button, centerY - DeleteButtonRadius - image.Y);
        _selectionVisuals.Add(button);
        var crossHalf = 4.5;
        foreach (var (x1, y1, x2, y2) in new[]
        {
            (-crossHalf, -crossHalf, crossHalf, crossHalf),
            (-crossHalf, crossHalf, crossHalf, -crossHalf)
        })
        {
            var line = new Line
            {
                X1 = x1, Y1 = y1, X2 = x2, Y2 = y2,
                Stroke = new SolidColorBrush(Microsoft.UI.Colors.White),
                StrokeThickness = 2
            };
            MarkCanvas.Children.Add(line);
            Canvas.SetLeft(line, centerX - image.X);
            Canvas.SetTop(line, centerY - image.Y);
            _selectionVisuals.Add(line);
        }
    }

    private void UpdateStrokeWidths() => RenderBoxes();

    private static Rectangle CreateRectangle() => new()
    {
        Stroke = new SolidColorBrush(Microsoft.UI.Colors.Red),
        StrokeThickness = 3,
        Fill = new SolidColorBrush(Microsoft.UI.Colors.Transparent)
    };

    // 读取数据库标注为工作集；圈示底图叠加时沿用同一比例坐标。
    private void LoadWorkingBoxes(long photoId)
    {
        _boxes.Clear();
        _undoHistory.Clear();
        _selectedBox = -1;
        if (_store is not null)
            foreach (var mark in _store.LoadMarks(photoId))
                _boxes.Add(new MarkBox(mark.X, mark.Y, mark.Width, mark.Height));
        RenderBoxes();
    }
}

internal sealed record MarkBox(double X, double Y, double Width, double Height);
