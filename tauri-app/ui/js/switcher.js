// 图片切换引擎、预加载解码缓存与防多跳长按连切引擎


  /* ================= 图片加载 / 缓存与硬件级预解码引擎 ================= */

  // 浏览器兼容性图片解码器：优先原生硬件级后台解码 createImageBitmap，回退标准 HTMLImageElement
  async function decodeImageSource(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        var bmp = await createImageBitmap(blob);
        return { img: bmp, url: null };
      } catch (bmpErr) {
        console.warn('createImageBitmap 硬件解码受阻，自动回退至常规 Image 解码:', bmpErr);
      }
    }
    var url = URL.createObjectURL(blob);
    var img = await loadImageElement(url);
    return { img: img, url: url };
  }

  function getImgSize(cOrImg) {
    if (!cOrImg) return { w: 0, h: 0 };
    if (cOrImg.img) {
      var w = cOrImg.naturalWidth || cOrImg.width || cOrImg.img.naturalWidth || cOrImg.img.width || 0;
      var h = cOrImg.naturalHeight || cOrImg.height || cOrImg.img.naturalHeight || cOrImg.img.height || 0;
      return { w: w, h: h };
    }
    var sw = cOrImg.naturalWidth || cOrImg.width || 0;
    var sh = cOrImg.naturalHeight || cOrImg.height || 0;
    return { w: sw, h: sh };
  }

  function loadImageElement(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      var settled = false;

      function onOk() {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        resolve(img);
      }
      function onErr() {
        if (settled) return;
        settled = true;
        img.onload = null;
        img.onerror = null;
        reject(new Error('图片加载失败'));
      }

      img.onload = onOk;
      img.onerror = onErr;
      img.src = url;

      if (img.decode) {
        img.decode().then(onOk).catch(function () {
          // 若异步 decode 失败，等待 onload / onerror
        });
      }
      if (img.complete && ((img.naturalWidth > 0) || (img.width > 0))) {
        onOk();
      }
    });
  }

  var inFlightImagePromises = new Map();

  async function getImage(index, preferClean) {
    if (!state.files || index < 0 || index >= state.files.length) return null;
    var f = state.files[index];
    if (!f) return null;
    var key = fileKey(f);
    var c = state.cache.get(key);
    var isMarked = !preferClean && !!(state.markedFiles && state.markedFiles.has(key)) && !!(state.markedBoxedHandles && state.markedBoxedHandles.has(key));

    var isCachedValid = c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0)) && (c.img.complete !== false);
    if (isCachedValid) {
      if (isMarked && !c.isBoxed) {
        disposeCacheItem(c);
        state.cache.delete(key);
      } else if (!isMarked && c.isBoxed) {
        disposeCacheItem(c);
        state.cache.delete(key);
      } else {
        return c;
      }
    }

    var inFlightKey = key + (preferClean ? '_clean' : '_auto');
    if (inFlightImagePromises.has(inFlightKey)) {
      return inFlightImagePromises.get(inFlightKey);
    }

    var loadPromise = (async function () {
      try {
        var blob = null;
        var isBoxedImg = false;
        if (isMarked) {
          try {
            var boxedHandle = state.markedBoxedHandles.get(key);
            if (boxedHandle) {
              blob = await boxedHandle.getFile();
              isBoxedImg = true;
            }
          } catch (err) {
            console.warn('读取缺陷圈示图失败，回退至原图:', err);
          }
        }

        if (!blob) {
          if (f.file) {
            blob = f.file;
          } else {
            blob = await f.handle.getFile();
          }
        }

        var decoded = await decodeImageSource(blob);
        var img = decoded.img;
        var url = decoded.url;
        var nw = img.naturalWidth || img.width;
        var nh = img.naturalHeight || img.height;

        c = {
          url: url,
          img: img,
          width: nw,
          height: nh,
          naturalWidth: nw,
          naturalHeight: nh,
          origName: f.name,
          relPath: f.relPath,
          key: key,
          isBoxed: isBoxedImg
        };

        // 核心内存防线：如果加载完成时用户已经大幅切走（距离当前显示位置 > 6 张），
        // 视为过期失效任务，立即销毁释放显存，绝不塞入缓存挤出当前有用的相邻图片
        if (state.index >= 0 && Math.abs(index - state.index) > 6) {
          disposeCacheItem(c);
          return null;
        }

        state.cache.set(key, c);
        evictLRU(index);
        return c;
      } finally {
        inFlightImagePromises.delete(inFlightKey);
      }
    })();

    inFlightImagePromises.set(inFlightKey, loadPromise);
    return loadPromise;
  }

  function evictLRU(cur) {
    if (state.cache.size <= CACHE_LIMIT) return;
    var currentKey = curKey();
    var curIdx = (state.index >= 0) ? state.index : cur;
    var keys = Array.from(state.cache.keys());
    keys.sort(function (a, b) {
      var ia = (state.indexByKey && state.indexByKey.has(a)) ? state.indexByKey.get(a) : -99999;
      var ib = (state.indexByKey && state.indexByKey.has(b)) ? state.indexByKey.get(b) : -99999;
      // 距离当前 curIdx 越远越优先逐出；孤儿 key 直接最优先逐出
      var distA = (ia === -99999) ? 999999 : Math.abs(ia - curIdx);
      var distB = (ib === -99999) ? 999999 : Math.abs(ib - curIdx);
      return distB - distA;
    });
    for (var i = 0; i < keys.length; i++) {
      if (state.cache.size <= CACHE_LIMIT) break;
      var k = keys[i];
      if (k === currentKey) continue;
      var curF = state.files && state.files[state.index];
      if (curF && fileKey(curF) === k) continue;
      var c = state.cache.get(k);
      disposeCacheItem(c);
      state.cache.delete(k);
    }
  }

  function preload(index) {
    if (index < 0 || !state.files || index >= state.files.length) return;
    schedulePreloadAhead(index);
  }


  /* ================= 极速轻量预加载引擎（单路限流 + 贴身预测） ================= */

  var preloadQueue = [];
  var activePreloadCount = 0;
  var MAX_CONCURRENT_PRELOAD = 2; // 双路后台异步解码，充分发挥多核并发优势
  var preloadGeneration = 0;      // 换代计数器：切图时作废旧代任务

  function schedulePreload(curIdx) {
    schedulePreloadAhead(curIdx);
  }

  function schedulePreloadAhead(curIdx) {
    if (!state.files || state.files.length === 0 || curIdx < 0) return;
    preloadGeneration++;
    var thisGen = preloadGeneration;

    var targets = [];
    var seen = new Set();
    seen.add(curIdx);

    // 1. 向前预测 3~4 张（主切图方向）
    var fwd = curIdx;
    for (var i = 0; i < 4; i++) {
      var next = (typeof getNextFilteredIndex === 'function') ? getNextFilteredIndex(fwd, 1) : (fwd + 1);
      if (next >= 0 && next < state.files.length && !seen.has(next)) {
        seen.add(next);
        targets.push({ idx: next, priority: 20 - i * 2 });
        fwd = next;
      } else {
        break;
      }
    }

    // 2. 向后缓冲 2 张（回看微缓冲）
    var bwd = curIdx;
    for (var j = 0; j < 2; j++) {
      var prev = (typeof getNextFilteredIndex === 'function') ? getNextFilteredIndex(bwd, -1) : (bwd - 1);
      if (prev >= 0 && prev < state.files.length && !seen.has(prev)) {
        seen.add(prev);
        targets.push({ idx: prev, priority: 12 - j * 2 });
        bwd = prev;
      } else {
        break;
      }
    }

    // 过滤掉已处于有效缓存中的目标
    var pendingItems = [];
    for (var k = 0; k < targets.length; k++) {
      var tIdx = targets[k].idx;
      var f = state.files[tIdx];
      if (!f) continue;
      var key = fileKey(f);
      var c = state.cache ? state.cache.get(key) : null;
      var isMarked = !!(state.markedFiles && state.markedFiles.has(key)) && !!(state.markedBoxedHandles && state.markedBoxedHandles.has(key));
      var isCachedValid = c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0)) && (isMarked === c.isBoxed);
      if (!isCachedValid) {
        pendingItems.push(targets[k]);
      }
    }

    // 按优先级从高到低排列
    pendingItems.sort(function (a, b) { return b.priority - a.priority; });
    preloadQueue = pendingItems.map(function (item) { return item.idx; });

    processPreloadQueue(thisGen);
  }

  function processPreloadQueue(gen) {
    if (gen !== preloadGeneration) return;
    while (activePreloadCount < MAX_CONCURRENT_PRELOAD && preloadQueue.length > 0) {
      var nextIdx = preloadQueue.shift();
      activePreloadCount++;

      getImage(nextIdx).catch(function () {}).finally(function () {
        activePreloadCount--;
        if (gen === preloadGeneration) {
          processPreloadQueue(gen);
        }
      });
    }
  }


  /* ================= 筛选匹配与上一张/下一张定位核心辅助 ================= */

  function isFileMatchingFilter(idx) {
    if (idx < 0 || !state.files || idx >= state.files.length) return false;
    if (filterMode === 'all') return true;
    var f = state.files[idx];
    var fKey = fileKey(f);
    var isMarked = !!(state.markedFiles && state.markedFiles.has(fKey));
    var isViewed = isFileViewed(f);
    if (filterMode === 'marked') return isMarked;
    if (filterMode === 'unmarked') return !isMarked;
    if (filterMode === 'unviewed') return !isViewed;
    return true;
  }

  var filterListDirty = true;
  var cachedFilteredList = [];
  var cachedFilteredPosMap = new Map();

  function invalidateFilterList() {
    filterListDirty = true;
  }

  function ensureFilterList() {
    if (!filterListDirty) return;
    cachedFilteredList = [];
    cachedFilteredPosMap.clear();
    if (state.files) {
      for (var fi = 0; fi < state.files.length; fi++) {
        if (isFileMatchingFilter(fi)) {
          cachedFilteredPosMap.set(fi, cachedFilteredList.length);
          cachedFilteredList.push(fi);
        }
      }
    }
    filterListDirty = false;
  }

  function getNextFilteredIndex(fromIdx, step) {
    if (!state.files || state.files.length === 0) return -1;
    if (filterMode === 'all') {
      var next = fromIdx + step;
      return (next >= 0 && next < state.files.length) ? next : -1;
    }
    ensureFilterList();
    if (cachedFilteredList.length === 0) return -1;
    if (fromIdx < 0) return cachedFilteredList[0];
    var pos = cachedFilteredPosMap.has(fromIdx) ? cachedFilteredPosMap.get(fromIdx) : -1;
    if (pos >= 0) {
      var nPos = pos + step;
      return (nPos >= 0 && nPos < cachedFilteredList.length) ? cachedFilteredList[nPos] : -1;
    }
    if (step > 0) {
      for (var k = 0; k < cachedFilteredList.length; k++) {
        if (cachedFilteredList[k] > fromIdx) return cachedFilteredList[k];
      }
    } else {
      for (var m = cachedFilteredList.length - 1; m >= 0; m--) {
        if (cachedFilteredList[m] < fromIdx) return cachedFilteredList[m];
      }
    }
    return -1;
  }

  function updateHud() {
    if (state.index < 0) {
      counter.textContent = '— / —'; groupTag.textContent = ''; filenameEl.textContent = '';
      dirtyDot.style.display = 'none'; btnPrev.disabled = btnNext.disabled = true;
      if (sideCurLine) sideCurLine.textContent = '—';
      if (sideCurTower) sideCurTower.textContent = '—';
      if (sideCurLoc) sideCurLoc.textContent = '—';
      if (sideCurMarkedStatus) sideCurMarkedStatus.textContent = '—';
      if (sideCurCriticalStatus) sideCurCriticalStatus.textContent = '—';
      updateCriticalButtonState(false);
      if (btnBackToCurrent) btnBackToCurrent.style.display = 'none';
      return;
    }
    var f = state.files[state.index];
    var parsed = parseFilePrefixAndLocation(f.name, f.relPath);

    // 筛选状态下动态统计当前过滤集合内的位置和总数（采用 O(1) 索引映射，彻底消除千图切图延迟）
    if (filterMode !== 'all') {
      ensureFilterList();
      var filterCount = cachedFilteredList.length;
      var filterPos = cachedFilteredPosMap.has(state.index) ? (cachedFilteredPosMap.get(state.index) + 1) : 0;
      var filterNames = { marked: '已标记', unmarked: '未标记', unviewed: '未看' };
      var fLabel = filterNames[filterMode] || '筛选';
      counter.textContent = (filterPos > 0 ? filterPos : '—') + ' / ' + filterCount + ' [' + fLabel + ']';
      counter.title = '当前在【' + fLabel + '】筛选下：第 ' + filterPos + ' / 共 ' + filterCount + ' 张（总序列第 ' + (state.index + 1) + ' / ' + state.files.length + ' 张）';
    } else {
      counter.textContent = (state.index + 1) + ' / ' + state.files.length;
      counter.title = '第 ' + (state.index + 1) + ' / 共 ' + state.files.length + ' 张照片';
    }

    var fKey = fileKey(f);
    var isCurPhotoMarked = !!(state.markedFiles && state.markedFiles.has(fKey));
    var curDefectTag = isCurPhotoMarked ? getDefectTagsForFile(fKey) : '';

    groupTag.textContent = '【' + parsed.prefix + ' · ' + parsed.tower + '】';
    if (curDefectTag) {
      filenameEl.innerHTML = esc(f.name) + '<span style="color:var(--accent);font-weight:600;margin-left:4px" title="已标缺陷标签">' + esc(curDefectTag) + '</span>';
    } else {
      filenameEl.textContent = f.name;
    }
    filenameEl.title = f.relPath || f.name;

    var m = getMeta(f.name);
    dirtyDot.style.display = (m.boxes && m.boxes.length > 0 && !m.saved) ? '' : 'none';

    // 上一张/下一张按钮根据当前筛选集合智能判断是否可点击
    var hasPrev = getNextFilteredIndex(state.index, -1) >= 0;
    var hasNext = getNextFilteredIndex(state.index, 1) >= 0;
    btnPrev.disabled = !hasPrev;
    btnNext.disabled = !hasNext;

    if (sideCurLine) sideCurLine.textContent = parsed.prefix;
    if (sideCurTower) sideCurTower.textContent = parsed.tower;
    if (sideCurLoc) {
      sideCurLoc.innerHTML = esc(parsed.loc) + (curDefectTag ? (' <span style="color:var(--accent);font-weight:600">' + esc(curDefectTag) + '</span>') : '');
    }
    if (sideCurMarkedStatus) {
      if (isCurPhotoMarked) {
        var cImg = state.cache.get(fKey);
        var isViewingBoxed = cImg && cImg.isBoxed;
        var toggleBtn = '<button id="btnToggleBoxedView" class="mini-tool-btn" type="button" style="color:' + (isViewingBoxed ? 'var(--text)' : 'var(--accent)') + ';font-size:10px;padding:0 5px;height:18px;margin-left:4px;display:inline-flex;align-items:center" title="' + (isViewingBoxed ? '当前显示为缺陷圈示图，点击查看纯净原图' : '当前显示为原图，点击切换至缺陷圈示图') + '">' + (isViewingBoxed ? '查看原图' : '查看圈示图') + '</button>';
        sideCurMarkedStatus.innerHTML = '<span style="color:var(--accent);font-weight:600">已标记' + (isViewingBoxed ? ' (圈示图)' : ' (原图)') + '</span>' + toggleBtn + ' <button id="btnCancelCurrentMarked" class="mini-tool-btn" type="button" style="color:var(--accent);font-size:10px;padding:0 5px;height:18px;margin-left:4px;border-color:var(--accent);display:inline-flex;align-items:center;gap:3px" title="取消当前图片的缺陷标记，并从输出目录中删除对应的缺陷圈示图与缺陷原图"><svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" style="display:block"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>取消已标</button>';
        var cancelBtn = document.getElementById('btnCancelCurrentMarked');
        if (cancelBtn) {
          cancelBtn.onclick = function () {
            cancelMarkedDefect(state.index);
          };
        }
        var toggleEl = document.getElementById('btnToggleBoxedView');
        if (toggleEl) {
          toggleEl.onclick = async function () {
            var curCached = state.cache.get(fKey);
            var wantClean = curCached && curCached.isBoxed;
            loadingEl.style.display = '';
            try {
              var newC = await getImage(state.index, wantClean);
              if (newC && newC.img) {
                var size = getImgSize(newC);
                if (size.w > 0 && size.h > 0) {
                  state.natural = { w: size.w, h: size.h };
                  var nFit = computeFit(size.w, size.h);
                  fitView(nFit.w, nFit.h, nFit.s);
                  render(newC.img);
                  renderSide();
                  updateHud();
                  toast(wantClean ? '已切换至纯净原图' : '已切换至缺陷圈示图');
                }
              }
            } catch (err) {
              toast('切换视图失败：' + (err && err.message || err));
            } finally {
              loadingEl.style.display = 'none';
            }
          };
        }
      } else {
        sideCurMarkedStatus.innerHTML = '<span style="color:var(--muted)">未标记</span> <button id="btnDeleteCurrentInput" class="mini-tool-btn" type="button" style="color:var(--accent);font-size:10px;padding:0 5px;height:18px;margin-left:6px;border-color:var(--accent);display:inline-flex;align-items:center;gap:3px" title="彻底物理删除输入文件夹中的当前原图文件"><svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" style="display:block"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>删除原图</button>';
        var delInputBtn = document.getElementById('btnDeleteCurrentInput');
        if (delInputBtn) {
          delInputBtn.onclick = function () {
            deleteInputPhoto(state.index);
          };
        }
      }
    }

    if (sideCurViewedStatus) {
      var isCurPhotoViewed = isFileViewed(f);
      if (isCurPhotoViewed) {
        sideCurViewedStatus.innerHTML = '<span style="color:var(--ok);font-weight:600">已看</span>';
      } else {
        sideCurViewedStatus.innerHTML = '<span style="color:var(--warn)">未看</span>';
      }
    }

    var fKey = f.relPath || f.name;
    var isCurPhotoCritical = !!(state.criticalFiles && state.criticalFiles.has(fKey));
    if (sideCurCriticalStatus) {
      if (isCurPhotoCritical) {
        sideCurCriticalStatus.innerHTML = '<span style="color:#d9860f;font-weight:600">已存危急</span> <button id="btnCancelCurrentCritical" class="mini-tool-btn" type="button" style="color:#d9860f;font-size:10px;padding:0 5px;height:18px;margin-left:4px;border-color:#d9860f;display:inline-flex;align-items:center;gap:3px" title="撤回危急缺陷保存，仅从「危急缺陷」文件夹删除对应文件"><svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" style="display:block"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>撤回</button>';
        var cancelCritBtn = document.getElementById('btnCancelCurrentCritical');
        if (cancelCritBtn) {
          cancelCritBtn.onclick = function () {
            cancelCriticalOnly(state.files[state.index] && state.files[state.index].name);
          };
        }
      } else {
        sideCurCriticalStatus.innerHTML = '<span style="color:var(--muted)">未保存</span>';
      }
    }
    updateCriticalButtonState(isCurPhotoCritical);
    if (btnBackToCurrent) {
      btnBackToCurrent.style.display = (state.files && state.files.length > 0) ? 'inline-flex' : 'none';
      var lastVIdx = (typeof state.lastViewedIndex === 'number' && state.lastViewedIndex >= 0) ? state.lastViewedIndex : -1;
      if (lastVIdx < 0 && state.files) {
        for (var vi = state.files.length - 1; vi >= 0; vi--) {
          if (isFileViewed(state.files[vi])) {
            lastVIdx = vi;
            state.lastViewedIndex = vi;
            break;
          }
        }
      }
      if (lastVIdx >= 0) {
        var lastVF = state.files[lastVIdx];
        var lastVParsed = parseFilePrefixAndLocation(lastVF.name, lastVF.relPath);
        btnBackToCurrent.title = '直达最后一个已看照片：' + lastVParsed.tower + ' · ' + lastVParsed.loc + ' (第 ' + (lastVIdx + 1) + '/' + state.files.length + ' 张，快捷键: C)';
      } else {
        btnBackToCurrent.title = '直达最后一个已看照片 (快捷键: C)';
      }
    }
  }


  /* ================= 极速图片切换引擎（0 延迟即时响应 + 渲染解耦） ================= */

  var navTargetIndex = -1;
  var switchGeneration = 0;
  var loadingDebounceTimer = null;

  function updateHudLightweight(index) {
    if (index < 0 || !state.files || !state.files[index]) return;
    var f = state.files[index];
    if (filterMode !== 'all') {
      ensureFilterList();
      var filterCount = cachedFilteredList.length;
      var filterPos = cachedFilteredPosMap.has(index) ? (cachedFilteredPosMap.get(index) + 1) : 0;
      var filterNames = { marked: '已标记', unmarked: '未标记', unviewed: '未看' };
      var fLabel = filterNames[filterMode] || '筛选';
      counter.textContent = (filterPos > 0 ? filterPos : '—') + ' / ' + filterCount + ' [' + fLabel + ']';
    } else {
      counter.textContent = (index + 1) + ' / ' + state.files.length;
    }
    var parsed = parseFilePrefixAndLocation(f.name, f.relPath);
    groupTag.textContent = '【' + parsed.prefix + ' · ' + parsed.tower + '】';
    filenameEl.textContent = f.name;
    filenameEl.title = f.relPath || f.name;
  }

  var pendingSyncRaf = null;

  function syncAllUI(index) {
    if (index < 0 || !state.files || !state.files[index]) return;
    updateHud();
    if (pendingSyncRaf) {
      cancelAnimationFrame(pendingSyncRaf);
    }
    pendingSyncRaf = requestAnimationFrame(function () {
      pendingSyncRaf = null;
      renderSide();
      updatePathTreeSelection(index, true);
    });
  }

  async function switchTo(index, force) {
    if (index < 0 || !state.files || index >= state.files.length) return;
    navTargetIndex = index;

    // 核心功能：当切图片时若当前图片已圈示红框但尚未保存，提醒用户
    if (!force && state.index >= 0 && state.files[state.index] && state.index !== index) {
      var curPhoto = state.files[state.index];
      var curM = getMeta(curPhoto.name);
      var hasUnsavedBoxes = curM && curM.boxes && curM.boxes.length > 0 && !curM.saved;
      if (hasUnsavedBoxes) {
        var ok = await showConfirmDialog(
          '未保存提醒',
          '当前图片【' + curPhoto.name + '】已圈示 ' + curM.boxes.length + ' 处红框但尚未保存输出。\n\n直接切换将放弃未保存的圈示，确定要切换吗？'
        );
        if (!ok) {
          navTargetIndex = state.index;
          return;
        }
      }
    }

    if (index === state.index && !force) return;

    switchGeneration++;
    var thisSwitchGen = switchGeneration;

    state.index = index;
    selectedIndex = -1;

    var curF = state.files[index];
    var isNewlyViewed = markFileViewed(curF);
    if (isNewlyViewed) {
      saveViewedPhotos();
    }

    if (isNewlyViewed && filterMode === 'unviewed') {
      invalidateFilterList();
    }

    // 0ms 即时轻量更新 HUD（数字与文件名秒变）
    updateHudLightweight(index);

    // 核心优化：优先从显存预解码缓存中直出画面（第 0 帧瞬时上屏，绝对零卡顿零白屏）
    var curFKey = fileKey(curF);
    var cached = state.cache.get(curFKey);
    var isMarked = !!(state.markedFiles && state.markedFiles.has(curFKey)) && !!(state.markedBoxedHandles && state.markedBoxedHandles.has(curFKey));
    var isCacheValid = cached && cached.img && ((cached.img.naturalWidth > 0) || (cached.img.width > 0)) && (cached.img.complete !== false) && (isMarked ? cached.isBoxed : !cached.isBoxed);

    if (isCacheValid) {
      clearTimeout(loadingDebounceTimer);
      if (loadingEl) loadingEl.style.display = 'none';

      var nw = cached.img.naturalWidth || cached.img.width;
      var nh = cached.img.naturalHeight || cached.img.height;
      state.natural = { w: nw, h: nh };
      var fit = computeFit(nw, nh);
      fitView(fit.w, fit.h, fit.s);
      render();

      schedulePreloadAhead(index);
      syncAllUI(index);
      return;
    }

    // 未命中缓存：防抖 80ms 显示加载指示器，启动异步加载并渲染
    clearTimeout(loadingDebounceTimer);
    loadingDebounceTimer = setTimeout(function () {
      if (thisSwitchGen === switchGeneration && loadingEl) {
        loadingEl.style.display = '';
      }
    }, 80);

    try {
      var c = await getImage(index);
      if (thisSwitchGen !== switchGeneration) {
        // 加载期间用户已切换到新图，丢弃旧帧避免抢占最新画面
        return;
      }
      clearTimeout(loadingDebounceTimer);
      if (loadingEl) loadingEl.style.display = 'none';

      if (c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0))) {
        var cnw = c.img.naturalWidth || c.img.width;
        var cnh = c.img.naturalHeight || c.img.height;
        state.natural = { w: cnw, h: cnh };
        var fit2 = computeFit(cnw, cnh);
        fitView(fit2.w, fit2.h, fit2.s);
        render();
      }

      schedulePreloadAhead(index);
      syncAllUI(index);
    } catch (err) {
      if (thisSwitchGen !== switchGeneration) return;
      clearTimeout(loadingDebounceTimer);
      if (loadingEl) loadingEl.style.display = 'none';
      toast('加载失败：' + (err && err.message || err));
    }
  }


  /* ================= 长按极速连切引擎（Hold-to-Fast-Scrub Engine：防抖、防误触、防多跳） ================= */
  var activeHoldKey = null; // 'left' | 'right' | null
  var holdInitialTimer = null;
  var isScrubLoopRunning = false;
  var isStepping = false;
  var lastStepTime = 0;

  async function stepSwitch(dir) {
    var now = performance.now();
    // 基础防抖：距上次切图小于 70ms 的高频重复触发直接拦截（彻底杜绝按键微动双击/微抖多跳）
    if (isStepping || (now - lastStepTime < 70)) {
      return false;
    }
    isStepping = true;
    lastStepTime = now;

    try {
      var curIdx = (state.index >= 0) ? state.index : 0;
      var nextIdx = getNextFilteredIndex(curIdx, dir);
      if (nextIdx >= 0 && nextIdx !== state.index) {
        navTargetIndex = nextIdx;
        await switchTo(nextIdx);
        return true;
      } else {
        if (nextIdx < 0 && state.files && state.files.length > 0) {
          var msg = (filterMode === 'all') ? (dir > 0 ? '已是最后一张照片' : '已是第一张照片') :
                    (filterMode === 'marked' ? (dir > 0 ? '已是最后一张已标记照片' : '已是第一张已标记照片') :
                    (filterMode === 'unmarked' ? (dir > 0 ? '已是最后一张未标记照片' : '已是第一张未标记照片') :
                    (dir > 0 ? '已是最后一张未看照片' : '已是第一张未看照片')));
          toast(msg);
        }
        return false;
      }
    } finally {
      isStepping = false;
    }
  }

  function startHoldScrub(direction) {
    var targetKeyType = direction > 0 ? 'right' : 'left';
    if (activeHoldKey === targetKeyType) return;
    stopHoldScrub();

    activeHoldKey = targetKeyType;

    // 1. 立即执行第 1 次切换（0ms 即点即切）
    stepSwitch(direction);

    // 2. 蓄力长按检测：必须长按超过 650ms 才进入连切模式，彻底杜绝单按/慢按误判多跳
    holdInitialTimer = setTimeout(async function () {
      holdInitialTimer = null;
      if (activeHoldKey !== targetKeyType || isScrubLoopRunning) return;

      isScrubLoopRunning = true;
      try {
        while (activeHoldKey === targetKeyType) {
          var t0 = performance.now();
          var ok = await stepSwitch(direction);
          if (!ok || activeHoldKey !== targetKeyType) break;

          var elapsed = performance.now() - t0;
          var delay = Math.max(50, 180 - elapsed);
          await new Promise(function (res) { setTimeout(res, delay); });
        }
      } finally {
        isScrubLoopRunning = false;
      }
    }, 650);
  }

  function stopHoldScrub() {
    activeHoldKey = null;
    if (holdInitialTimer) {
      clearTimeout(holdInitialTimer);
      holdInitialTimer = null;
    }
  }

  function navNext() {
    if (btnNext) btnNext.blur();
    stepSwitch(1);
  }

  function navPrev() {
    if (btnPrev) btnPrev.blur();
    stepSwitch(-1);
  }

  btnPrev.addEventListener('click', navPrev);
  btnNext.addEventListener('click', navNext);

  if (btnBottomSave) btnBottomSave.addEventListener('click', function () { saveBothFolders(); });
  if (btnClearSecondary) btnClearSecondary.addEventListener('click', function () { clearForSecondaryEdit(); });
  if (btnCritical) btnCritical.addEventListener('click', function () { saveCriticalOnly(); });

  if (strokeSlider) {
    strokeSlider.addEventListener('input', function (e) {
      strokeWidth = parseInt(e.target.value, 10) || 10;
      if (strokeVal) strokeVal.textContent = strokeWidth + 'px';
      try { localStorage.setItem(KEY_STROKE, String(strokeWidth)); } catch (err) {}
      renderOverlay();
    });
  }

  var defectSearchDebounceTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      if (defectSearchDebounceTimer) clearTimeout(defectSearchDebounceTimer);
      defectSearchDebounceTimer = setTimeout(function () {
        defectSearchDebounceTimer = null;
        renderSide();
      }, 80);
    });
  }
  if (searchClear) {
    searchClear.addEventListener('click', function () {
      if (searchInput) searchInput.value = '';
      renderSide();
      if (searchInput) searchInput.focus();
    });
  }
  var btnFilterCritical = $('btnFilterCritical');
  if (btnFilterCritical) {
    btnFilterCritical.addEventListener('click', function () {
      if (searchInput) {
        if (searchInput.value === '危急' || searchInput.value === '危急缺陷') {
          searchInput.value = '';
        } else {
          searchInput.value = '危急';
        }
        renderSide();
        searchInput.focus();
      }
    });
  }

  window.addEventListener('keydown', function (e) {
    var isInput = (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable));
    var hasActiveModal = !!document.querySelector('.overlay.show');

    var isLeftKey = (e.key === 'ArrowLeft' || ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.altKey && !e.metaKey));
    var isRightKey = (e.key === 'ArrowRight' || ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.altKey && !e.metaKey));

    if ((isLeftKey || isRightKey) && !isInput && !hasActiveModal) {
      e.preventDefault();
      if (e.repeat) return; // 忽略操作系统原生按键连发，由引擎精准调度，杜绝长按原生重复导致的偶发多跳
      var dir = isRightKey ? 1 : -1;
      startHoldScrub(dir);
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput && !hasActiveModal) {
      if (selectedIndex >= 0) {
        e.preventDefault();
        deleteSelectedBox();
      }
    } else if (((e.key === ' ' || e.code === 'Space') && !isInput && !hasActiveModal && !e.ctrlKey && !e.altKey && !e.metaKey) ||
               (e.altKey && (e.key === 's' || e.key === 'S'))) {
      e.preventDefault();
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') {
        document.activeElement.blur();
      }
      saveBothFolders();
    } else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z') && !isInput && !hasActiveModal) {
      e.preventDefault();
      undoLastAction();
    } else if ((e.key === 'c' || e.key === 'C') && !isInput && !hasActiveModal && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      scrollToLastViewedPhoto();
    }
  });

  window.addEventListener('keyup', function (e) {
    var isLeftKey = (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A');
    var isRightKey = (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D');
    if (isLeftKey && activeHoldKey === 'left') {
      stopHoldScrub();
    } else if (isRightKey && activeHoldKey === 'right') {
      stopHoldScrub();
    }
  });

  window.addEventListener('blur', function () {
    stopHoldScrub();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopHoldScrub();
  });

  btnSettings.addEventListener('click', function () { settingsPanel.classList.toggle('show'); });

  // 界面缩放控制逻辑（支持自定义输入、步进调节与原生无感缩放）
  var KEY_ZOOM = 'patrol_ui_zoom';
  var btnZoomOut = $('btnZoomOut'), btnZoomIn = $('btnZoomIn'), btnZoomReset = $('btnZoomReset'), zoomInput = $('zoomInput');
  function getSavedZoom() {
    var val = parseFloat(localStorage.getItem(KEY_ZOOM));
    return isNaN(val) || val < 0.5 || val > 2 ? 1 : val;
  }
  function applyZoom(scale) {
    scale = Math.max(0.5, Math.min(2.0, Math.round(scale * 100) / 100));
    try { localStorage.setItem(KEY_ZOOM, String(scale)); } catch (e) {}
    var isTauri = !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
    if (isTauri) {
      try { window.__TAURI__.core.invoke('set_zoom', { scale: scale }); } catch (e) {}
      document.documentElement.style.zoom = '';
    } else {
      document.documentElement.style.zoom = scale;
    }
    invalidateCanvasRect();
    var pct = Math.round(scale * 100);
    if (zoomInput && document.activeElement !== zoomInput) zoomInput.value = pct;
    if (typeof recomputeViewerStage === 'function') {
      setTimeout(recomputeViewerStage, 50);
    }
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', function () { applyZoom(getSavedZoom() - 0.05); });
  }
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', function () { applyZoom(getSavedZoom() + 0.05); });
  }
  if (btnZoomReset) {
    btnZoomReset.addEventListener('click', function () { applyZoom(1.0); });
  }
  if (zoomInput) {
    zoomInput.addEventListener('change', function () {
      var val = parseFloat(zoomInput.value);
      if (!isNaN(val) && val >= 50 && val <= 200) {
        applyZoom(val / 100);
      } else {
        zoomInput.value = Math.round(getSavedZoom() * 100);
      }
    });
    zoomInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') zoomInput.blur();
    });
  }
  applyZoom(getSavedZoom());
  themeSwitch.addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY_THEME, theme); } catch (e) {}
    applyTheme();
  });
  btnResetDefects.addEventListener('click', function () {
    showConfirmDialog('重置缺陷分类', '确定要重置所有缺陷分类与标签为系统默认值吗？此操作将清除自定义分类。').then(function (ok) {
      if (!ok) return;
      defectDict = JSON.parse(JSON.stringify(DEFAULT_DEFECT_DICT));
      locationAdjacency = JSON.parse(JSON.stringify(DEFAULT_LOCATION_ADJACENCY));
      criticalDefects = new Set(CRITICAL_DEFECTS);
      candidatePool = getDefaultCandidatePool();
      hiddenDefects = {};
      saveDefectDict();
      saveCriticalDefects();
      saveAdjacency();
      saveCandidatePool();
      saveHidden();
      renderSide();
      toast('✓ 缺陷分类、危急属性与推荐规则已重置为默认');
    });
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      recomputeViewerStage();
    }, 120);
  });
