using Microsoft.UI.Input;
using Microsoft.UI.Xaml.Controls;

namespace PatrolDefect.App;

// Grid 子类用于公开光标设置：UIElement.ProtectedCursor 为 protected，仅派生类可写。
internal sealed class CanvasSurface : Grid
{
    public void SetCursor(InputSystemCursorShape shape) =>
        ProtectedCursor = InputSystemCursor.Create(shape);

    public void ResetCursor() => ProtectedCursor = null;
}
