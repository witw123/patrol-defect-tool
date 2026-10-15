// 目录选择、递归文件树扫描与渲染、筛选与折叠、目录记忆重连与双击重命名


  /* ================= 打开文件夹 ================= */

  function extractGroup(name) {
    var m = name.match(/#(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  async function scanImagesRecursive(dirHandle, out, prefix, parentHandle) {
    prefix = prefix || '';
    if (dirRegistry) {
      dirRegistry.set(prefix, { handle: dirHandle, parentHandle: parentHandle || null, name: dirHandle.name });
    }
    for await (var pair of dirHandle.entries()) {
      var name = pair[0], handle = pair[1];
      if (handle.kind === 'directory') {
        // 严禁将输出目录（缺陷圈示图、缺陷原图、危急缺陷、全绝缘缺陷、其他缺陷）作为待检原图扫描，避免自己扫描自己的输出结果！
        if (name === '缺陷圈示图' || name === '缺陷原图' || name === '危急缺陷' || name === '全绝缘缺陷' || name === '其他缺陷' || name.startsWith('.')) {
          continue;
        }
        var nextPrefix = prefix + name + '/';
        if (state.discoveredDirs) {
          state.discoveredDirs.push(nextPrefix);
        }
        await scanImagesRecursive(handle, out, nextPrefix, dirHandle);
      } else if (handle.kind === 'file') {
        var ext = name.slice(name.lastIndexOf('.')).toLowerCase();
        if (IMG_EXTS.indexOf(ext) >= 0) {
          out.push({
            name: name,
            handle: handle,
            file: null,
            mime: mimeOf(name),
            relPath: prefix + name,
            group: extractGroup(name)
          });
        }
      }
    }
  }

  function updateFolderButtonText() {
    if (state.files.length > 0) {
      var name = (lastInputHandle ? lastInputHandle.name : '') || savedInputName || '已打开';
      if (inputFolderBtnText) {
        inputFolderBtnText.textContent = name;
      }
      btnFolder.title = '当前输入目录：' + name + '（点击更换文件夹，右键强制打开选择器）';
    } else if (savedInputName) {
      if (inputFolderBtnText) {
        inputFolderBtnText.innerHTML = '恢复: <b style="color:var(--accent)">' + esc(savedInputName) + '</b>';
      }
      btnFolder.title = '上次打开目录：' + savedInputName + '（点击直接恢复连接，右键更换新目录）';
    } else {
      if (inputFolderBtnText) {
        inputFolderBtnText.textContent = '未选择';
      }
      btnFolder.title = '点击选择包含巡检照片的输入文件夹';
    }
  }

  function updateEmptyScreenRestoreButton() {
    if (btnEmptyRestore && emptyRestoreDirName) {
      var name = savedInputName || (lastInputHandle ? lastInputHandle.name : '');
      if (name) {
        emptyRestoreDirName.textContent = name;
        btnEmptyRestore.style.display = 'inline-flex';
        btnEmptyPick.textContent = '选择其他文件夹';
        btnEmptyPick.classList.remove('primary');
      } else {
        btnEmptyRestore.style.display = 'none';
        btnEmptyPick.textContent = '选择输入文件夹';
        btnEmptyPick.classList.add('primary');
      }
    }
  }

  async function pickFolder(forceNewPicker) {
    if (!window.showDirectoryPicker) {
      toast('需要 Chrome/Edge 且支持 File System Access API');
      return;
    }

    // 1. 如果未指定强制重新选择，且已有记忆的输入目录句柄，直接尝试一键重新连接恢复
    if (!forceNewPicker && lastInputHandle && state.files.length === 0) {
      try {
        var status = await lastInputHandle.queryPermission({ mode: 'readwrite' });
        if (status !== 'granted') {
          status = await lastInputHandle.requestPermission({ mode: 'readwrite' });
        }
        if (status === 'granted') {
          loadingEl.style.display = '';
          state.discoveredDirs = [];
          var entries = [];
          await scanImagesRecursive(lastInputHandle, entries, '');
          loadingEl.style.display = 'none';
          if (entries.length > 0) {
            setupFiles(entries, 'fs', lastInputHandle);
            toast('✓ 已恢复打开记忆的输入目录：' + lastInputHandle.name);
            return;
          } else {
            toast('该记忆目录下未找到照片，请重新选择');
          }
        }
      } catch (e) {
        loadingEl.style.display = 'none';
        console.warn('恢复上次输入目录失败，将打开目录选择器:', e);
      }
    }

    // 2. 弹出系统目录选择器（自动定位在上次打开的目录）
    try {
      var pickerOpts = { mode: 'readwrite' };
      if (lastInputHandle) pickerOpts.startIn = lastInputHandle;
      var handle = await window.showDirectoryPicker(pickerOpts);
      loadingEl.style.display = '';
      state.discoveredDirs = [];
      var entries2 = [];
      await scanImagesRecursive(handle, entries2, '');
      loadingEl.style.display = 'none';
      if (entries2.length === 0 && (!state.discoveredDirs || state.discoveredDirs.length === 0)) {
        toast('该目录下没有找到任何子文件夹或 jpg/jpeg/png 图片');
        return;
      }
      setupFiles(entries2, 'fs', handle);
      toast('✓ 已打开输入目录：' + handle.name);
    } catch (err) {
      loadingEl.style.display = 'none';
      if (err && err.name === 'AbortError') return;
      toast('无法打开文件夹：' + (err && err.message || err));
    }
  }

  function dirOf(p) {
    var i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  }

  function comparePhotos(a, b) {
    var pa = parseFilePrefixAndLocation(a.name, a.relPath);
    var pb = parseFilePrefixAndLocation(b.name, b.relPath);

    // 1. 严格按线路名称自然升序排序
    var lineCmp = pa.prefix.localeCompare(pb.prefix, 'zh-CN', { numeric: true, sensitivity: 'base' });
    if (lineCmp !== 0) return lineCmp;

    // 2. 核心：严格按杆塔数字编号升序排序（避免 #1, #10, #2，确保 #1 -> #2 -> #3 -> #10 顺序连贯）
    if (pa.towerNum !== pb.towerNum) {
      return pa.towerNum - pb.towerNum;
    }

    // 3. 杆塔名称字面自然比较（如 #036 < #036-1 < #036-2 < #037）
    var towerCmp = pa.tower.localeCompare(pb.tower, 'zh-CN', { numeric: true, sensitivity: 'base' });
    if (towerCmp !== 0) return towerCmp;

    // 4. 同一杆塔内的照片，按目录层级与文件名自然排序
    var da = dirOf(a.relPath || a.name);
    var db = dirOf(b.relPath || b.name);
    var dirCmp = da.localeCompare(db, 'zh-CN', { numeric: true, sensitivity: 'base' });
    if (dirCmp !== 0) return dirCmp;

    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  }

  function setupFiles(entries, mode, handle) {
    if (handle) {
      lastInputHandle = handle;
      savedInputName = handle.name;
      try { localStorage.setItem(KEY_INPUT_NAME, handle.name); } catch (e) {}
      saveDirHandle('last_input_handle', handle);
    }

    // 彻底过滤掉任何属于「缺陷圈示图」或「缺陷原图」目录的图片文件，确保列表全为真正独立的待检原图
    entries = entries.filter(function (e) {
      var p = (e.relPath || e.name || '');
      return p.indexOf('缺陷圈示图') < 0 && p.indexOf('缺陷原图') < 0 && p.indexOf('危急缺陷') < 0 && p.indexOf('全绝缘缺陷') < 0 && p.indexOf('其他缺陷') < 0;
    });

    if (!state.discoveredDirs || state.discoveredDirs.length === 0) {
      var dirSet = new Set();
      for (var fi = 0; fi < entries.length; fi++) {
        var p = entries[fi].relPath || '';
        var idx = p.lastIndexOf('/');
        if (idx > 0) {
          dirSet.add(p.slice(0, idx + 1));
        }
      }
      state.discoveredDirs = Array.from(dirSet);
    }

    // 必须在排序前清空缓存，保证 comparePhotos 使用最新的 rootLineName 和解析结果
    parsedFileCache.clear();
    entries.sort(comparePhotos);

    clearCache();
    collapsedGroups.clear();
    collapsedTowers.clear();
    lastActiveTowerKey = null;
    lastActivePrefix = null;
    lastActiveTowerEl = null;
    lastActivePrefixEl = null;
    lastActiveLocItemEl = null;
    filterMode = 'all';
    btnFilterAll.classList.add('active');
    btnFilterMarked.classList.remove('active');
    btnFilterUnmarked.classList.remove('active');
    btnFilterUnviewed.classList.remove('active');
    state.mode = mode;
    state.files = entries;
    invalidateFilterList();
    state.byName = new Map();
    state.byKey = new Map();
    state.indexByName = new Map();
    state.indexByKey = new Map();
    state.meta = new Map();
    state.markedFiles = new Set();
    state.markedBoxedHandles = new Map();
    state.markedDefectTags = new Map();
    state.markedCounts = new Map();
    for (var i = 0; i < entries.length; i++) {
      var eKey = fileKey(entries[i]);
      state.byKey.set(eKey, entries[i]);
      state.byName.set(entries[i].name, entries[i]);
      state.indexByKey.set(eKey, i);
      state.indexByName.set(entries[i].name, i);
    }
    buildInputNameIndex();
    state.index = -1;
    empty.style.display = 'none';
    if (viewerBottomBar) viewerBottomBar.style.display = 'flex';

    updateFolderButtonText();

    if (output.mainHandle) {
      scanOutputDirectory();
    } else {
      renderPathTree(false);
    }

    autoFitLeftPanelWidth();
    switchTo(0);
  }

  function disposeCacheItem(c) {
    if (!c) return;
    try {
      if (c.img && typeof c.img.close === 'function') {
        c.img.close();
      }
    } catch (e) {}
    try {
      if (c.url) URL.revokeObjectURL(c.url);
    } catch (e) {}
    if (c.img && c.img.tagName === 'IMG') {
      c.img.onload = null;
      c.img.onerror = null;
      c.img.src = '';
    }
    if (currentRenderedImg === c.img) {
      currentRenderedImg = null;
    }
    c.img = null;
    c.url = null;
  }

  function clearCache() {
    state.cache.forEach(function (c) {
      disposeCacheItem(c);
    });
    state.cache.clear();
    preloadQueue = [];
    preloadGeneration++;
  }


  /* ---- 全局与杆塔/线路精确统计瞬时刷新（耗时 < 2ms，不重建 DOM，不扰动滚动条） ---- */

  function refreshTreeStats() {
    if ((!state.files || state.files.length === 0) && (!state.discoveredDirs || state.discoveredDirs.length === 0)) {
      if (dirSummaryText) dirSummaryText.innerHTML = '';
      return;
    }

    var totalPhotos = (state.files && state.files.length) || 0;
    var totalViewedPhotos = 0;
    var totalMarkedPhotos = 0;
    var totalDefects = 0;
    var groupStats = new Map();
    var groupOrder = [];

    var allScannedDirs = state.discoveredDirs || [];
    var leafDirs = allScannedDirs.filter(function (d) {
      return !allScannedDirs.some(function (other) { return other !== d && other.startsWith(d); });
    });

    for (var di = 0; di < leafDirs.length; di++) {
      var dInfo = parseDirToLineAndTower(leafDirs[di]);
      if (!dInfo.tower || dInfo.tower === '默认杆塔') continue;
      var dPfx = dInfo.prefix;
      var dTwr = dInfo.tower;

      if (!groupStats.has(dPfx)) {
        groupStats.set(dPfx, {
          total: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedPhotos: 0,
          towersMap: new Map(),
          towerOrder: []
        });
        groupOrder.push(dPfx);
      }

      var dGrp = groupStats.get(dPfx);
      if (!dGrp.towersMap.has(dTwr)) {
        dGrp.towersMap.set(dTwr, {
          tower: dTwr,
          towerNum: dInfo.towerNum,
          total: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedPhotos: 0
        });
        dGrp.towerOrder.push(dTwr);
      }
    }

    for (var i = 0; i < totalPhotos; i++) {
      var f = state.files[i];
      var info = f._parsedInfo || (f._parsedInfo = parseFilePrefixAndLocation(f.name, f.relPath));
      var pfx = info.prefix;
      var twr = info.tower;
      var isViewed = isFileViewed(f);
      var fKey = fileKey(f);
      var isPhotoMarked = !!(state.markedFiles && state.markedFiles.has(fKey));
      var count = (state.markedCounts && state.markedCounts.get(fKey)) || (isPhotoMarked ? 1 : 0);

      if (isViewed) totalViewedPhotos++;
      if (isPhotoMarked) {
        totalMarkedPhotos++;
        totalDefects += count;
      }

      if (!groupStats.has(pfx)) {
        groupStats.set(pfx, {
          total: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedPhotos: 0,
          towersMap: new Map(),
          towerOrder: []
        });
        groupOrder.push(pfx);
      }
      var grp = groupStats.get(pfx);
      grp.total++;
      if (isViewed) grp.viewedPhotos++;
      if (isPhotoMarked) {
        grp.markedPhotos++;
        grp.markedDefects += count;
      }

      if (!grp.towersMap.has(twr)) {
        grp.towersMap.set(twr, {
          tower: twr,
          towerNum: info.towerNum,
          total: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedPhotos: 0
        });
        grp.towerOrder.push(twr);
      }
      var tData = grp.towersMap.get(twr);
      tData.total++;
      if (isViewed) tData.viewedPhotos++;
      if (isPhotoMarked) {
        tData.markedPhotos++;
        tData.markedDefects += count;
      }
    }

    groupOrder.sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var gObj = groupStats.get(groupOrder[gi]);
      gObj.towerOrder.sort(function (aKey, bKey) {
        var aObj = gObj.towersMap.get(aKey);
        var bObj = gObj.towersMap.get(bKey);
        var aNum = aObj ? aObj.towerNum : 999999;
        var bNum = bObj ? bObj.towerNum : 999999;
        if (aNum !== bNum) return aNum - bNum;
        return aKey.localeCompare(bKey, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
    }

    var totalTowers = 0;
    var totalFullyViewedTowers = 0;
    var totalStartedTowers = 0;
    var fastTowersMap = new Map();

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var pKey = groupOrder[gi];
      var gObj = groupStats.get(pKey);
      var lineFullyViewedTowers = 0;
      var lineStartedTowers = 0;
      var lineTowerCount = gObj.towerOrder.length;

      for (var ti = 0; ti < lineTowerCount; ti++) {
        var tKey = gObj.towerOrder[ti];
        var tObj = gObj.towersMap.get(tKey);
        totalTowers++;
        if (tObj.viewedPhotos >= tObj.total && tObj.total > 0) {
          lineFullyViewedTowers++;
          totalFullyViewedTowers++;
        }
        if (tObj.viewedPhotos > 0) {
          lineStartedTowers++;
          totalStartedTowers++;
        }

        // 局部同步更新对应杆塔的 DOM 徽章
        var fullTwrKey = pKey + ':::' + tKey;
        fastTowersMap.set(fullTwrKey, tObj);
        var twrEl = pathTree.querySelector('.tower-group[data-tower-key="' + fullTwrKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
        if (twrEl) {
          var twrMeta = twrEl.querySelector('.tower-meta');
          if (twrMeta) {
            // 已标徽章
            var mBadge = twrMeta.querySelector('.tower-marked-badge');
            if (mBadge) {
              if (tObj.markedPhotos > 0) {
                mBadge.className = 'badge marked tower-marked-badge';
                mBadge.style.cssText = 'font-size:9.5px;padding:1px 4px;font-weight:600';
                var twrDefectTxt = (tObj.markedDefects > tObj.markedPhotos) ? (' (' + tObj.markedDefects + '处)') : '';
                mBadge.title = '该杆塔包含 ' + tObj.markedPhotos + ' 张已标记照片，共 ' + tObj.markedDefects + ' 处缺陷';
                mBadge.textContent = '已标 ' + tObj.markedPhotos + '/' + tObj.total + twrDefectTxt;
              } else {
                mBadge.className = 'badge unmarked tower-marked-badge';
                mBadge.style.cssText = 'font-size:9.5px;padding:1px 4px';
                mBadge.textContent = '未标';
                mBadge.title = '';
              }
            }
            // 已看徽章
            var vBadge = twrMeta.querySelector('.tower-viewed-badge');
            if (vBadge) {
              if (tObj.viewedPhotos >= tObj.total && tObj.total > 0) {
                vBadge.className = 'item-viewed-tag tower-viewed-badge';
                vBadge.style.cssText = '';
                vBadge.title = '该杆塔全部 ' + tObj.total + ' 张照片均已查看';
                vBadge.textContent = '已看';
              } else if (tObj.viewedPhotos > 0) {
                vBadge.className = 'item-viewed-tag tower-viewed-badge';
                vBadge.style.cssText = 'font-size:9.5px;padding:1px 4px;font-weight:600';
                vBadge.title = '已查看该杆塔 ' + tObj.viewedPhotos + '/' + tObj.total + ' 张照片';
                vBadge.textContent = '已看 ' + tObj.viewedPhotos + '/' + tObj.total;
              } else {
                vBadge.className = 'tower-viewed-badge';
                vBadge.style.cssText = 'color:var(--muted);font-size:9.5px';
                vBadge.textContent = '未看';
              }
            }
          }
        }
      }

      // 局部同步更新对应线路的 DOM 徽章
      var lineEl = pathTree.querySelector('.prefix-group[data-prefix="' + pKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
      if (lineEl) {
        var lineMeta = lineEl.querySelector('.prefix-meta');
        if (lineMeta) {
          var lmBadge = lineMeta.querySelector('.line-marked-badge');
          if (lmBadge) {
            if (gObj.markedPhotos > 0) {
              lmBadge.className = 'badge marked line-marked-badge';
              lmBadge.style.cssText = 'font-size:10px;padding:1px 5px;font-weight:600';
              var lineDefectTxt = (gObj.markedDefects > gObj.markedPhotos) ? (' (' + gObj.markedDefects + '处)') : '';
              lmBadge.title = '该线路包含 ' + gObj.markedPhotos + ' 张已标记照片，共 ' + gObj.markedDefects + ' 处缺陷';
              lmBadge.textContent = '已标 ' + gObj.markedPhotos + '/' + gObj.total + lineDefectTxt;
            } else {
              lmBadge.className = 'badge unmarked line-marked-badge';
              lmBadge.style.cssText = 'font-size:10px;padding:1px 5px';
              lmBadge.textContent = '未标';
              lmBadge.title = '';
            }
          }
          var lvBadge = lineMeta.querySelector('.line-viewed-badge');
          if (lvBadge) {
            if (lineFullyViewedTowers >= lineTowerCount && lineTowerCount > 0) {
              lvBadge.className = 'badge viewed line-viewed-badge';
              lvBadge.textContent = '已看 ' + lineTowerCount + '/' + lineTowerCount + '基';
            } else if (lineStartedTowers > 0) {
              lvBadge.className = 'badge viewed line-viewed-badge';
              lvBadge.textContent = '已看 ' + lineStartedTowers + '/' + lineTowerCount + '基';
            } else {
              lvBadge.className = 'badge unmarked line-viewed-badge';
              lvBadge.textContent = '未看 0/' + lineTowerCount + '基';
            }
          }
        }
      }
    }

    var totalLines = groupOrder.length;

    // 保存统计状态，以便切图时进行 0.005ms 级增量精准更新，免全树扫描
    state.treeStats = {
      totalPhotos: totalPhotos,
      totalViewedPhotos: totalViewedPhotos,
      totalMarkedPhotos: totalMarkedPhotos,
      totalDefects: totalDefects,
      totalLines: totalLines,
      totalTowers: totalTowers,
      totalFullyViewedTowers: totalFullyViewedTowers,
      totalStartedTowers: totalStartedTowers,
      towersMap: fastTowersMap
    };

    // 顶部统计栏
    var viewedTowerStr = totalFullyViewedTowers + '/' + totalTowers;
    if (totalStartedTowers > totalFullyViewedTowers) {
      viewedTowerStr += ' (' + totalStartedTowers + '基已查)';
    }
    var defectSumTxt = (totalDefects > totalMarkedPhotos) ? (' (' + totalDefects + '处缺陷)') : '';
    if (dirSummaryText) {
      dirSummaryText.innerHTML = totalLines + ' 线路 · <span style="color:var(--accent);font-weight:600">已标 ' + totalMarkedPhotos + '/' + totalPhotos + defectSumTxt + '</span> · <span style="color:var(--ok);font-weight:600">已看 ' + viewedTowerStr + ' 杆塔</span>';
      dirSummaryText.title = '共 ' + totalLines + ' 条线路、' + totalTowers + ' 基杆塔、' + totalPhotos + ' 张照片；已标记 ' + totalMarkedPhotos + ' 张照片 (共 ' + totalDefects + ' 处缺陷输出)，已完整查看 ' + totalFullyViewedTowers + ' 基杆塔，累计查勘 ' + totalStartedTowers + ' 基杆塔';
    }

    // 筛选按钮文字
    if (btnFilterAll) btnFilterAll.textContent = '全部 (' + totalPhotos + ')';
    if (btnFilterMarked) btnFilterMarked.textContent = '已标记 (' + totalMarkedPhotos + ')';
    if (btnFilterUnmarked) btnFilterUnmarked.textContent = '未标记 (' + (totalPhotos - totalMarkedPhotos) + ')';
    if (btnFilterUnviewed) btnFilterUnviewed.textContent = '未看 (' + (totalPhotos - totalViewedPhotos) + ')';
  }

  function updateSingleTowerViewedBadge(fullTwrKey, tObj) {
    if (!tObj || !pathTree) return;
    var twrEl = pathTree.querySelector('.tower-group[data-tower-key="' + fullTwrKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
    if (!twrEl) return;
    var vBadge = twrEl.querySelector('.tower-viewed-badge');
    if (vBadge) {
      if (tObj.viewedPhotos >= tObj.total && tObj.total > 0) {
        vBadge.className = 'item-viewed-tag tower-viewed-badge';
        vBadge.style.cssText = '';
        vBadge.title = '该杆塔全部 ' + tObj.total + ' 张照片均已查看';
        vBadge.textContent = '已看';
      } else if (tObj.viewedPhotos > 0) {
        vBadge.className = 'item-viewed-tag tower-viewed-badge';
        vBadge.style.cssText = 'font-size:9.5px;padding:1px 4px;font-weight:600';
        vBadge.title = '已查看该杆塔 ' + tObj.viewedPhotos + '/' + tObj.total + ' 张照片';
        vBadge.textContent = '已看 ' + tObj.viewedPhotos + '/' + tObj.total;
      } else {
        vBadge.className = 'tower-viewed-badge';
        vBadge.style.cssText = 'color:var(--muted);font-size:9.5px';
        vBadge.textContent = '未看';
      }
    }
  }

  function updateTopSummaryText() {
    if (!state.treeStats || !dirSummaryText) return;
    var s = state.treeStats;
    var viewedTowerStr = s.totalFullyViewedTowers + '/' + s.totalTowers;
    if (s.totalStartedTowers > s.totalFullyViewedTowers) {
      viewedTowerStr += ' (' + s.totalStartedTowers + '基已查)';
    }
    var defectSumTxt = (s.totalDefects > s.totalMarkedPhotos) ? (' (' + s.totalDefects + '处缺陷)') : '';
    dirSummaryText.innerHTML = s.totalLines + ' 线路 · <span style="color:var(--accent);font-weight:600">已标 ' + s.totalMarkedPhotos + '/' + s.totalPhotos + defectSumTxt + '</span> · <span style="color:var(--ok);font-weight:600">已看 ' + viewedTowerStr + ' 杆塔</span>';
    if (btnFilterUnviewed) btnFilterUnviewed.textContent = '未看 (' + (s.totalPhotos - s.totalViewedPhotos) + ')';
  }

  function updateStatsOnPhotoViewed(curFileObj, isNewView) {
    if (!curFileObj || !state.treeStats || !isNewView) return;
    var info = curFileObj._parsedInfo || (curFileObj._parsedInfo = parseFilePrefixAndLocation(curFileObj.name, curFileObj.relPath));
    var fullTwrKey = info ? (info.prefix + ':::' + info.tower) : '';
    var s = state.treeStats;
    s.totalViewedPhotos++;
    var tObj = s.towersMap ? s.towersMap.get(fullTwrKey) : null;
    if (tObj) {
      tObj.viewedPhotos++;
      if (tObj.viewedPhotos === 1) s.totalStartedTowers++;
      if (tObj.viewedPhotos >= tObj.total && tObj.total > 0) s.totalFullyViewedTowers++;
      updateSingleTowerViewedBadge(fullTwrKey, tObj);
    }
    updateTopSummaryText();
  }

  /* ---- 左侧全量按线路/支线前缀分类、子文件夹杆塔统计、输出标记筛选与展开/折叠 ---- */

  function renderPathTree(shouldScrollToActive) {
    sanitizeViewedPhotos();
    if ((!state.files || state.files.length === 0) && (!state.discoveredDirs || state.discoveredDirs.length === 0)) {
      pathTree.innerHTML = '<div style="color:var(--muted);font-size:11.5px;padding:12px 0;text-align:center">未打开文件夹</div>';
      dirSummaryText.innerHTML = '';
      return;
    }

    var groupMap = new Map();
    var groupOrder = [];
    var totalPhotos = (state.files && state.files.length) || 0;
    var totalViewedPhotos = 0;
    var totalMarkedPhotos = 0;
    var totalDefects = 0;

    var curF = curFile();
    var curParsed = curF ? parseFilePrefixAndLocation(curF.name, curF.relPath) : null;
    var curPrefix = curParsed ? curParsed.prefix : '';
    var curTower = curParsed ? curParsed.tower : '';
    var curTowerKey = curParsed ? (curPrefix + ':::' + curTower) : '';

    var allScannedDirs = state.discoveredDirs || [];
    var leafDirs = allScannedDirs.filter(function (d) {
      return !allScannedDirs.some(function (other) { return other !== d && other.startsWith(d); });
    });

    for (var di = 0; di < leafDirs.length; di++) {
      var dInfo = parseDirToLineAndTower(leafDirs[di]);
      if (!dInfo.tower || dInfo.tower === '默认杆塔') continue;
      var dPfx = dInfo.prefix;
      var dTwr = dInfo.tower;

      if (!groupMap.has(dPfx)) {
        groupMap.set(dPfx, {
          prefix: dPfx,
          startIndex: -1,
          towersMap: new Map(),
          towerOrder: [],
          total: 0,
          viewedPhotos: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedTowers: 0
        });
        groupOrder.push(dPfx);
      }

      var dGrp = groupMap.get(dPfx);
      if (!dGrp.towersMap.has(dTwr)) {
        dGrp.towersMap.set(dTwr, {
          tower: dTwr,
          towerNum: dInfo.towerNum,
          prefix: dPfx,
          startIndex: -1,
          items: [],
          total: 0,
          viewedPhotos: 0,
          markedPhotos: 0,
          markedDefects: 0
        });
        dGrp.towerOrder.push(dTwr);
      }
    }

    for (var i = 0; i < totalPhotos; i++) {
      var f = state.files[i];
      var info = parseFilePrefixAndLocation(f.name, f.relPath);
      var pfx = info.prefix;
      var twr = info.tower;
      var isViewed = isFileViewed(f);
      if (isViewed) totalViewedPhotos++;

      var fKey = fileKey(f);
      var isPhotoMarked = !!(state.markedFiles && state.markedFiles.has(fKey));
      var count = (state.markedCounts && state.markedCounts.get(fKey)) || (isPhotoMarked ? 1 : 0);
      if (isPhotoMarked) {
        totalMarkedPhotos++;
        totalDefects += count;
      }

      if (!groupMap.has(pfx)) {
        groupMap.set(pfx, {
          prefix: pfx,
          startIndex: i,
          towersMap: new Map(),
          towerOrder: [],
          total: 0,
          viewedPhotos: 0,
          markedPhotos: 0,
          markedDefects: 0,
          viewedTowers: 0
        });
        groupOrder.push(pfx);
      }

      var grp = groupMap.get(pfx);
      if (grp.startIndex === -1) grp.startIndex = i;
      grp.total++;
      if (isViewed) grp.viewedPhotos++;
      if (isPhotoMarked) {
        grp.markedPhotos++;
        grp.markedDefects += count;
      }

      if (!grp.towersMap.has(twr)) {
        grp.towersMap.set(twr, {
          tower: twr,
          towerNum: info.towerNum,
          prefix: pfx,
          startIndex: i,
          items: [],
          total: 0,
          viewedPhotos: 0,
          markedPhotos: 0,
          markedDefects: 0
        });
        grp.towerOrder.push(twr);
      }

      var twrData = grp.towersMap.get(twr);
      if (twrData.startIndex === -1) twrData.startIndex = i;
      twrData.total++;
      if (isViewed) twrData.viewedPhotos++;
      if (isPhotoMarked) {
        twrData.markedPhotos++;
        twrData.markedDefects += count;
      }

      twrData.items.push({
        index: i,
        name: f.name,
        relPath: f.relPath,
        key: fKey,
        tower: twr,
        loc: info.loc,
        isViewed: isViewed,
        isPhotoMarked: isPhotoMarked,
        isCurrent: (i === state.index)
      });
    }

    groupOrder.sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' });
    });

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var gObj = groupMap.get(groupOrder[gi]);
      gObj.towerOrder.sort(function (aKey, bKey) {
        var aObj = gObj.towersMap.get(aKey);
        var bObj = gObj.towersMap.get(bKey);
        var aNum = aObj ? aObj.towerNum : 999999;
        var bNum = bObj ? bObj.towerNum : 999999;
        if (aNum !== bNum) return aNum - bNum;
        return aKey.localeCompare(bKey, 'zh-CN', { numeric: true, sensitivity: 'base' });
      });
    }

    // 默认全部收起，仅自动展开当前浏览所在的线路与杆塔
    for (var _gi = 0; _gi < groupOrder.length; _gi++) {
      var _pKey = groupOrder[_gi];
      if (_pKey === curPrefix) { collapsedGroups.delete(_pKey); } else { collapsedGroups.add(_pKey); }
      var _gObj = groupMap.get(_pKey);
      for (var _ti = 0; _ti < _gObj.towerOrder.length; _ti++) {
        var _tKey = _gObj.towerOrder[_ti];
        var _fullKey = _pKey + ':::' + _tKey;
        if (_fullKey === curTowerKey) { collapsedTowers.delete(_fullKey); } else { collapsedTowers.add(_fullKey); }
      }
    }
    lastActiveTowerKey = curTowerKey;
    lastActivePrefix = curPrefix;

    // 计算全局与线路级别的已看杆塔数（统计全看完与已查看杆塔）
    var totalTowers = 0;
    var totalFullyViewedTowers = 0;
    var totalStartedTowers = 0;
    var fastTowersMap = new Map();

    for (var gi = 0; gi < groupOrder.length; gi++) {
      var pKey = groupOrder[gi];
      var gObj = groupMap.get(pKey);
      var lineFullyViewedTowers = 0;
      var lineStartedTowers = 0;
      for (var ti = 0; ti < gObj.towerOrder.length; ti++) {
        var tKey = gObj.towerOrder[ti];
        var tObj = gObj.towersMap.get(tKey);
        totalTowers++;
        var fullKey = pKey + ':::' + tKey;
        fastTowersMap.set(fullKey, tObj);
        if (tObj.viewedPhotos >= tObj.total && tObj.total > 0) {
          lineFullyViewedTowers++;
          totalFullyViewedTowers++;
        }
        if (tObj.viewedPhotos > 0) {
          lineStartedTowers++;
          totalStartedTowers++;
        }
      }
      gObj.viewedTowers = lineFullyViewedTowers;
      gObj.startedTowers = lineStartedTowers;
    }

    var totalLines = groupOrder.length;

    // 同步更新全局 state.treeStats，确保全系统单源真实数据
    state.treeStats = {
      totalPhotos: totalPhotos,
      totalViewedPhotos: totalViewedPhotos,
      totalMarkedPhotos: totalMarkedPhotos,
      totalDefects: totalDefects,
      totalLines: totalLines,
      totalTowers: totalTowers,
      totalFullyViewedTowers: totalFullyViewedTowers,
      totalStartedTowers: totalStartedTowers,
      towersMap: fastTowersMap
    };

    // 统计栏：已看统计杆塔数而不是图片数，已标统计独立图片数与缺陷总数
    var viewedTowerStr = totalFullyViewedTowers + '/' + totalTowers;
    if (totalStartedTowers > totalFullyViewedTowers) {
      viewedTowerStr += ' (' + totalStartedTowers + '基已查)';
    }
    var defectSumTxt = (totalDefects > totalMarkedPhotos) ? (' (' + totalDefects + '处缺陷)') : '';
    dirSummaryText.innerHTML = totalLines + ' 线路 · <span style="color:var(--accent);font-weight:600">已标 ' + totalMarkedPhotos + '/' + totalPhotos + defectSumTxt + '</span> · <span style="color:var(--ok);font-weight:600">已看 ' + viewedTowerStr + ' 杆塔</span>';
    dirSummaryText.title = '共 ' + totalLines + ' 条线路、' + totalTowers + ' 基杆塔、' + totalPhotos + ' 张照片；已标记 ' + totalMarkedPhotos + ' 张照片 (共 ' + totalDefects + ' 处缺陷输出)，已完整查看 ' + totalFullyViewedTowers + ' 基杆塔，累计查勘 ' + totalStartedTowers + ' 基杆塔';

    // 筛选按钮文字
    btnFilterAll.textContent = '全部 (' + totalPhotos + ')';
    btnFilterMarked.textContent = '已标记 (' + totalMarkedPhotos + ')';
    btnFilterUnmarked.textContent = '未标记 (' + (totalPhotos - totalMarkedPhotos) + ')';
    btnFilterUnviewed.textContent = '未看 (' + (totalPhotos - totalViewedPhotos) + ')';

    var html = '';
    var renderedLines = 0;

    for (var i = 0; i < groupOrder.length; i++) {
      var pfxKey = groupOrder[i];
      var gData = groupMap.get(pfxKey);
      var isCurrentGroup = (pfxKey === curPrefix);
      var isCollapsed = collapsedGroups.has(pfxKey);
      var lineTowerCount = gData.towerOrder.length;

      // 线路过滤检查
      if (filterMode === 'marked' && gData.markedPhotos === 0) continue;
      if (filterMode === 'unmarked' && gData.markedPhotos === gData.total && gData.total > 0) continue;
      if (filterMode === 'unviewed' && gData.viewedPhotos === gData.total && gData.total > 0) continue;

      // 线路标头徽章：红色是已标，绿色是已看
      var lineMarkedBadge = '';
      if (gData.markedPhotos > 0) {
        var lineDefectTxt = (gData.markedDefects > gData.markedPhotos) ? (' (' + gData.markedDefects + '处)') : '';
        lineMarkedBadge = '<span class="badge marked line-marked-badge" style="font-size:10px;padding:1px 5px;font-weight:600" title="该线路包含 ' + gData.markedPhotos + ' 张已标记照片，共 ' + gData.markedDefects + ' 处缺陷">已标 ' + gData.markedPhotos + '/' + gData.total + lineDefectTxt + '</span>';
      } else {
        lineMarkedBadge = '<span class="badge unmarked line-marked-badge" style="font-size:10px;padding:1px 5px">未标</span>';
      }

      var towerHtml = '';
      var renderedTowersInLine = 0;

      for (var tj = 0; tj < gData.towerOrder.length; tj++) {
        var twrKey = gData.towerOrder[tj];
        var tData = gData.towersMap.get(twrKey);
        var fullTwrKey = pfxKey + ':::' + twrKey;
        var isCurrentTower = (fullTwrKey === curTowerKey);
        var isTowerCollapsed = collapsedTowers.has(fullTwrKey);

        // 杆塔过滤检查
        if (filterMode === 'marked' && tData.markedPhotos === 0) continue;
        if (filterMode === 'unmarked' && tData.markedPhotos === tData.total && tData.total > 0) continue;
        if (filterMode === 'unviewed' && tData.viewedPhotos === tData.total && tData.total > 0) continue;

        // 各杆塔已标记数统计（红色）
        var towerMarkedBadge = '';
        if (tData.markedPhotos > 0) {
          var twrDefectTxt = (tData.markedDefects > tData.markedPhotos) ? (' (' + tData.markedDefects + '处)') : '';
          towerMarkedBadge = '<span class="badge marked tower-marked-badge" style="font-size:9.5px;padding:1px 4px;font-weight:600" title="该杆塔包含 ' + tData.markedPhotos + ' 张已标记照片，共 ' + tData.markedDefects + ' 处缺陷">已标 ' + tData.markedPhotos + '/' + tData.total + twrDefectTxt + '</span>';
        } else {
          towerMarkedBadge = '<span class="badge unmarked tower-marked-badge" style="font-size:9.5px;padding:1px 4px">未标</span>';
        }

        // 各杆塔已看状态统计（绿色）
        var towerViewedBadge = '';
        if (tData.viewedPhotos >= tData.total && tData.total > 0) {
          towerViewedBadge = '<span class="item-viewed-tag tower-viewed-badge" title="该杆塔全部 ' + tData.total + ' 张照片均已查看">已看</span>';
        } else if (tData.viewedPhotos > 0) {
          towerViewedBadge = '<span class="item-viewed-tag tower-viewed-badge" style="font-size:9.5px;padding:1px 4px;font-weight:600" title="已查看该杆塔 ' + tData.viewedPhotos + '/' + tData.total + ' 张照片">已看 ' + tData.viewedPhotos + '/' + tData.total + '</span>';
        } else {
          towerViewedBadge = '<span class="tower-viewed-badge" style="color:var(--muted);font-size:9.5px">未看</span>';
        }

        var itemsHtml = '';
        for (var k = 0; k < tData.items.length; k++) {
          var item = tData.items[k];

          if (filterMode === 'marked' && !item.isPhotoMarked) continue;
          if (filterMode === 'unmarked' && item.isPhotoMarked) continue;
          if (filterMode === 'unviewed' && item.isViewed) continue;

          var locIcon = item.isCurrent ? '<span class="loc-current-arrow" style="color:var(--accent);font-size:10px;margin-right:3px">▶</span>' : '';
          var itKey = item.key || item.name;
          var count = (state.markedCounts && state.markedCounts.get(itKey)) || 1;
          var markedBadge = item.isPhotoMarked ? ('<span class="item-marked-tag" title="已输出保存为缺陷图片' + (count > 1 ? ('（共 ' + count + ' 处缺陷）') : '') + '">' + markBadgeText(itKey) + '</span>') : '';
          var deleteMarkedBtn = item.isPhotoMarked ? ('<button class="btn-cancel-marked-mini" data-idx="' + item.index + '" data-raw-name="' + esc(itKey) + '" title="取消已标：删除输出目录中该缺陷图片并还原原图" type="button"><svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" style="display:block"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>') : '';
          var viewedBadge = item.isViewed ? '<span class="item-viewed-tag" title="已浏览查看此照片">已看</span>' : '';
          var statusBadgesHtml = (markedBadge || viewedBadge || deleteMarkedBtn) ? ('<div class="item-status-badges">' + markedBadge + viewedBadge + deleteMarkedBtn + '</div>') : '';

          var defectTag = item.isPhotoMarked ? getDefectTagsForFile(itKey) : '';
          var displayLoc = esc(item.loc);
          if (defectTag) {
            displayLoc += '<span class="item-defect-tag" style="color:var(--accent);font-weight:600">' + esc(defectTag) + '</span>';
          }

          itemsHtml += '<div class="loc-item' + (item.isCurrent ? ' current' : '') + '" data-idx="' + item.index + '" title="' + esc(item.name) + (defectTag ? (' · 缺陷: ' + esc(defectTag)) : '') + ' (杆塔: ' + esc(item.tower) + (item.isPhotoMarked ? ' · 已标记缺陷' : '') + (item.isViewed ? ' · 已看' : '') + ' · 双击重命名此图片)">';
          itemsHtml += '  <span class="loc-name">' + locIcon + '<span class="photo-name-text" data-idx="' + item.index + '" data-loc="' + esc(item.loc) + '" data-raw-name="' + esc(item.name) + '" title="双击重命名此图片">' + displayLoc + '</span></span>';
          itemsHtml += '  ' + statusBadgesHtml;
          itemsHtml += '</div>';
        }

        towerHtml += '<div class="tower-group' + (isCurrentTower ? ' current-tower' : '') + (isTowerCollapsed ? ' collapsed' : '') + '" data-tower-key="' + esc(fullTwrKey) + '">';
        towerHtml += '  <div class="tower-header" data-tower-key="' + esc(fullTwrKey) + '" data-first-idx="' + tData.startIndex + '" title="点击展开/折叠（共 ' + tData.total + ' 张，已标记 ' + tData.markedPhotos + ' 张）">';
        towerHtml += '    <span class="tower-title"><span class="toggle-arrow-mini">▼</span><span class="folder-name-text folder-tower-name" data-folder-type="tower" data-prefix="' + esc(pfxKey) + '" data-tower-name="' + esc(twrKey) + '" title="双击重命名此杆塔文件夹">【' + esc(twrKey) + '】</span></span>';
        towerHtml += '    <div class="tower-meta">';
        towerHtml += '      ' + towerMarkedBadge;
        towerHtml += '      <span>' + tData.total + '张</span>';
        towerHtml += '      ' + towerViewedBadge;
        towerHtml += '    </div>';
        towerHtml += '  </div>';
        towerHtml += '  <div class="tower-items">' + itemsHtml + '</div>';
        towerHtml += '</div>';

        renderedTowersInLine++;
      }

      if (renderedTowersInLine === 0) continue;

      var lineViewedBadge = '';
      if (gData.viewedTowers >= lineTowerCount && lineTowerCount > 0) {
        lineViewedBadge = '<span class="badge viewed line-viewed-badge" style="font-size:10px;padding:1px 5px;font-weight:600" title="该线路全部 ' + lineTowerCount + ' 基杆塔均已看完">已看 ' + lineTowerCount + '/' + lineTowerCount + '基</span>';
      } else if (gData.startedTowers > 0) {
        lineViewedBadge = '<span class="badge viewed line-viewed-badge" style="font-size:10px;padding:1px 5px;font-weight:600" title="已查 ' + gData.startedTowers + '/' + lineTowerCount + ' 基杆塔（其中 ' + gData.viewedTowers + ' 基全看完）">已看 ' + gData.startedTowers + '/' + lineTowerCount + '基</span>';
      } else {
        lineViewedBadge = '<span class="badge unmarked line-viewed-badge" style="font-size:10px;padding:1px 5px" title="该线路尚未查看">未看 0/' + lineTowerCount + '基</span>';
      }

      html += '<div class="prefix-group' + (isCurrentGroup ? ' current-group' : '') + (isCollapsed ? ' collapsed' : '') + '" data-prefix="' + esc(pfxKey) + '">';
      html += '  <div class="prefix-header" data-prefix="' + esc(pfxKey) + '" data-first-idx="' + gData.startIndex + '" title="点击展开/折叠线路（共 ' + lineTowerCount + ' 基杆塔，已标记 ' + gData.markedPhotos + ' 张，已看 ' + gData.viewedTowers + ' 基）">';
      html += '    <span class="prefix-title"><span class="toggle-arrow">▼</span><span class="folder-name-text folder-line-name" data-folder-type="line" data-line-name="' + esc(pfxKey) + '" title="双击重命名此线路文件夹">' + esc(pfxKey) + '</span></span>';
      html += '    <div class="prefix-meta">';
      html += '      ' + lineMarkedBadge;
      html += '      ' + lineViewedBadge;
      html += '    </div>';
      html += '  </div>';
      html += '  <div class="prefix-items">' + towerHtml + '</div>';
      html += '</div>';

      renderedLines++;
    }

    if (renderedLines === 0) {
      var emptyMsg = filterMode === 'marked' ? '当前输出目录下暂未检测到已标记的缺陷图片' :
                     (filterMode === 'unmarked' ? '所有照片均已标记' :
                     (filterMode === 'unviewed' ? '所有照片均已浏览查看' : '暂无符合条件的照片'));
      html = '<div style="color:var(--muted);font-size:11.5px;padding:24px 0;text-align:center">' + emptyMsg + '</div>';
    }

    pathTree.innerHTML = html;
    lastActiveTowerEl = pathTree.querySelector('.tower-group.current-tower');
    lastActivePrefixEl = pathTree.querySelector('.prefix-group.current-group');
    lastActiveLocItemEl = pathTree.querySelector('.loc-item.current');

    if (shouldScrollToActive) {
      var curEl = lastActiveLocItemEl;
      if (curEl) {
        requestAnimationFrame(function () {
          curEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
    }
  }

  var loadingDebounceTimer = null;
  var refreshTreeStatsTimer = null;
  function scheduleRefreshTreeStats() {
    if (refreshTreeStatsTimer) return;
    refreshTreeStatsTimer = setTimeout(function () {
      refreshTreeStatsTimer = null;
      refreshTreeStats();
    }, 120);
  }

  function updatePathTreeSelection(newIdx, shouldScroll) {
    if (!pathTree || !pathTree.firstElementChild) {
      renderPathTree(shouldScroll);
      return;
    }
    var targetEl = pathTree.querySelector('.loc-item[data-idx="' + newIdx + '"]');
    if (!targetEl) {
      // 目标元素确实不在 DOM 中（比如由于筛选被隐藏），执行全量渲染
      renderPathTree(shouldScroll);
      return;
    }

    var curFileObj = state.files && state.files[newIdx];
    var curParsed = curFileObj ? parseFilePrefixAndLocation(curFileObj.name, curFileObj.relPath) : null;
    var targetPrefix = curParsed ? curParsed.prefix : '';
    var targetTowerKey = curParsed ? (curParsed.prefix + ':::' + curParsed.tower) : '';

    var curTowerGroup = targetEl.closest('.tower-group');
    var curPrefixGroup = targetEl.closest('.prefix-group');

    // 看到对应的塔基时自动展开，离开（看过后）自动收起
    if (targetTowerKey && targetTowerKey !== lastActiveTowerKey) {
      if (lastActiveTowerEl && lastActiveTowerEl !== curTowerGroup) {
        lastActiveTowerEl.classList.add('collapsed');
        lastActiveTowerEl.classList.remove('current-tower');
        if (lastActiveTowerEl.dataset.towerKey) collapsedTowers.add(lastActiveTowerEl.dataset.towerKey);
      }
      if (curTowerGroup) {
        curTowerGroup.classList.remove('collapsed');
        curTowerGroup.classList.add('current-tower');
        if (curTowerGroup.dataset.towerKey) collapsedTowers.delete(curTowerGroup.dataset.towerKey);
      }
      lastActiveTowerKey = targetTowerKey;
      lastActiveTowerEl = curTowerGroup;
    } else if (curTowerGroup) {
      if (curTowerGroup.classList.contains('collapsed')) {
        curTowerGroup.classList.remove('collapsed');
        if (curTowerGroup.dataset.towerKey) collapsedTowers.delete(curTowerGroup.dataset.towerKey);
      }
      if (!curTowerGroup.classList.contains('current-tower')) {
        curTowerGroup.classList.add('current-tower');
      }
      lastActiveTowerEl = curTowerGroup;
    }

    // 所在线路同步联动：跨入新线路时展开，离开后收起其他线路
    if (targetPrefix && targetPrefix !== lastActivePrefix) {
      if (lastActivePrefixEl && lastActivePrefixEl !== curPrefixGroup) {
        lastActivePrefixEl.classList.add('collapsed');
        lastActivePrefixEl.classList.remove('current-group');
        if (lastActivePrefixEl.dataset.prefix) collapsedGroups.add(lastActivePrefixEl.dataset.prefix);
      }
      if (curPrefixGroup) {
        curPrefixGroup.classList.remove('collapsed');
        curPrefixGroup.classList.add('current-group');
        if (curPrefixGroup.dataset.prefix) collapsedGroups.delete(curPrefixGroup.dataset.prefix);
      }
      lastActivePrefix = targetPrefix;
      lastActivePrefixEl = curPrefixGroup;
    } else if (curPrefixGroup) {
      if (curPrefixGroup.classList.contains('collapsed')) {
        curPrefixGroup.classList.remove('collapsed');
        if (curPrefixGroup.dataset.prefix) collapsedGroups.delete(curPrefixGroup.dataset.prefix);
      }
      if (!curPrefixGroup.classList.contains('current-group')) {
        curPrefixGroup.classList.add('current-group');
      }
      lastActivePrefixEl = curPrefixGroup;
    }

    // 1. 取消先前的选中高亮与箭头
    var prevEl = lastActiveLocItemEl || pathTree.querySelector('.loc-item.current');
    if (prevEl && prevEl !== targetEl) {
      prevEl.classList.remove('current');
      var oldArrow = prevEl.querySelector('.loc-current-arrow');
      if (oldArrow) oldArrow.remove();
    }
    lastActiveLocItemEl = targetEl;

    // 2. 激活新项的高亮与箭头
    targetEl.classList.add('current');
    var locName = targetEl.querySelector('.loc-name');
    if (locName && !locName.querySelector('.loc-current-arrow')) {
      var arrowSpan = document.createElement('span');
      arrowSpan.className = 'loc-current-arrow';
      arrowSpan.style.cssText = 'color:var(--accent);font-size:10px;margin-right:3px';
      arrowSpan.textContent = '▶';
      locName.insertBefore(arrowSpan, locName.firstChild);
    }

    // 3. 补充新项的“已看”徽章（若尚未显示）
    var badges = targetEl.querySelector('.item-status-badges');
    var isNewView = false;
    if (!badges) {
      badges = document.createElement('div');
      badges.className = 'item-status-badges';
      targetEl.appendChild(badges);
    }
    if (!badges.querySelector('.item-viewed-tag')) {
      isNewView = true;
      var viewedTag = document.createElement('span');
      viewedTag.className = 'item-viewed-tag';
      viewedTag.title = '已浏览查看此照片';
      viewedTag.textContent = '已看';
      badges.appendChild(viewedTag);
      updateStatsOnPhotoViewed(curFileObj, true);
    }

    if (isNewView && filterMode === 'unviewed') {
      targetEl.style.display = 'none';
      return;
    }

    // 4. 滚动定位（直接基于 offsetTop 计算，彻底消除 getBoundingClientRect 强制同步重排）
    if (shouldScroll && targetEl && pathTree) {
      var itemTop = targetEl.offsetTop;
      var itemH = targetEl.offsetHeight || 26;
      var sTop = pathTree.scrollTop;
      var sH = pathTree.clientHeight;
      if (itemTop < sTop + 24) {
        pathTree.scrollTop = Math.max(0, itemTop - 40);
      } else if (itemTop + itemH > sTop + sH - 24) {
        pathTree.scrollTop = itemTop + itemH - sH + 40;
      }
    }
  }

  function setFilterMode(mode) {
    filterMode = mode;
    invalidateFilterList();
    btnFilterAll.classList.toggle('active', mode === 'all');
    btnFilterMarked.classList.toggle('active', mode === 'marked');
    btnFilterUnmarked.classList.toggle('active', mode === 'unmarked');
    btnFilterUnviewed.classList.toggle('active', mode === 'unviewed');

    if (mode === 'marked' && !output.mainHandle) {
      toast('提示：尚未连接输出目录，请先选择保存输出文件夹');
      selectOutputDir();
      return;
    }

    renderPathTree(true);

    if (state.files && state.files.length > 0) {
      if (!isFileMatchingFilter(state.index)) {
        var firstMatch = getNextFilteredIndex(-1, 1);
        if (firstMatch >= 0) {
          switchTo(firstMatch);
        } else {
          updateHud();
        }
      } else {
        updateHud();
      }
    }
  }

  btnFilterAll.addEventListener('click', function () { setFilterMode('all'); });
  btnFilterMarked.addEventListener('click', function () { setFilterMode('marked'); });
  btnFilterUnmarked.addEventListener('click', function () { setFilterMode('unmarked'); });
  btnFilterUnviewed.addEventListener('click', function () { setFilterMode('unviewed'); });

  function toggleGroupCollapse(prefix) {
    if (collapsedGroups.has(prefix)) {
      collapsedGroups.delete(prefix);
    } else {
      collapsedGroups.add(prefix);
    }
    var groupEl = pathTree.querySelector('.prefix-group[data-prefix="' + CSS.escape(prefix) + '"]');
    if (groupEl) {
      groupEl.classList.toggle('collapsed', collapsedGroups.has(prefix));
    }
  }

  function expandAllGroups() {
    collapsedGroups.clear();
    collapsedTowers.clear();
    var groups = pathTree.querySelectorAll('.prefix-group, .tower-group');
    for (var i = 0; i < groups.length; i++) {
      groups[i].classList.remove('collapsed');
    }
  }

  function collapseAllGroups() {
    var groups = pathTree.querySelectorAll('.prefix-group');
    for (var i = 0; i < groups.length; i++) {
      var pfx = groups[i].dataset.prefix;
      if (pfx) collapsedGroups.add(pfx);
      groups[i].classList.add('collapsed');
    }
  }

  /* ================= 文件夹重命名功能（双击重命名，支持磁盘与界面同步更新） ================= */

  async function copyAndRemoveDirectoryContents(srcDir, dstDir) {
    for await (var pair of srcDir.entries()) {
      var name = pair[0], handle = pair[1];
      if (handle.kind === 'file') {
        try {
          if (typeof handle.move === 'function') {
            await handle.move(dstDir);
            continue;
          }
        } catch (e) {}
        var file = await handle.getFile();
        var newFile = await dstDir.getFileHandle(name, { create: true });
        var writable = await newFile.createWritable();
        await writable.write(file);
        await writable.close();
        try { await srcDir.removeEntry(name); } catch (e) {}
      } else if (handle.kind === 'directory') {
        var subDst = await dstDir.getDirectoryHandle(name, { create: true });
        await copyAndRemoveDirectoryContents(handle, subDst);
        try { await srcDir.removeEntry(name, { recursive: true }); } catch (e) {}
      }
    }
  }

  async function renameDirectoryOnDisk(dirInfo, oldName, newName) {
    if (!dirInfo || !dirInfo.handle || !dirInfo.parentHandle) {
      return { success: false, reason: 'no_parent' };
    }
    // 1. 首选尝试使用现代 Chromium 的 handle.move(newName)
    try {
      if (typeof dirInfo.handle.move === 'function') {
        await dirInfo.handle.move(newName);
        return { success: true, method: 'move' };
      }
    } catch (err) {
      console.warn('dirInfo.handle.move() 未生效，启用创建迁移备用方案:', err);
    }

    // 2. 备用方案：在 parentHandle 下创建新文件夹，迁移所有文件，删除旧文件夹
    try {
      var newDirHandle = await dirInfo.parentHandle.getDirectoryHandle(newName, { create: true });
      await copyAndRemoveDirectoryContents(dirInfo.handle, newDirHandle);
      await dirInfo.parentHandle.removeEntry(oldName, { recursive: true });
      return { success: true, method: 'copy_remove', newHandle: newDirHandle };
    } catch (err) {
      console.error('磁盘文件夹重命名失败:', err);
      return { success: false, reason: err && err.message || String(err) };
    }
  }

  async function performRenameLineFolder(oldLineName, newLineName) {
    if (oldLineName === newLineName) return;

    var diskPathKey = oldLineName + '/';
    var dirInfo = dirRegistry.get(diskPathKey);
    var diskResult = { success: false };

    if (dirInfo && dirInfo.parentHandle) {
      diskResult = await renameDirectoryOnDisk(dirInfo, oldLineName, newLineName);
    } else if (savedInputName === oldLineName || (lastInputHandle && lastInputHandle.name === oldLineName)) {
      savedInputName = newLineName;
      try { localStorage.setItem(KEY_INPUT_NAME, newLineName); } catch (e) {}
      diskResult = { success: true, method: 'root_display_only' };
    }

    // 同步更新所有文件的 relPath
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      var rel = f.relPath || f.name;
      if (rel.startsWith(oldLineName + '/')) {
        f.relPath = newLineName + '/' + rel.slice(oldLineName.length + 1);
      }
    }
    manifestRewriteRelPathPrefix(oldLineName, newLineName);
    buildInputNameIndex();

    // 同步更新 dirRegistry 键名
    var newDirRegistry = new Map();
    dirRegistry.forEach(function (val, key) {
      if (key.startsWith(oldLineName + '/')) {
        var newKey = newLineName + '/' + key.slice(oldLineName.length + 1);
        if (key === oldLineName + '/') {
          val.name = newLineName;
          if (diskResult.newHandle) val.handle = diskResult.newHandle;
        }
        newDirRegistry.set(newKey, val);
      } else {
        newDirRegistry.set(key, val);
      }
    });
    dirRegistry = newDirRegistry;

    // 同步更新折叠集合
    if (collapsedGroups.has(oldLineName)) {
      collapsedGroups.delete(oldLineName);
      collapsedGroups.add(newLineName);
    }

    updateFolderButtonText();
    renderPathTree(true);

    if (diskResult.success) {
      if (diskResult.method === 'root_display_only') {
        toast('✓ 已更新线路显示名称为: ' + newLineName + '（根文件夹请在系统资源管理器修改）');
      } else {
        toast('✓ 线路文件夹已成功重命名为: ' + newLineName);
      }
    } else {
      toast('✓ 线路已重命名为: ' + newLineName + '（磁盘权限受限未修改本地目录）');
    }
  }

  async function performRenameTowerFolder(lineName, oldTowerName, newTowerName) {
    if (oldTowerName === newTowerName) return;

    var sampleOldDir = '';
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      var info = parseFilePrefixAndLocation(f.name, f.relPath);
      if (info.prefix === lineName && info.tower === oldTowerName) {
        sampleOldDir = dirOf(f.relPath || f.name);
        break;
      }
    }

    var diskResult = { success: false };
    var oldDirPathKey = sampleOldDir ? (sampleOldDir + '/') : '';
    var parentDir = sampleOldDir ? dirOf(sampleOldDir) : '';
    var newDirPathKey = (parentDir ? (parentDir + '/') : '') + newTowerName + '/';

    if (oldDirPathKey && dirRegistry.has(oldDirPathKey)) {
      var dirInfo = dirRegistry.get(oldDirPathKey);
      diskResult = await renameDirectoryOnDisk(dirInfo, oldTowerName, newTowerName);
    }

    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      var info = parseFilePrefixAndLocation(f.name, f.relPath);
      if (info.prefix === lineName && info.tower === oldTowerName) {
        var fDir = dirOf(f.relPath || f.name);
        var fParent = dirOf(fDir);
        f.relPath = (fParent ? (fParent + '/') : '') + newTowerName + '/' + f.name;
      }
    }
    if (sampleOldDir) {
      manifestRewriteRelPathPrefix(sampleOldDir, (parentDir ? (parentDir + '/') : '') + newTowerName);
    }
    buildInputNameIndex();

    if (oldDirPathKey && dirRegistry.has(oldDirPathKey)) {
      var dirInfo = dirRegistry.get(oldDirPathKey);
      dirRegistry.delete(oldDirPathKey);
      dirInfo.name = newTowerName;
      if (diskResult.newHandle) dirInfo.handle = diskResult.newHandle;
      dirRegistry.set(newDirPathKey, dirInfo);
    }

    var oldTKey = lineName + ':::' + oldTowerName;
    var newTKey = lineName + ':::' + newTowerName;
    if (collapsedTowers.has(oldTKey)) {
      collapsedTowers.delete(oldTKey);
      collapsedTowers.add(newTKey);
    }

    renderPathTree(true);

    if (diskResult.success) {
      toast('✓ 杆塔文件夹已成功重命名为: ' + newTowerName);
    } else {
      toast('✓ 杆塔已重命名为: ' + newTowerName);
    }
  }

  function startRenameFolder(nameEl) {
    if (!nameEl) return;
    if (document.querySelector('.rename-folder-input')) return;

    var folderType = nameEl.dataset.folderType; // 'line' | 'tower'
    var currentName = (folderType === 'line') ? nameEl.dataset.lineName : nameEl.dataset.towerName;
    if (!currentName) return;

    var prefix = nameEl.dataset.prefix || '';

    // 创建内联编辑输入框
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-folder-input';
    input.value = currentName;
    input.dataset.oldName = currentName;
    input.dataset.folderType = folderType;
    input.dataset.prefix = prefix;
    input.title = '回车保存，Esc取消';

    input.addEventListener('click', function (ev) { ev.stopPropagation(); });
    input.addEventListener('dblclick', function (ev) { ev.stopPropagation(); });

    var committed = false;

    async function commitRename() {
      if (committed) return;
      committed = true;
      var newName = input.value.trim().replace(/^【|】$/g, '').trim();
      input.remove();
      nameEl.style.display = '';

      if (!newName || newName === currentName) return;

      var invalidPattern = new RegExp('[/\\\\:*?\"<>|]');
      if (invalidPattern.test(newName)) {
        toast('文件夹名称不能包含下列字符: \\ / : * ? " < > |');
        return;
      }

      if (folderType === 'line') {
        await performRenameLineFolder(currentName, newName);
      } else if (folderType === 'tower') {
        await performRenameTowerFolder(prefix, currentName, newName);
      }
    }

    function cancelRename() {
      if (committed) return;
      committed = true;
      input.remove();
      nameEl.style.display = '';
    }

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commitRename();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelRename();
      }
    });

    input.addEventListener('blur', function () {
      commitRename();
    });

    nameEl.style.display = 'none';
    nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
    input.focus();
    input.select();
  }

  /* ================= 杆塔对应图片重命名功能（双击名字即可编辑） ================= */

  function computeNewFileName(oldFileName, oldLoc, newLocInput) {
    var ext = oldFileName.slice(oldFileName.lastIndexOf('.'));
    var base = oldFileName.slice(0, oldFileName.lastIndexOf('.'));

    var cleanInput = (newLocInput || '').trim();
    // 若用户输入时带了扩展名，自动去除以防生成 .jpg.jpg
    if (cleanInput.toLowerCase().endsWith(ext.toLowerCase())) {
      cleanInput = cleanInput.slice(0, -ext.length).trim();
    }
    if (!cleanInput) return oldFileName;

    var cleanOldLoc = (oldLoc || '').trim();

    // 如果用户直接输入了包含双下划线的完整命名格式，或者输入内容已包含完整的前缀路径，直接使用
    if (cleanInput.indexOf('__') >= 0 || (base.indexOf('_') >= 0 && cleanInput.startsWith(base.slice(0, base.indexOf('_') + 1)))) {
      return cleanInput + ext;
    }

    // 1. 精确替换：仅修改文件名中对应的组件（部件）部分，绝不覆盖线路与杆塔等前缀信息
    if (cleanOldLoc && base.includes(cleanOldLoc)) {
      var lastIdx = base.lastIndexOf(cleanOldLoc);
      var newBase = base.slice(0, lastIdx) + cleanInput + base.slice(lastIdx + cleanOldLoc.length);
      return newBase + ext;
    }

    // 2. 若原文件名包含双下划线 __ （例如 线路__杆塔__部件 或 线路__部件）
    if (base.indexOf('__') >= 0) {
      var lastDblIdx = base.lastIndexOf('__');
      var prefixPart = base.slice(0, lastDblIdx + 2);
      return prefixPart + cleanInput + ext;
    }

    // 3. 若原文件名包含单下划线 _ 分隔（例如 线路_杆塔_部件）
    if (base.indexOf('_') >= 0) {
      var lastUnderIdx = base.lastIndexOf('_');
      var prefixPartSingle = base.slice(0, lastUnderIdx + 1);
      return prefixPartSingle + cleanInput + ext;
    }

    // 4. 原名本身就是纯组件名（如 DJI_001.JPG 或 变压器.jpg）
    return cleanInput + ext;
  }

  async function performRenamePhoto(index, newLocInput, oldLoc) {
    if (index < 0 || index >= state.files.length) return;
    var f = state.files[index];
    var oldName = f.name;

    if (!oldLoc) {
      var info = parseFilePrefixAndLocation(oldName, f.relPath);
      oldLoc = info ? info.loc : '';
    }

    var newFileName = computeNewFileName(oldName, oldLoc, newLocInput);
    if (newFileName === oldName) return;

    // 校验非法字符
    var invalidPattern = new RegExp('[/\\\\:*?\"<>|]');
    if (invalidPattern.test(newFileName)) {
      toast('图片名称不能包含下列字符: \\ / : * ? " < > |');
      return;
    }

    // 检查当前同级目录内是否已存在重名文件
    var oldDir = dirOf(f.relPath || f.name);
    var hasDuplicate = state.files.some(function (other, oi) {
      if (oi === index) return false;
      var otherDir = dirOf(other.relPath || other.name);
      return (otherDir === oldDir && other.name.toLowerCase() === newFileName.toLowerCase());
    });
    if (hasDuplicate) {
      toast('该杆塔目录下已存在同名图片【' + newFileName + '】，请换一个名称');
      return;
    }

    // 1. 尝试在物理磁盘上重命名文件
    var diskRenamed = false;
    try {
      if (f.handle && typeof f.handle.move === 'function') {
        await f.handle.move(newFileName);
        diskRenamed = true;
      }
    } catch (err) {
      console.warn('f.handle.move() 异常，尝试目录写入备用方案:', err);
    }

    if (!diskRenamed && f.handle) {
      try {
        var dirPathKey = oldDir ? (oldDir + '/') : '';
        var dirInfo = dirRegistry ? dirRegistry.get(dirPathKey) : null;
        var dirHandle = dirInfo ? dirInfo.handle : lastInputHandle;
        if (dirHandle) {
          var srcFile = await f.handle.getFile();
          var newFileHandle = await dirHandle.getFileHandle(newFileName, { create: true });
          var writable = await newFileHandle.createWritable();
          await writable.write(srcFile);
          await writable.close();
          try { await dirHandle.removeEntry(oldName); } catch (e) {}
          f.handle = newFileHandle;
          diskRenamed = true;
        }
      } catch (err) {
        console.error('物理磁盘重命名图片彻底失败:', err);
      }
    }

    // 2. 更新内存数据结构
    var oldFKey = fileKey({ name: oldName, relPath: f.relPath });
    f.name = newFileName;
    var parentDir = dirOf(f.relPath || '');
    f.relPath = (parentDir ? (parentDir + '/') : '') + newFileName;
    var newFKey = fileKey(f);
    f.mime = mimeOf(newFileName);

    // 同步输出清单映射与精确名索引：图片重命名后旧清单条目仍指向旧名，必须跟着改，否则已标数掉链
    manifestRewriteForPhotoRename(oldName, oldFKey, newFileName, newFKey);
    buildInputNameIndex();

    state.byName.delete(oldName);
    state.byName.set(newFileName, f);

    state.indexByName.delete(oldName);
    state.indexByName.set(newFileName, index);

    if (state.meta.has(oldName)) {
      var metaVal = state.meta.get(oldName);
      state.meta.delete(oldName);
      state.meta.set(newFileName, metaVal);
    }
    if (state.meta.has(oldFKey)) {
      var metaFVal = state.meta.get(oldFKey);
      state.meta.delete(oldFKey);
      state.meta.set(newFKey, metaFVal);
    }

    if (state.cache.has(oldFKey)) {
      var cacheVal = state.cache.get(oldFKey);
      state.cache.delete(oldFKey);
      state.cache.set(newFKey, cacheVal);
    }
    if (state.cache.has(oldName)) {
      var cacheOldVal = state.cache.get(oldName);
      state.cache.delete(oldName);
      state.cache.set(newFKey, cacheOldVal);
    }

    if (viewedPhotosMap[oldName]) {
      delete viewedPhotosMap[oldName];
      viewedPhotosMap[newFileName] = true;
    }
    if (viewedPhotosMap[oldFKey]) {
      delete viewedPhotosMap[oldFKey];
      viewedPhotosMap[newFKey] = true;
    }
    if (state.viewedPhotos && state.viewedPhotos.has(oldFKey)) {
      state.viewedPhotos.delete(oldFKey);
      state.viewedPhotos.add(newFKey);
    }

    if (state.markedFiles && (state.markedFiles.has(oldFKey) || state.markedFiles.has(oldName))) {
      state.markedFiles.delete(oldFKey);
      state.markedFiles.delete(oldName);
      state.markedFiles.add(newFKey);
    }
    if (state.markedBoxedHandles && (state.markedBoxedHandles.has(oldFKey) || state.markedBoxedHandles.has(oldName))) {
      var bh = state.markedBoxedHandles.get(oldFKey) || state.markedBoxedHandles.get(oldName);
      state.markedBoxedHandles.delete(oldFKey);
      state.markedBoxedHandles.delete(oldName);
      state.markedBoxedHandles.set(newFKey, bh);
    }
    if (state.markedDefectTags && (state.markedDefectTags.has(oldFKey) || state.markedDefectTags.has(oldName))) {
      var dtag = state.markedDefectTags.get(oldFKey) || state.markedDefectTags.get(oldName);
      state.markedDefectTags.delete(oldFKey);
      state.markedDefectTags.delete(oldName);
      state.markedDefectTags.set(newFKey, dtag);
    }
    if (state.markedCounts && (state.markedCounts.has(oldFKey) || state.markedCounts.has(oldName))) {
      var mcnt = state.markedCounts.get(oldFKey) || state.markedCounts.get(oldName);
      state.markedCounts.delete(oldFKey);
      state.markedCounts.delete(oldName);
      state.markedCounts.set(newFKey, mcnt);
    }
    if (state.criticalFiles && (state.criticalFiles.has(oldFKey) || state.criticalFiles.has(oldName))) {
      state.criticalFiles.delete(oldFKey);
      state.criticalFiles.delete(oldName);
      state.criticalFiles.add(newFKey);
    }

    // 3. 刷新视图
    renderPathTree(false);

    if (state.index === index) {
      renderSide();
      updateHud();
      if (typeof updateCurrentFileInfoDisplay === 'function') {
        updateCurrentFileInfoDisplay();
      }
    }

    if (diskRenamed) {
      toast('✓ 图片已成功重命名为: ' + newFileName);
    } else {
      toast('✓ 界面已更新为: ' + newFileName + '（磁盘权限受限未物理重命名）');
    }
  }

  function startRenamePhoto(photoNameEl) {
    if (!photoNameEl) return;
    if (document.querySelector('.rename-photo-input') || document.querySelector('.rename-folder-input')) return;

    var idx = parseInt(photoNameEl.dataset.idx, 10);
    if (isNaN(idx) || idx < 0 || idx >= state.files.length) return;

    var currentLoc = photoNameEl.dataset.loc || '';
    if (!currentLoc) {
      var f = state.files[idx];
      currentLoc = f ? f.name.replace(/\.[^.]+$/, '') : '';
    }

    // 切换查看器当前图片（但不调用renderPathTree，防止销毁当前正在编辑的DOM元素）
    if (state.index !== idx) {
      state.index = idx;
      var curPhoto = state.files[idx];
      var pKey = fileKey(curPhoto);
      if (pKey && !viewedPhotosMap[pKey]) {
        viewedPhotosMap[pKey] = true;
        saveViewedPhotos();
      }
      updateHud();
      renderSide();
      getImage(idx).then(function (c) {
        if (c && c.img) {
          var size = getImgSize(c);
          if (size.w > 0 && size.h > 0) {
            state.natural = { w: size.w, h: size.h };
            var fit = computeFit(size.w, size.h);
            fitView(fit.w, fit.h, fit.s);
            render(c.img);
          }
        }
      }).catch(function () {});

      var oldActiveItem = pathTree.querySelector('.loc-item.current');
      if (oldActiveItem) oldActiveItem.classList.remove('current');
      var activeRow = photoNameEl.closest('.loc-item');
      if (activeRow) activeRow.classList.add('current');
    }

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-photo-input';
    input.value = currentLoc;
    input.dataset.oldLoc = currentLoc;
    input.dataset.idx = idx;
    input.title = '回车保存，Esc取消';

    input.addEventListener('click', function (ev) { ev.stopPropagation(); });
    input.addEventListener('dblclick', function (ev) { ev.stopPropagation(); });

    var committed = false;

    async function commitRename() {
      if (committed) return;
      committed = true;
      var newLoc = input.value.trim();
      input.remove();
      photoNameEl.style.display = '';

      if (!newLoc || newLoc === currentLoc) return;

      var invalidPattern = new RegExp('[/\\\\:*?\"<>|]');
      if (invalidPattern.test(newLoc)) {
        toast('图片名称不能包含下列字符: \\ / : * ? " < > |');
        return;
      }

      await performRenamePhoto(idx, newLoc, currentLoc);
    }

    function cancelRename() {
      if (committed) return;
      committed = true;
      input.remove();
      photoNameEl.style.display = '';
    }

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commitRename();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelRename();
      }
    });

    input.addEventListener('blur', function () {
      commitRename();
    });

    photoNameEl.style.display = 'none';
    photoNameEl.parentNode.insertBefore(input, photoNameEl.nextSibling);
    input.focus();
    input.select();
  }

  pathTree.addEventListener('click', function (e) {
    if (e.target.closest('.rename-folder-input') || e.target.closest('.rename-photo-input')) return;
    var delBtn = e.target.closest('.btn-cancel-marked-mini');
    if (delBtn) {
      e.stopPropagation();
      e.preventDefault();
      var rawName = delBtn.dataset.rawName;
      var delIdx = parseInt(delBtn.dataset.idx, 10);
      cancelMarkedDefect(!isNaN(delIdx) && delIdx >= 0 ? delIdx : rawName);
      return;
    }
    if (e.target.closest('.folder-name-text')) {
      // 单击文件夹名字文本不触发折叠/展开，为双击重命名提供更平滑的操作体验
      return;
    }
    var locItem = e.target.closest('.loc-item');
    if (locItem && locItem.dataset.idx !== undefined) {
      var idx = parseInt(locItem.dataset.idx, 10);
      if (isNaN(idx)) return;
      switchTo(idx);
      return;
    }
    var towerHeader = e.target.closest('.tower-header');
    if (towerHeader && towerHeader.dataset.towerKey) {
      var tKey = towerHeader.dataset.towerKey;
      if (collapsedTowers.has(tKey)) {
        collapsedTowers.delete(tKey);
      } else {
        collapsedTowers.add(tKey);
      }
      var tGroup = towerHeader.closest('.tower-group');
      if (tGroup) tGroup.classList.toggle('collapsed', collapsedTowers.has(tKey));
      return;
    }
    var pfxHeader = e.target.closest('.prefix-header');
    if (pfxHeader && pfxHeader.dataset.prefix) {
      toggleGroupCollapse(pfxHeader.dataset.prefix);
      return;
    }
  });

  pathTree.addEventListener('contextmenu', function (e) {
    var locItem = e.target.closest('.loc-item');
    if (locItem && locItem.dataset.idx !== undefined) {
      var idx = parseInt(locItem.dataset.idx, 10);
      if (state.files && state.files[idx]) {
        var fObj = state.files[idx];
        var fk = fileKey(fObj);
        if (state.markedFiles && state.markedFiles.has(fk)) {
          e.preventDefault();
          cancelMarkedDefect(idx);
        }
      }
    }
  });

  pathTree.addEventListener('dblclick', function (e) {
    var photoEl = e.target.closest('.photo-name-text') || e.target.closest('.loc-name') || e.target.closest('.loc-item');
    if (photoEl) {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection && window.getSelection().removeAllRanges();
      var targetSpan = photoEl.classList.contains('photo-name-text') ? photoEl : (photoEl.querySelector('.photo-name-text') || photoEl);
      if (targetSpan) {
        startRenamePhoto(targetSpan);
      }
      return;
    }
    var nameEl = e.target.closest('.folder-name-text');
    if (nameEl) {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection && window.getSelection().removeAllRanges();
      startRenameFolder(nameEl);
      return;
    }
  });

  btnExpandAll.addEventListener('click', expandAllGroups);
  btnCollapseAll.addEventListener('click', collapseAllGroups);
  btnAutoFit.addEventListener('click', function () {
    autoFitLeftPanelWidth();
    toast('左侧栏已重新自适应宽度');
  });

  async function scrollToLastViewedPhoto() {
    if (!state.files || state.files.length === 0) {
      toast('尚未加载照片');
      return;
    }

    // 从后向前查找最后一个已看照片（即查勘序列中进度最靠后的已浏览照片）
    var targetIdx = -1;
    for (var i = state.files.length - 1; i >= 0; i--) {
      if (isFileViewed(state.files[i])) {
        targetIdx = i;
        break;
      }
    }

    if (targetIdx < 0) {
      toast('暂无已看记录，已定位到第 1 张照片');
      targetIdx = 0;
    }

    var f = state.files[targetIdx];
    if (!f) return;

    // 1. 若当前筛选模式过滤掉了该目标照片，自动重置为全部模式以确保可见
    if (typeof isFileMatchingFilter === 'function' && !isFileMatchingFilter(targetIdx)) {
      if (filterMode !== 'all') {
        setFilterMode('all');
      }
      if (searchInput && searchInput.value) {
        searchInput.value = '';
        renderSide();
      }
    }

    // 2. 确保目标照片所在的线路和杆塔处于展开状态
    var parsed = parseFilePrefixAndLocation(f.name, f.relPath);
    if (parsed) {
      if (parsed.prefix) collapsedGroups.delete(parsed.prefix);
      var twrKey = parsed.prefix + ':::' + parsed.tower;
      if (twrKey) collapsedTowers.delete(twrKey);
    }

    // 3. 立即切换加载并展示该照片（强制执行以确保若已在当前项也能重新聚焦与高亮）
    await switchTo(targetIdx, true);

    // 4. 左侧树平滑居中滚动并触发呼吸高亮
    setTimeout(function () {
      var curEl = pathTree.querySelector('.loc-item[data-idx="' + targetIdx + '"]');
      if (!curEl) {
        renderPathTree(true);
        curEl = pathTree.querySelector('.loc-item[data-idx="' + targetIdx + '"]');
      }
      if (curEl) {
        curEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
        curEl.classList.remove('highlight-flash');
        void curEl.offsetWidth; // 触发 reflow 重启关键帧动画
        curEl.classList.add('highlight-flash');
        setTimeout(function () { curEl.classList.remove('highlight-flash'); }, 1500);
      }
    }, 60);

    toast('已直达最后一个已看照片：' + (parsed ? (parsed.tower + ' · ' + parsed.loc) : f.name) + ' (第 ' + (targetIdx + 1) + ' / ' + state.files.length + ' 张)');
  }

  if (btnBackToCurrent) {
    btnBackToCurrent.addEventListener('click', scrollToLastViewedPhoto);
  }


  /* ================= 目录记忆探测与自动连接 ================= */

  async function initDirectoryMemory() {
    try {
      savedInputName = localStorage.getItem(KEY_INPUT_NAME) || '';
      output.mainName = localStorage.getItem(KEY_OUTPUT_NAME) || '';

      lastInputHandle = await getDirHandle('last_input_handle');
      lastOutputHandle = await getDirHandle('last_output_handle');

      if (lastInputHandle && lastInputHandle.name) savedInputName = lastInputHandle.name;
      if (lastOutputHandle && lastOutputHandle.name) output.mainName = lastOutputHandle.name;

      updateFolderButtonText();
      updateOutputButtonText();
      updateEmptyScreenRestoreButton();

      // 静默探测输出目录权限
      if (lastOutputHandle) {
        try {
          var outStatus = await lastOutputHandle.queryPermission({ mode: 'readwrite' });
          if (outStatus === 'granted') {
            output.mainHandle = lastOutputHandle;
            output.mainName = lastOutputHandle.name;
            updateOutputButtonText();
            scanOutputDirectory();
          }
        } catch (e) {}
      }

      // 静默探测输入目录权限（若已被浏览器授权，则直接自动加载全部照片）
      if (lastInputHandle && state.files.length === 0) {
        try {
          var inStatus = await lastInputHandle.queryPermission({ mode: 'readwrite' });
          if (inStatus === 'granted') {
            loadingEl.style.display = '';
            var entries = [];
            await scanImagesRecursive(lastInputHandle, entries, '');
            loadingEl.style.display = 'none';
            if (entries.length > 0) {
              setupFiles(entries, 'fs', lastInputHandle);
              toast('✓ 已自动恢复记忆的输入目录：' + lastInputHandle.name);
            }
          }
        } catch (e) {
          loadingEl.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('initDirectoryMemory failed:', e);
    }
  }
