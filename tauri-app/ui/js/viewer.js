// 画布渲染引擎 (GPU加速/RAF批处理)、坐标映射、缩放平移与红框标注交互


  /* ================= 视图渲染 ================= */

  var cachedCanvasRect = null, cachedContainerSize = null;
  function getCanvasRect() {
    if (!cachedCanvasRect) {
      cachedCanvasRect = overlayCanvas.getBoundingClientRect();
    }
    return cachedCanvasRect;
  }
  function invalidateCanvasRect() {
    cachedCanvasRect = null;
    cachedContainerSize = null;
  }
  window.addEventListener('resize', invalidateCanvasRect);

  function getContainerSize() {
    if (!cachedContainerSize) {
      var container = $('stageContainer') || viewer;
      var pad = 6;
      cachedContainerSize = {
        availW: Math.max(10, (container ? container.clientWidth : 0) - pad * 2),
        availH: Math.max(10, (container ? container.clientHeight : 0) - pad * 2)
      };
    }
    return cachedContainerSize;
  }

  function computeFit(nw, nh) {
    var cSize = getContainerSize();
    var availW = cSize.availW;
    var availH = cSize.availH;




    if (!nw || !nh || nw <= 0 || nh <= 0) {
      if (state.natural && state.natural.w > 0 && state.natural.h > 0) {
        nw = state.natural.w;
        nh = state.natural.h;
      } else {
        return { w: 100, h: 100, s: 1 };
      }
    }
    var s = Math.min(availW / nw, availH / nh);
    return { w: Math.round(nw * s), h: Math.round(nh * s), s: s };
  }
  function fitView(w, h, s) {
    invalidateCanvasRect();
    var dpr = window.devicePixelRatio || 1;
    var targetW = Math.round(w * dpr);
    var targetH = Math.round(h * dpr);
    var wPx = w + 'px';
    var hPx = h + 'px';

    if (stage.style.width !== wPx) stage.style.width = wPx;
    if (stage.style.height !== hPx) stage.style.height = hPx;

    // 仅在尺寸真正改变时才重设 canvas.width/height，防止丢弃 GPU 显存纹理导致掉帧卡顿
    if (baseCanvas.width !== targetW) baseCanvas.width = targetW;
    if (baseCanvas.height !== targetH) baseCanvas.height = targetH;
    if (overlayCanvas.width !== targetW) overlayCanvas.width = targetW;
    if (overlayCanvas.height !== targetH) overlayCanvas.height = targetH;

    if (baseCanvas.style.width !== wPx) baseCanvas.style.width = wPx;
    if (baseCanvas.style.height !== hPx) baseCanvas.style.height = hPx;
    if (overlayCanvas.style.width !== wPx) overlayCanvas.style.width = wPx;
    if (overlayCanvas.style.height !== hPx) overlayCanvas.style.height = hPx;

    state.view = { w: w, h: h, s: s, zoom: 1, panX: 0, panY: 0, cx: w / 2, cy: h / 2 };
  }
  function currentImage() {
    var f = curFile();
    if (!f) return null;
    var key = fileKey(f);
    var c = state.cache.get(key);
    if (c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0)) && (c.img.complete !== false)) return c.img;
    return null;
  }
  function setViewTransform(ctx) {
    var v = state.view;
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(v.cx + v.panX, v.cy + v.panY);
    ctx.scale(v.zoom, v.zoom);
    ctx.translate(-v.cx, -v.cy);
  }
  var currentRenderedImg = null;
  var isInteractiveZooming = false;
  var zoomQualityRestoreTimer = null;

  function renderBase(overrideImg) {
    var v = state.view;
    if (!v || !v.w || !v.h) return;
    var dpr = window.devicePixelRatio || 1;
    var img = overrideImg || currentImage();
    if (!img && currentRenderedImg) {
      // 关键防黑屏保护：若新图尚未解码完毕，绝不提前清空画板造成黑屏闪烁，保留当前画面平滑过渡
      return;
    }
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.clearRect(0, 0, v.w, v.h);
    if (img) {
      baseCtx.imageSmoothingEnabled = true;
      // 核心优化：快速缩放平移交互时启用开销极低的硬件插值，消除4K/8K大图频繁重绘卡顿；静止后恢复高清
      baseCtx.imageSmoothingQuality = isInteractiveZooming ? 'low' : 'medium';
      setViewTransform(baseCtx);
      baseCtx.drawImage(img, 0, 0, v.w, v.h);
      currentRenderedImg = img;
    } else {
      currentRenderedImg = null;
    }
  }
  function renderOverlay() {
    var v = state.view;
    if (!v || !v.w) return;
    var dpr = window.devicePixelRatio || 1;
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlayCtx.clearRect(0, 0, v.w, v.h);
    setViewTransform(overlayCtx);
    overlayCtx.strokeStyle = '#FF0000';
    overlayCtx.lineWidth = strokeWidth * v.s;
    overlayCtx.lineJoin = 'miter';
    var name = curName();
    var m = name ? getMeta(name) : null;
    var boxes = m ? m.boxes : null;
    if (boxes && boxes.length > 0) {
      for (var i = 0; i < boxes.length; i++) overlayCtx.strokeRect(boxes[i].x * v.s, boxes[i].y * v.s, boxes[i].w * v.s, boxes[i].h * v.s);
      if (selectedIndex >= 0 && selectedIndex < boxes.length) drawHandles(overlayCtx, boxes[selectedIndex], v);
    }
    if (mode === 'draw' && dragBox) { var n = normalize(dragBox); overlayCtx.strokeRect(n.x * v.s, n.y * v.s, n.w * v.s, n.h * v.s); }
  }

  function drawHandles(ctx, b, v) {
    var s = v.s, hs = HANDLE_PX / v.zoom, hw = hs / 2;
    var cx = b.x * s, cy = b.y * s, x2 = b.x * s + b.w * s, y2 = b.y * s + b.h * s;
    var pts = [[cx,cy],[x2,cy],[cx,y2],[x2,y2],[(cx+x2)/2,cy],[(cx+x2)/2,y2],[cx,(cy+y2)/2],[x2,(cy+y2)/2]];
    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#FF0000'; ctx.lineWidth = 1.5 / v.zoom;
    for (var i = 0; i < pts.length; i++) {
      ctx.fillRect(pts[i][0]-hw, pts[i][1]-hw, hs, hs);
      ctx.strokeRect(pts[i][0]-hw, pts[i][1]-hw, hs, hs);
    }

    var btnR = 10 / v.zoom;
    var btnX = x2 + btnR + 2 / v.zoom;
    var btnY = cy - btnR - 2 / v.zoom;
    ctx.beginPath();
    ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2);
    ctx.fillStyle = '#c62828';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 / v.zoom;
    ctx.stroke();

    var cross = 4.5 / v.zoom;
    ctx.beginPath();
    ctx.moveTo(btnX - cross, btnY - cross);
    ctx.lineTo(btnX + cross, btnY + cross);
    ctx.moveTo(btnX + cross, btnY - cross);
    ctx.lineTo(btnX - cross, btnY + cross);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 / v.zoom;
    ctx.stroke();
  }
  function render(overrideImg) { renderBase(overrideImg); renderOverlay(); }


  /* ================= 红框：指针交互与删除 ================= */

  var selectedIndex = -1;
  var mode = 'idle';
  var dragBox = null, dragData = null, lastP = null, rafPending = false, panStart = null;

  function normalize(b) {
    var x = b.x, y = b.y, w = b.w, h = b.h;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    return { x: x, y: y, w: w, h: h };
  }
  function clampBox(b) {
    var nw = state.natural.w, nh = state.natural.h;
    if (!nw || !nh) return b;
    var x1 = Math.max(0, Math.min(b.x, nw)), y1 = Math.max(0, Math.min(b.y, nh));
    var x2 = Math.max(0, Math.min(b.x + b.w, nw)), y2 = Math.max(0, Math.min(b.y + b.h, nh));
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  function screenToOrig(px) { var eff = state.view.s * state.view.zoom; return px / (eff || 1); }
  function hitHandle(b, p) {
    var r = screenToOrig(HANDLE_PX);
    var cx = b.x, cy = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    var pts = [['nw',cx,cy],['ne',x2,cy],['sw',cx,y2],['se',x2,y2],['n',(cx+x2)/2,cy],['s',(cx+x2)/2,y2],['w',cx,(cy+y2)/2],['e',x2,(cy+y2)/2]];
    for (var i = 0; i < pts.length; i++) { var dx = p.x - pts[i][1], dy = p.y - pts[i][2]; if (dx * dx + dy * dy <= r * r) return pts[i][0]; }
    return null;
  }
  function hitDeleteBtn(b, p) {
    var v = state.view;
    var s = v.s;
    var x2 = b.x * s + b.w * s, cy = b.y * s;
    var btnR = 13 / v.zoom;
    var btnX = (x2 + (10 / v.zoom) + (2 / v.zoom)) / s;
    var btnY = (cy - (10 / v.zoom) - (2 / v.zoom)) / s;
    var dx = p.x - btnX, dy = p.y - btnY;
    return (dx * dx + dy * dy) <= (btnR / s) * (btnR / s);
  }
  function hitBox(boxes, p) {
    var tol = screenToOrig(4);
    for (var i = boxes.length - 1; i >= 0; i--) { var b = boxes[i]; if (p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol) return i; }
    return -1;
  }
  function resizeBox(b, handle, p) {
    var x = b.x, y = b.y, x2 = b.x + b.w, y2 = b.y + b.h, min = 3;
    var mL = handle === 'nw' || handle === 'w' || handle === 'sw';
    var mR = handle === 'ne' || handle === 'e' || handle === 'se';
    var mT = handle === 'nw' || handle === 'n' || handle === 'ne';
    var mB = handle === 'sw' || handle === 's' || handle === 'se';
    var nx = x, ny = y, nx2 = x2, ny2 = y2;
    if (mL) nx = Math.min(p.x, x2 - min);
    if (mR) nx2 = Math.max(p.x, x + min);
    if (mT) ny = Math.min(p.y, y2 - min);
    if (mB) ny2 = Math.max(p.y, y + min);
    return clampBox({ x: Math.min(nx, nx2), y: Math.min(ny, ny2), w: Math.abs(nx2 - nx), h: Math.abs(ny2 - ny) });
  }
  function moveBox(b, dx, dy) { return clampBox({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }); }
  function handleCursor(h) {
    if (h === 'nw' || h === 'se') return 'nwse-resize';
    if (h === 'ne' || h === 'sw') return 'nesw-resize';
    if (h === 'n' || h === 's') return 'ns-resize';
    return 'ew-resize';
  }
  function toFit(e) {
    var rect = getCanvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 0, y: 0 };
    }
    var mx = ((e.clientX - rect.left) / rect.width) * state.view.w;
    var my = ((e.clientY - rect.top) / rect.height) * state.view.h;
    var v = state.view;
    return { x: (mx - v.cx - v.panX) / v.zoom + v.cx, y: (my - v.cy - v.panY) / v.zoom + v.cy };
  }
  function toOriginal(e) { var f = toFit(e); var s = state.view.s || 1; return { x: f.x / s, y: f.y / s }; }
  function clampZoom(z) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }
  function zoomAt(mx, my, factor) {
    var v = state.view;
    var nz = clampZoom(v.zoom * factor);
    if (nz === v.zoom) return;
    var ix = (mx - v.cx - v.panX) / v.zoom + v.cx, iy = (my - v.cy - v.panY) / v.zoom + v.cy;
    v.panX = mx - v.cx - (ix - v.cx) * nz;
    v.panY = my - v.cy - (iy - v.cy) * nz;
    v.zoom = nz;
    scheduleRedraw(applyInteraction);
  }
  function scheduleRedraw(fn) {
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(function () {
        rafPending = false;
        if (typeof fn === 'function') fn();
        else render();
      });
    }
  }
  function applyInteraction() {
    if (mode === 'draw' && dragBox && lastP) {
      dragBox.w = lastP.x - dragBox.x; dragBox.h = lastP.y - dragBox.y; renderOverlay();
    } else if (mode === 'move' && dragData && lastP) {
      var boxes = getMeta(curName()).boxes;
      if (selectedIndex >= 0 && selectedIndex < boxes.length) { boxes[selectedIndex] = moveBox(dragData.orig, lastP.x - dragData.startP.x, lastP.y - dragData.startP.y); renderOverlay(); }
    } else if (mode === 'resize' && dragData && lastP) {
      var boxes2 = getMeta(curName()).boxes;
      if (selectedIndex >= 0 && selectedIndex < boxes2.length) { boxes2[selectedIndex] = resizeBox(dragData.orig, dragData.handle, lastP); renderOverlay(); }
    } else if (mode === 'pan') { render(); }
  }
  function updateHoverCursor(e) {
    if (state.index < 0) return;
    var f = toFit(e);
    if (f.x < 0 || f.y < 0 || f.x > state.view.w || f.y > state.view.h) { overlayCanvas.style.cursor = 'default'; return; }
    var p = { x: f.x / state.view.s, y: f.y / state.view.s };
    var name = curName(), boxes = name ? getMeta(name).boxes : null;
    if (boxes) {
      if (selectedIndex >= 0 && selectedIndex < boxes.length) {
        if (hitDeleteBtn(boxes[selectedIndex], p)) { overlayCanvas.style.cursor = 'pointer'; return; }
        var h = hitHandle(boxes[selectedIndex], p);
        if (h) { overlayCanvas.style.cursor = handleCursor(h); return; }
      }
      if (hitBox(boxes, p) >= 0) { overlayCanvas.style.cursor = 'move'; return; }
    }
    overlayCanvas.style.cursor = 'crosshair';
  }

  function deleteSelectedBox() {
    if (state.index < 0) return;
    var name = curName();
    if (!name) return;
    var m = getMeta(name);
    if (selectedIndex >= 0 && selectedIndex < m.boxes.length) {
      m.boxes.splice(selectedIndex, 1);
      m.saved = false;
      selectedIndex = -1;
      renderOverlay();
      updateHud();
      toast('已删除选中的红框');
    } else if (m.boxes.length > 0) {
      m.boxes.pop();
      m.saved = false;
      selectedIndex = -1;
      renderOverlay();
      updateHud();
      toast('已删除最近绘制的红框');
    } else {
      toast('当前没有可删除的红框');
    }
  }

  overlayCanvas.addEventListener('pointerenter', invalidateCanvasRect);
  overlayCanvas.addEventListener('pointerdown', function (e) {
    if (state.index < 0) return;
    if (e.button === 2) {
      e.preventDefault(); mode = 'pan';
      var rect = getCanvasRect();
      var sx = (rect && rect.width > 0) ? (state.view.w / rect.width) : 1;
      var sy = (rect && rect.height > 0) ? (state.view.h / rect.height) : 1;
      panStart = { x: e.clientX, y: e.clientY, panX: state.view.panX, panY: state.view.panY, sx: sx, sy: sy };
      overlayCanvas.style.cursor = 'grabbing';
      try { overlayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (e.button !== 0) return;
    var f = toFit(e);
    if (f.x < 0 || f.y < 0 || f.x > state.view.w || f.y > state.view.h) return;
    var p = { x: f.x / state.view.s, y: f.y / state.view.s };
    var name = curName(), boxes = name ? getMeta(name).boxes : null;
    if (!boxes) return;

    if (selectedIndex >= 0 && selectedIndex < boxes.length) {
      if (hitDeleteBtn(boxes[selectedIndex], p)) {
        e.preventDefault();
        deleteSelectedBox();
        return;
      }
      var h = hitHandle(boxes[selectedIndex], p);
      if (h) {
        mode = 'resize'; var sb = boxes[selectedIndex];
        dragData = { orig: { x: sb.x, y: sb.y, w: sb.w, h: sb.h }, handle: h, startP: p };
        overlayCanvas.style.cursor = handleCursor(h);
        try { overlayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault(); return;
      }
    }

    var idx = hitBox(boxes, p);
    if (idx >= 0) {
      selectedIndex = idx; mode = 'move';
      var mb = boxes[idx];
      dragData = { orig: { x: mb.x, y: mb.y, w: mb.w, h: mb.h }, startP: p };
      overlayCanvas.style.cursor = 'move';
      renderOverlay();
      try { overlayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault(); return;
    }

    selectedIndex = -1; mode = 'draw';
    dragBox = { x: p.x, y: p.y, w: 0, h: 0 }; lastP = p;
    overlayCanvas.style.cursor = 'crosshair';
    try { overlayCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });

  overlayCanvas.addEventListener('pointermove', function (e) {
    if (mode === 'pan') {
      var sx = panStart.sx || 1;
      var sy = panStart.sy || 1;
      state.view.panX = panStart.panX + (e.clientX - panStart.x) * sx;
      state.view.panY = panStart.panY + (e.clientY - panStart.y) * sy;
      scheduleRedraw(applyInteraction);
      return;
    }
    if (mode === 'idle') { updateHoverCursor(e); return; }
    lastP = toOriginal(e);
    scheduleRedraw(applyInteraction);
  });

  function endInteraction(e) {
    var modified = false;
    if (mode === 'draw') {
      var p = toOriginal(e);
      dragBox.w = p.x - dragBox.x; dragBox.h = p.y - dragBox.y;
      var norm = clampBox(normalize(dragBox)); dragBox = null;
      if (norm.w >= 3 && norm.h >= 3) {
        var meta = getMeta(curName());
        meta.boxes.push(norm);
        meta.saved = false;
        selectedIndex = meta.boxes.length - 1;
        meta.history.push({ type: 'box' });
        modified = true;
      }
      renderOverlay(); updateHud();
    } else if (mode === 'move' || mode === 'resize') {
      var meta = getMeta(curName());
      meta.saved = false;
      modified = true;
      renderOverlay(); updateHud();
    }
    if (mode === 'pan') overlayCanvas.style.cursor = 'crosshair';
    mode = 'idle'; dragData = null; lastP = null;
  }
  overlayCanvas.addEventListener('pointerup', endInteraction);
  overlayCanvas.addEventListener('pointercancel', function () {
    if ((mode === 'move' || mode === 'resize') && dragData) {
      var boxes = getMeta(curName()).boxes;
      if (selectedIndex >= 0 && selectedIndex < boxes.length) boxes[selectedIndex] = dragData.orig;
    }
    if (mode === 'pan') overlayCanvas.style.cursor = 'crosshair';
    mode = 'idle'; dragData = null; dragBox = null; lastP = null; renderOverlay();
  });
  var pendingWheelEvents = [];
  var isWheelRafScheduled = false;

  function flushWheelZoom() {
    isWheelRafScheduled = false;
    if (pendingWheelEvents.length === 0 || state.index < 0) return;
    var rect = getCanvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      pendingWheelEvents = [];
      return;
    }

    var v = state.view;
    var zoomChanged = false;

    for (var i = 0; i < pendingWheelEvents.length; i++) {
      var ev = pendingWheelEvents[i];
      var mx = ((ev.clientX - rect.left) / rect.width) * v.w;
      var my = ((ev.clientY - rect.top) / rect.height) * v.h;
      var nz = clampZoom(v.zoom * ev.factor);
      if (nz !== v.zoom) {
        var ix = (mx - v.cx - v.panX) / v.zoom + v.cx;
        var iy = (my - v.cy - v.panY) / v.zoom + v.cy;
        v.panX = mx - v.cx - (ix - v.cx) * nz;
        v.panY = my - v.cy - (iy - v.cy) * nz;
        v.zoom = nz;
        zoomChanged = true;
      }
    }
    pendingWheelEvents = [];

    if (zoomChanged) {
      isInteractiveZooming = true;
      if (typeof window !== 'undefined') window.__isZooming = true;
      render();

      if (zoomQualityRestoreTimer) clearTimeout(zoomQualityRestoreTimer);
      zoomQualityRestoreTimer = setTimeout(function () {
        zoomQualityRestoreTimer = null;
        isInteractiveZooming = false;
        if (typeof window !== 'undefined') window.__isZooming = false;
        render();
      }, 120);
    }
  }

  overlayCanvas.addEventListener('wheel', function (e) {
    if (state.index < 0) return;
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.12 : (1 / 1.12);
    if (Math.abs(e.deltaY) < 60) {
      var smoothFactor = Math.pow(0.9985, e.deltaY);
      factor = Math.max(0.88, Math.min(1.14, smoothFactor));
    }
    pendingWheelEvents.push({ clientX: e.clientX, clientY: e.clientY, factor: factor });
    if (!isWheelRafScheduled) {
      isWheelRafScheduled = true;
      requestAnimationFrame(flushWheelZoom);
    }
  }, { passive: false });
  overlayCanvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  overlayCanvas.addEventListener('dblclick', function () { if (state.index < 0) return; fitView(state.view.w, state.view.h, state.view.s); render(); });

  function undoLastAction() {
    if (state.index < 0) return;
    var name = curName();
    if (!name) return;
    var f = curFile();
    var fKey = f ? (f.relPath || f.name) : name;
    var m = getMeta(f || name);

    if (m.history && m.history.length > 0) {
      var lastAct = m.history.pop();
      if (lastAct.type === 'name') {
        var removedTag = m.appended.pop();
        if (state.markedDefectTags) {
          if (m.appended.length > 0) {
            state.markedDefectTags.set(fKey, m.appended.join(''));
          } else {
            state.markedDefectTags.delete(fKey);
          }
        }
        renderSide();
        renderPathTree(false);
        updateHud();
        toast('已撤回追加的缺陷命名：' + (removedTag || ''));
        return;
      } else if (lastAct.type === 'box') {
        if (m.boxes.length > 0) {
          m.boxes.pop();
          m.saved = false;
          if (selectedIndex >= m.boxes.length) selectedIndex = -1;
          renderOverlay();
          updateHud();
          toast('已撤回最近绘制的红框');
          return;
        }
      }
    }

    if (m.appended && m.appended.length > 0) {
      var remName = m.appended.pop();
      if (state.markedDefectTags) {
        if (m.appended.length > 0) {
          state.markedDefectTags.set(fKey, m.appended.join(''));
        } else {
          state.markedDefectTags.delete(fKey);
        }
      }
      renderSide();
      renderPathTree(false);
      updateHud();
      toast('已撤回追加的缺陷命名：' + (remName || ''));
      return;
    }
    if (m.boxes && m.boxes.length > 0) {
      m.boxes.pop();
      if (selectedIndex >= m.boxes.length) selectedIndex = -1;
      renderOverlay();
      updateHud();
      toast('已撤回最近绘制的红框');
      return;
    }

    toast('没有可撤回的操作');
  }
