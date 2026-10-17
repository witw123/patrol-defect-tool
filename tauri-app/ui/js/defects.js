// 缺陷字典、候选词池、右侧面板分类与标签渲染及拖拽排序


  /* ================= 候选分类池（可增删改）核心方法 ================= */

  function getDefaultCandidatePool() {
    var set = new Set();
    for (var i = 0; i < KNOWN_POSITIONS.length; i++) set.add(KNOWN_POSITIONS[i]);
    for (var c in DEFAULT_DEFECT_DICT) set.add(c);
    for (var p in DEFAULT_LOCATION_ADJACENCY) set.add(p);
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
  }

  function saveCandidatePool() {
    try { localStorage.setItem(KEY_CANDIDATE_POOL, JSON.stringify(candidatePool)); } catch (e) {}
  }

  function loadCandidatePool() {
    try {
      var raw = localStorage.getItem(KEY_CANDIDATE_POOL);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) {
          candidatePool = arr;
          return;
        }
      }
    } catch (e) {}
    candidatePool = getDefaultCandidatePool();
  }

  function getAllKnownCategories() {
    var set = new Set(candidatePool);
    for (var c in defectDict) set.add(c);
    for (var p in locationAdjacency) set.add(p);
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
  }

  function addCandidatePoolItem(items) {
    if (!Array.isArray(items)) items = [items];
    var added = 0;
    for (var i = 0; i < items.length; i++) {
      var it = (items[i] || '').trim();
      if (!it) continue;
      if (candidatePool.indexOf(it) < 0) {
        candidatePool.push(it);
        added++;
      }
    }
    if (added > 0) {
      candidatePool.sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
      saveCandidatePool();
    }
    return added;
  }

  function removeCandidatePoolItem(item) {
    var idx = candidatePool.indexOf(item);
    if (idx >= 0) {
      candidatePool.splice(idx, 1);
      saveCandidatePool();
      return true;
    }
    return false;
  }

  function renameCandidatePoolItem(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;
    var idx = candidatePool.indexOf(oldName);
    if (idx >= 0) {
      candidatePool[idx] = newName;
      candidatePool.sort(function (a, b) { return a.localeCompare(b, 'zh-CN'); });
      saveCandidatePool();

      // 联动重命名推荐图谱
      if (locationAdjacency[oldName]) {
        locationAdjacency[newName] = locationAdjacency[oldName];
        delete locationAdjacency[oldName];
      }
      for (var k in locationAdjacency) {
        var arr = locationAdjacency[k];
        for (var i = 0; i < arr.length; i++) {
          if (arr[i] === oldName) arr[i] = newName;
        }
      }
      saveAdjacency();

      // 联动重命名缺陷分类
      if (defectDict[oldName]) {
        defectDict[newName] = defectDict[oldName];
        delete defectDict[oldName];
        saveDefectDict();
      }

      return true;
    }
    return false;
  }


  /* ================= 规则操作底层方法 ================= */

  function addRecommendationRule(sourceCat, targetItems, isBilateral) {
    if (!sourceCat) return 0;
    if (!Array.isArray(targetItems)) targetItems = [targetItems];
    if (!locationAdjacency[sourceCat]) locationAdjacency[sourceCat] = [];

    var addedCount = 0;
    for (var i = 0; i < targetItems.length; i++) {
      var item = (targetItems[i] || '').trim();
      if (!item || item === sourceCat) continue;
      if (locationAdjacency[sourceCat].indexOf(item) < 0) {
        locationAdjacency[sourceCat].push(item);
        addedCount++;
      }
      addCandidatePoolItem(item); // 自动补齐候选池
      if (isBilateral) {
        if (!locationAdjacency[item]) locationAdjacency[item] = [];
        if (locationAdjacency[item].indexOf(sourceCat) < 0) {
          locationAdjacency[item].push(sourceCat);
        }
      }
    }
    if (addedCount > 0) saveAdjacency();
    return addedCount;
  }

  function removeRecommendationRule(sourceCat, targetItem) {
    if (!sourceCat || !locationAdjacency[sourceCat]) return false;
    var idx = locationAdjacency[sourceCat].indexOf(targetItem);
    if (idx >= 0) {
      locationAdjacency[sourceCat].splice(idx, 1);
      saveAdjacency();
      return true;
    }
    return false;
  }

  function clearCategoryRecommendations(sourceCat) {
    if (locationAdjacency[sourceCat]) {
      locationAdjacency[sourceCat] = [];
      saveAdjacency();
      return true;
    }
    return false;
  }


  /* ================= 右侧面板：保持简洁纯粹的缺陷分类与命名标签 ================= */

  function newNamePreview() {
    var name = curName();
    if (!name) return { base: '', ext: '', appended: [], full: '' };
    var m = getMeta(name);
    var ext = name.slice(name.lastIndexOf('.'));
    var base = getCustomBaseName(name, m);

    var appended = m.appended || [];
    if (appended.length === 0 && !m.isSecondaryEdit && !m.tagsCleared) {
      var savedTag = getDefectTagsForFile(name);
      if (savedTag && !base.endsWith(savedTag)) {
        var tags = savedTag.split(/(?=_)/).filter(Boolean);
        if (tags.length > 0) {
          m.appended = tags.slice();
          appended = m.appended;
        }
      }
    }
    return { base: base, ext: ext, appended: appended, full: base + appended.join('') + ext };
  }

  function updateTreeCurrentDefectTag(name, dTag) {
    if (!pathTree) return;
    var curEl = pathTree.querySelector('.loc-item.current');
    if (!curEl) return;
    var nameTextEl = curEl.querySelector('.photo-name-text');
    if (!nameTextEl) return;
    var defectSpan = nameTextEl.querySelector('.item-defect-tag');
    if (dTag) {
      if (!defectSpan) {
        defectSpan = document.createElement('span');
        defectSpan.className = 'item-defect-tag';
        defectSpan.style.cssText = 'color:var(--accent);font-weight:600';
        nameTextEl.appendChild(defectSpan);
      }
      defectSpan.textContent = dTag;
    } else {
      if (defectSpan) defectSpan.remove();
    }
  }

  function appendDefect(text) {
    var name = curName();
    if (!name) return;
    var t = String(text || '');
    if (t.charAt(0) !== '_') t = '_' + t;
    var m = getMeta(name);
    m.tagsCleared = false;
    if (m.appended.indexOf(t) >= 0) { toast('已追加过该缺陷'); return; }
    m.appended.push(t);
    m.history.push({ type: 'name', tag: t });
    var f = curFile();
    var fKey = f ? (f.relPath || f.name) : name;
    var allTags = m.appended.join('');
    if (state.markedDefectTags) {
      state.markedDefectTags.set(fKey, allTags);
    }
    renderSide();
    updateTreeCurrentDefectTag(name, allTags);
    updateHud();
    flashItem(t);

    // 标记裸导线缺陷时立即提示可手动输入命名区段如：#001-#100
    if (t.indexOf('裸导线') >= 0) {
      promptBareWireSection(name, m, false);
    }
  }
  function flashItem(t) {
    var els = sideScroll.querySelectorAll('.def-item .t');
    for (var i = 0; i < els.length; i++) {
      if (els[i].textContent === t) {
        var el = els[i].closest('.def-item');
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 350);
      }
    }
  }

  function saveDefectDict() {
    try { localStorage.setItem(KEY_DEFECT_DICT, JSON.stringify(defectDict)); } catch (e) {}
    sideDictVersion++;
  }
  function loadDefectDict() {
    try {
      var raw = localStorage.getItem(KEY_DEFECT_DICT);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') defectDict = obj;
      }
    } catch (e) {}
  }

  function saveAdjacency() {
    try { localStorage.setItem(KEY_ADJACENCY, JSON.stringify(locationAdjacency)); } catch (e) {}
    sideDictVersion++;
  }
  function loadAdjacency() {
    try {
      var raw = localStorage.getItem(KEY_ADJACENCY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') locationAdjacency = obj;
      }
    } catch (e) {}
  }

  var saveViewedTimer = null;
  function saveViewedPhotos(immediate) {
    if (immediate) {
      if (saveViewedTimer) { clearTimeout(saveViewedTimer); saveViewedTimer = null; }
      try {
        localStorage.setItem(KEY_VIEWED, JSON.stringify(viewedPhotosMap));
        if (typeof localStorage.flush === "function") localStorage.flush();
      } catch (e) {
        console.warn("saveViewedPhotos immediate error:", e);
      }
      return;
    }
    // 核心优化：切图与缩放期间绝对零 I/O、零序列化！
    // 仅在用户完全停顿 2500ms 以上（真正在看图/停歇）后，才在后台默默防抖写盘
    if (saveViewedTimer) clearTimeout(saveViewedTimer);
    saveViewedTimer = setTimeout(function () {
      saveViewedTimer = null;
      try {
        localStorage.setItem(KEY_VIEWED, JSON.stringify(viewedPhotosMap));
      } catch (e) {
        console.warn("saveViewedPhotos error:", e);
      }
    }, 2500);
  }
  window.addEventListener("beforeunload", function () {
    saveViewedPhotos(true);
    try {
      if (outputManifestWriteTimer) {
        clearTimeout(outputManifestWriteTimer);
        outputManifestWriteTimer = null;
        saveOutputManifestNow();
      }
    } catch (e) {}
  });
  window.addEventListener("pagehide", function () {
    saveViewedPhotos(true);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      saveViewedPhotos(true);
      try {
        if (outputManifestWriteTimer) {
          clearTimeout(outputManifestWriteTimer);
          outputManifestWriteTimer = null;
          saveOutputManifestNow();
        }
      } catch (e) {}
    }
  });
  function loadViewedPhotos() {
    try {
      if (!window.__viewedSet) window.__viewedSet = new Set();
      var raw = localStorage.getItem(KEY_VIEWED);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          for (var k in obj) {
            if (obj[k]) {
              var cleanK = (k.indexOf('\\') >= 0) ? k.replace(/\\/g, '/') : k;
              viewedPhotosMap[cleanK] = 1;
              window.__viewedSet.add(cleanK);
            }
          }
        }
      }
      // 如果已有已标照片，自动并入已看集合
      if (typeof state !== 'undefined' && state && state.markedFiles) {
        state.markedFiles.forEach(function (mk) {
          if (mk) {
            var cleanMk = (mk.indexOf('\\') >= 0) ? mk.replace(/\\/g, '/') : mk;
            viewedPhotosMap[cleanMk] = 1;
            window.__viewedSet.add(cleanMk);
          }
        });
      }
    } catch (e) {
      console.warn("loadViewedPhotos error:", e);
    }
  }

  function saveAutoCategories() {
    try {
      localStorage.setItem(KEY_AUTO_CATEGORIES, JSON.stringify(autoCategoryRules));
      if (typeof localStorage.flush === 'function') localStorage.flush();
    } catch (e) {
      console.warn('saveAutoCategories error:', e);
    }
  }

  function loadAutoCategories() {
    try {
      var raw = localStorage.getItem(KEY_AUTO_CATEGORIES);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && Object.keys(obj).length > 0) {
          autoCategoryRules = obj;
          return;
        }
      }
    } catch (e) {}
    autoCategoryRules = JSON.parse(JSON.stringify(DEFAULT_AUTO_CATEGORIES));
  }

  function resetAutoCategories() {
    autoCategoryRules = JSON.parse(JSON.stringify(DEFAULT_AUTO_CATEGORIES));
    saveAutoCategories();
  }

  var lastRenderedSideLoc = null;
  var lastRenderedSideQ = null;
  var lastSideDictVersion = 0;
  var sideDictVersion = 1;

  function renderSide(force) {
    var name = curName();
    if (!name) {
      if (previewEl) previewEl.innerHTML = '';
      sideScroll.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:24px 0">未打开图片</div>';
      lastRenderedSideLoc = null;
      return;
    }
    var loc = detectLocation(name);
    var pv = newNamePreview();

    var isAnyCritical = false;
    var tagsHtml = '';
    if (pv.appended.length > 0) {
      for (var ti = 0; ti < pv.appended.length; ti++) {
        var aTag = pv.appended[ti];
        var isCrit = isCriticalDefectTag(aTag);
        if (isCrit) isAnyCritical = true;
        tagsHtml += '<span class="preview-tag ' + (isCrit ? 'is-crit-tag' : '') + '" data-idx="' + ti + '" data-tag="' + esc(aTag) + '" title="点击直接撤回/移除此缺陷命名" ' + (isCrit ? 'style="border-color:rgba(220,38,38,0.5);color:#dc2626;background:rgba(220,38,38,0.08)"' : '') + '>' + esc(aTag) + '<span class="tag-del-x" style="display:inline-flex;align-items:center;justify-content:center"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></span></span>';
      }
    }

    var critBadgeHtml = isAnyCritical ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(220,38,38,0.15);color:#dc2626;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:3px;border:1px solid rgba(220,38,38,0.35);margin-left:6px" title="当前缺陷已被用户设为危急：点击下方「保存缺陷图片」按钮时会自动额外存入「危急缺陷」目录。与右侧独立的「危急缺陷」按钮互不关联">' + ICONS.warning + ' 系统判定危急（随主保存自动存入）</span>' : '';

    var f = curFile();
    var fKey = f ? (f.relPath || f.name) : name;
    var criticalSavedBadgeHtml = (state.criticalFiles && state.criticalFiles.has(fKey)) ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(31,122,60,0.15);color:var(--ok);font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:3px;border:1px solid rgba(31,122,60,0.35);margin-left:6px" title="已通过「危急缺陷」按钮独立保存过该照片">' + ICONS.check + ' 已存危急缺陷</span>' : '';

    var disp = '<span class="preview-base" title="' + esc(pv.base) + '">' + esc(pv.base) + '</span>' + (tagsHtml || '') + '<span class="preview-ext">' + esc(pv.ext) + '</span>' + critBadgeHtml + criticalSavedBadgeHtml;
    if (previewEl) previewEl.innerHTML = disp;

    var q = (searchInput && searchInput.value || '').trim().toLowerCase();
    if (!force && loc === lastRenderedSideLoc && q === lastRenderedSideQ && sideDictVersion === lastSideDictVersion && sideScroll.children.length > 0) {
      return;
    }
    lastRenderedSideLoc = loc;
    lastRenderedSideQ = q;
    lastSideDictVersion = sideDictVersion;

    var relatedPositions = getRelatedPositions(loc);

    var exactCategoryName = null;
    for (var cat in defectDict) {
      if (cat === loc || (loc && (cat.indexOf(loc) >= 0 || loc.indexOf(cat) >= 0))) {
        exactCategoryName = cat;
        break;
      }
    }

    var renderedCategories = new Set();
    var categoryOrder = [];

    if (exactCategoryName && defectDict[exactCategoryName]) {
      categoryOrder.push({ name: exactCategoryName, type: 'matched' });
      renderedCategories.add(exactCategoryName);
    }

    for (var ri = 0; ri < relatedPositions.length; ri++) {
      var rCat = relatedPositions[ri];
      if (!renderedCategories.has(rCat) && defectDict[rCat]) {
        categoryOrder.push({ name: rCat, type: 'related' });
        renderedCategories.add(rCat);
      }
    }

    for (var cName in defectDict) {
      if (!renderedCategories.has(cName)) {
        categoryOrder.push({ name: cName, type: 'normal' });
        renderedCategories.add(cName);
      }
    }

    var html = '';
    // 缺陷分类区头部：直接集成「修改推荐规则」与「新建分类」
    html += '<div class="sec-title">';
    html += '  <span title="点击缺陷标签右侧危急按钮，可自行设置/取消危急缺陷属性">缺陷分类 <span style="font-size:10px;color:var(--muted);font-weight:400">（可设置危急）</span></span>';
    html += '  <div style="display:flex;align-items:center;gap:4px">';
    html += '    <button id="btnSideConfigRec" class="mini-tool-btn" type="button" title="进入推荐规则与分类管理二级界面" style="color:var(--accent);font-weight:600;height:22px">修改推荐规则</button>';
    html += '    <button id="btnSideAddCat" class="mini-tool-btn" type="button" title="新建缺陷分类" style="height:22px">新建分类</button>';
    html += '  </div>';
    html += '</div>';

    var visibleCount = 0;
    for (var i = 0; i < categoryOrder.length; i++) {
      var item = categoryOrder[i];
      var catKey = item.name;
      var cItems = (defectDict[catKey] || []).filter(function (t) {
        return !isHidden(t) && (!q || t.toLowerCase().indexOf(q) >= 0 || catKey.toLowerCase().indexOf(q) >= 0);
      });

      if (q && cItems.length === 0 && catKey.toLowerCase().indexOf(q) < 0) continue;

      var styleClass = item.type === 'matched' ? 'matched' : (item.type === 'related' ? 'related' : '');
      var badgeHtml = item.type === 'matched' ? '<span class="badge boxed" style="font-size:10px;padding:1px 4px">当前匹配</span>' :
                      (item.type === 'related' ? '<span class="badge unboxed" style="font-size:10px;padding:1px 4px">关联推荐</span>' : '');

      html += renderCategoryGroup(catKey, cItems, styleClass, badgeHtml);
      visibleCount++;
    }

    if (visibleCount === 0 && q) {
      html += '<div style="color:var(--muted);font-size:12px;text-align:center;padding:24px 0">未找到包含「' + esc(q) + '」的缺陷标签</div>';
    }

    var hc = Object.keys(hiddenDefects).length;
    if (hc > 0) html += '<div class="hidden-info"><span>已隐藏 ' + hc + ' 项</span><button id="restoreHidden" class="btn" type="button">恢复</button></div>';

    sideScroll.innerHTML = html;
  }

  // 保持右侧标签绝对简洁清爽，无占位拖拽手柄，支持直接按住拖拽排序与移动，使用极简高清晰矢量图标
  function renderCategoryGroup(catName, items, extraClass, badgeHtml) {
    var h = '<div class="pos-group ' + (extraClass || '') + '" data-category="' + esc(catName) + '">';
    h += '  <div class="pos-header" data-category="' + esc(catName) + '" title="按住可上下拖动调整分类位置">';
    h += '    <span class="pos-title-text" title="分类：' + esc(catName) + '">【' + esc(catName) + '】 ' + (badgeHtml || '') + '</span>';
    h += '    <span class="pos-count" title="该分类下标签数量">' + (items ? items.length : 0) + '</span>';
    h += '    <div class="pos-actions">';
    h += '      <button class="action-icon-btn config-rel-btn" data-category="' + esc(catName) + '" title="配置关联推荐">' + ICONS.link + '</button>';
    h += '      <button class="action-icon-btn edit-cat-btn" data-category="' + esc(catName) + '" title="重命名此分类">' + ICONS.edit + '</button>';
    h += '      <button class="action-icon-btn add-to-cat-btn" data-category="' + esc(catName) + '" title="在此分类下添加新标签">' + ICONS.plus + '</button>';
    h += '      <button class="action-icon-btn del-btn del-cat-btn" data-category="' + esc(catName) + '" title="删除此分类">' + ICONS.trash + '</button>';
    h += '    </div>';
    h += '  </div>';
    h += '  <div class="pos-body" data-category="' + esc(catName) + '">';
    if (items && items.length > 0) {
      for (var i = 0; i < items.length; i++) {
        h += defItemHtml(items[i], catName);
      }
    } else {
      h += '<div style="font-size:11px;color:var(--muted);padding:4px 6px">暂无标签，点击右上角 + 添加或将其他标签拖入</div>';
    }
    h += '  </div>';
    h += '</div>';
    return h;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

  function defItemHtml(t, cat) {
    var isCrit = isCriticalDefectTag(t);
    var critBadge = isCrit ? '<span class="critical-indicator" title="用户已将此缺陷设为危急缺陷，保存时会额外输出至「危急缺陷」目录" style="display:inline-flex;align-items:center;justify-content:center;background:rgba(239,68,68,0.14);color:#dc2626;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px;margin-right:4px;border:1px solid rgba(239,68,68,0.35);flex-shrink:0">危急</span>' : '';
    var textStyle = isCrit ? 'color:#dc2626;font-weight:600' : '';
    var criticalBtn = '<button class="action-icon-btn critical-toggle-btn ' + (isCrit ? 'active' : '') + '" title="' + (isCrit ? '取消【' + esc(t) + '】的危急缺陷属性' : '将【' + esc(t) + '】设为危急缺陷') + '" data-category="' + esc(cat) + '" data-text="' + esc(t) + '" aria-label="' + (isCrit ? '取消危急缺陷' : '设为危急缺陷') + '">' + (isCrit ? ICONS.check : ICONS.warning) + '</button>';
    return '<div class="def-item ' + (isCrit ? 'is-critical-item' : '') + '" data-category="' + esc(cat) + '" data-text="' + esc(t) + '" title="' + (isCrit ? '【危急缺陷】' : '') + '点击应用此标签；按住可拖动排序或移动">' +
      critBadge +
      '<span class="t" style="' + textStyle + '">' + esc(t) + '</span>' +
      '<div class="item-actions">' +
      criticalBtn +
      '  <button class="action-icon-btn edit-tag-btn" title="编辑修改此标签" data-category="' + esc(cat) + '" data-text="' + esc(t) + '">' + ICONS.edit + '</button>' +
      '  <button class="action-icon-btn del-btn del-tag-btn" title="删除/隐藏此标签" data-category="' + esc(cat) + '" data-text="' + esc(t) + '">' + ICONS.close + '</button>' +
      '</div>' +
      '</div>';
  }

  /* ---- 隐藏/恢复缺陷 ---- */
  function isHidden(t) { return !!hiddenDefects[t]; }
  function saveHidden() {
    try { localStorage.setItem(KEY_HIDDEN, JSON.stringify(Object.keys(hiddenDefects))); } catch (e) {}
    sideDictVersion++;
  }
  function hideDefect(t) {
    hiddenDefects[t] = true;
    saveHidden();
    renderSide();
  }
  function restoreHidden() {
    hiddenDefects = {};
    saveHidden();
    renderSide();
  }
  function loadHidden() {
    try {
      var raw = localStorage.getItem(KEY_HIDDEN);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          var o = {};
          for (var i = 0; i < arr.length; i++) o[arr[i]] = true;
          hiddenDefects = o;
        }
      }
    } catch (e) {}
  }


  /* ================= 分类与标签拖拽排序与移动 ================= */

  function reorderCategory(fromCat, toCat, isTop) {
    if (!defectDict[fromCat] || !defectDict[toCat] || fromCat === toCat) return;
    var keys = Object.keys(defectDict);
    var fromIdx = keys.indexOf(fromCat);
    var targetIdx = keys.indexOf(toCat);
    if (fromIdx < 0 || targetIdx < 0) return;

    keys.splice(fromIdx, 1);
    var newTargetIdx = keys.indexOf(toCat);
    var insertIdx;
    if (fromIdx < targetIdx) {
      insertIdx = (targetIdx === fromIdx + 1) ? (newTargetIdx + 1) : (isTop ? newTargetIdx : (newTargetIdx + 1));
    } else {
      insertIdx = (targetIdx === fromIdx - 1) ? newTargetIdx : (isTop ? newTargetIdx : (newTargetIdx + 1));
    }
    keys.splice(insertIdx, 0, fromCat);

    var newDict = {};
    for (var i = 0; i < keys.length; i++) {
      newDict[keys[i]] = defectDict[keys[i]];
    }
    defectDict = newDict;
    saveDefectDict();
    renderSide(true);
    toast('✓ 已调整分类【' + fromCat + '】的位置');
  }

  function moveOrReorderTag(fromCat, fromTag, toCat, targetTag, isTop) {
    if (!defectDict[fromCat] || !defectDict[toCat]) return;
    var fromArr = defectDict[fromCat];
    var fromIdx = fromArr.indexOf(fromTag);
    if (fromIdx < 0) return;

    if (fromCat === toCat) {
      if (!targetTag || targetTag === fromTag) return;
      var targetIdx = fromArr.indexOf(targetTag);
      if (targetIdx < 0) return;

      fromArr.splice(fromIdx, 1);
      var newTargetIdx = fromArr.indexOf(targetTag);
      var insertIdx;
      if (fromIdx < targetIdx) {
        insertIdx = (targetIdx === fromIdx + 1) ? (newTargetIdx + 1) : (isTop ? newTargetIdx : (newTargetIdx + 1));
      } else {
        insertIdx = (targetIdx === fromIdx - 1) ? newTargetIdx : (newTargetIdx + 1);
      }
      fromArr.splice(insertIdx, 0, fromTag);

      saveDefectDict();
      renderSide(true);
      toast('✓ 已调整标签顺序');
      return;
    }

    // 跨分类移动
    fromArr.splice(fromIdx, 1);
    var toArr = defectDict[toCat];
    if (targetTag) {
      var toIdx = toArr.indexOf(targetTag);
      if (toIdx >= 0) {
        toArr.splice(isTop ? toIdx : toIdx + 1, 0, fromTag);
      } else {
        toArr.push(fromTag);
      }
    } else {
      toArr.push(fromTag);
    }

    saveDefectDict();
    renderSide(true);
    toast('✓ 已将标签【' + fromTag + '】移动到分类【' + toCat + '】');
  }

  /* ================= 纯指针无感高精度拖拽排序与移动（无原生 DnD 依赖，100% 可靠） ================= */

  var ptrDrag = null;
  var ptrGhost = null;
  var lastDragEndTime = 0;

  // 100% 阻止浏览器原生拖拽与文本拖选，彻底杜绝出现 🚫 禁止图标
  sideScroll.addEventListener('dragstart', function (e) {
    e.preventDefault();
    return false;
  });
  sideScroll.addEventListener('selectstart', function (e) {
    if (!e.target.closest('input, textarea')) {
      e.preventDefault();
      return false;
    }
  });

  function cleanupDragVisuals() {
    document.body.style.cursor = '';
    if (ptrGhost && ptrGhost.parentNode) {
      ptrGhost.parentNode.removeChild(ptrGhost);
    }
    ptrGhost = null;
    document.querySelectorAll('.is-dragging, .drag-over-top, .drag-over-bottom, .drag-over-body').forEach(function (el) {
      el.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-body');
    });
  }

  sideScroll.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return; // 仅响应鼠标主键
    if (e.target.closest('.action-icon-btn, input, button')) return;

    var defItem = e.target.closest('.def-item');
    var posHeader = e.target.closest('.pos-header');
    if (!defItem && !posHeader) return;

    var dragEl = defItem || (posHeader ? posHeader.closest('.pos-group') : null);
    if (!dragEl) return;

    // 关键：阻止系统默认事件，彻底阻断原生文本拖拽/选择造成的 🚫 禁止光标
    e.preventDefault();

    ptrDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      isDragging: false,
      type: defItem ? 'tag' : 'category',
      tag: defItem ? defItem.dataset.text : null,
      cat: defItem ? defItem.dataset.category : (posHeader ? posHeader.dataset.category : null),
      el: dragEl,
      dropTarget: null
    };
  });

  window.addEventListener('pointermove', function (e) {
    if (!ptrDrag) return;

    if (!ptrDrag.isDragging) {
      var dx = Math.abs(e.clientX - ptrDrag.startX);
      var dy = Math.abs(e.clientY - ptrDrag.startY);
      if (dx > 4 || dy > 4) {
        ptrDrag.isDragging = true;
        document.body.style.cursor = 'grabbing';
        try {
          if (ptrDrag.el && ptrDrag.el.setPointerCapture) {
            ptrDrag.el.setPointerCapture(ptrDrag.pointerId);
          }
        } catch (err) {}
        ptrDrag.el.classList.add('is-dragging');

        ptrGhost = document.createElement('div');
        ptrGhost.className = 'drag-ghost-badge';
        ptrGhost.textContent = (ptrDrag.type === 'tag' ? ptrDrag.tag : '【' + ptrDrag.cat + '】');
        document.body.appendChild(ptrGhost);
      }
    }

    if (ptrDrag.isDragging) {
      e.preventDefault();
      if (ptrGhost) {
        ptrGhost.style.left = (e.clientX + 14) + 'px';
        ptrGhost.style.top = (e.clientY + 14) + 'px';
      }

      // 清理前一帧的悬停高亮
      document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-body').forEach(function (el) {
        el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-body');
      });
      ptrDrag.dropTarget = null;

      // 准确定位光标下方真实元素
      var under = document.elementFromPoint(e.clientX, e.clientY);
      if (!under) return;

      if (ptrDrag.type === 'category') {
        var targetGroup = under.closest('.pos-group');
        if (targetGroup && targetGroup !== ptrDrag.el) {
          var rect = targetGroup.getBoundingClientRect();
          var isTop = (e.clientY - rect.top) < (rect.height / 2);
          targetGroup.classList.add(isTop ? 'drag-over-top' : 'drag-over-bottom');
          ptrDrag.dropTarget = {
            type: 'category',
            targetCat: targetGroup.dataset.category,
            isTop: isTop
          };
        }
      } else if (ptrDrag.type === 'tag') {
        var targetItem = under.closest('.def-item');
        var targetBody = under.closest('.pos-body');
        var targetGroup2 = under.closest('.pos-group');

        if (targetItem && targetItem !== ptrDrag.el) {
          var rect2 = targetItem.getBoundingClientRect();
          var isTop2 = (e.clientY - rect2.top) < (rect2.height / 2);
          targetItem.classList.add(isTop2 ? 'drag-over-top' : 'drag-over-bottom');
          ptrDrag.dropTarget = {
            type: 'tag_to_tag',
            toCat: targetItem.dataset.category,
            targetTag: targetItem.dataset.text,
            isTop: isTop2
          };
        } else if (targetBody) {
          targetBody.classList.add('drag-over-body');
          ptrDrag.dropTarget = {
            type: 'tag_to_cat',
            toCat: targetBody.dataset.category
          };
        } else if (targetGroup2) {
          var body2 = targetGroup2.querySelector('.pos-body');
          if (body2) body2.classList.add('drag-over-body');
          ptrDrag.dropTarget = {
            type: 'tag_to_cat',
            toCat: targetGroup2.dataset.category
          };
        }
      }
    }
  }, { passive: false });

  function handlePointerEnd(e) {
    if (!ptrDrag) return;

    var wasDragging = ptrDrag.isDragging;
    var dragInfo = ptrDrag;
    ptrDrag = null;

    if (wasDragging) {
      e.preventDefault();
      e.stopPropagation();
      lastDragEndTime = Date.now();

      try {
        if (dragInfo.el && dragInfo.el.releasePointerCapture) {
          dragInfo.el.releasePointerCapture(dragInfo.pointerId);
        }
      } catch (err) {}

      cleanupDragVisuals();

      if (dragInfo.dropTarget) {
        var dt = dragInfo.dropTarget;
        if (dt.type === 'category') {
          reorderCategory(dragInfo.cat, dt.targetCat, dt.isTop);
        } else if (dt.type === 'tag_to_tag') {
          moveOrReorderTag(dragInfo.cat, dragInfo.tag, dt.toCat, dt.targetTag, dt.isTop);
        } else if (dt.type === 'tag_to_cat') {
          moveOrReorderTag(dragInfo.cat, dragInfo.tag, dt.toCat, null, false);
        }
      }
    } else {
      cleanupDragVisuals();
      // 未发生拖动位移，判定为纯点击，直接触发标签应用
      if (dragInfo.type === 'tag' && dragInfo.tag) {
        lastDragEndTime = Date.now();
        appendDefect(dragInfo.tag);
      }
    }
  }

  window.addEventListener('pointerup', handlePointerEnd);
  window.addEventListener('pointercancel', handlePointerEnd);

  /* ---- 分类与标签标准小弹窗编辑交互 ---- */

  function createNewCategoryDialog() {
    showPromptDialog({
      title: '新建缺陷分类',
      desc: '请输入新分类名称（将自动加入候选分类池与推荐规则）：',
      placeholder: '如：接地线、护栏、隔离开关…',
      validate: function (v) {
        if (!v || !v.trim()) return '分类名称不能为空';
        if (defectDict[v.trim()]) return '已存在同名分类';
        return null;
      }
    }).then(function (newCat) {
      if (!newCat || !newCat.trim()) return;
      newCat = newCat.trim();
      defectDict[newCat] = [];
      if (!locationAdjacency[newCat]) locationAdjacency[newCat] = [];
      addCandidatePoolItem(newCat);
      saveDefectDict();
      saveAdjacency();
      renderSide();
      toast('✓ 已新建分类：【' + newCat + '】');
    });
  }

  if (btnOpenRecSettings) btnOpenRecSettings.addEventListener('click', function () { settingsPanel.classList.remove('show'); openRecommendModal(); });

  sideScroll.addEventListener('click', function (e) {
    if (Date.now() - lastDragEndTime < 300) return; // 拖拽刚结束时避免误触发点击事件
    if (e.target.closest('#restoreHidden')) { restoreHidden(); return; }

    // 缺陷分类区头部的两个快捷按钮
    if (e.target.closest('#btnSideConfigRec') || e.target.closest('#btnQuickRec')) {
      openRecommendModal();
      return;
    }

    if (e.target.closest('#btnSideAddCat') || e.target.closest('#btnAddNewCategory')) {
      createNewCategoryDialog();
      return;
    }

    var configRelBtn = e.target.closest('.config-rel-btn');
    if (configRelBtn) {
      e.stopPropagation();
      var cPos = configRelBtn.dataset.category;
      openRecommendModal(cPos, 'rec');
      return;
    }

    var editCatBtn = e.target.closest('.edit-cat-btn');
    if (editCatBtn) {
      e.stopPropagation();
      var oldCat = editCatBtn.dataset.category;
      showPromptDialog({
        title: '重命名分类',
        desc: '修改分类名称将同步更新推荐图谱与全局引用：',
        defaultValue: oldCat,
        placeholder: '输入新分类名称…',
        validate: function (v) {
          if (!v || !v.trim()) return '分类名称不能为空';
          if (v.trim() !== oldCat && defectDict[v.trim()]) return '已存在同名分类';
          return null;
        }
      }).then(function (newName) {
        if (!newName || newName.trim() === oldCat) return;
        newName = newName.trim();
        var cItems = defectDict[oldCat] || [];
        delete defectDict[oldCat];
        defectDict[newName] = cItems;

        if (locationAdjacency[oldCat]) {
          locationAdjacency[newName] = locationAdjacency[oldCat];
          delete locationAdjacency[oldCat];
        }
        for (var k in locationAdjacency) {
          var arr = locationAdjacency[k];
          var iIdx = arr.indexOf(oldCat);
          if (iIdx >= 0) arr[iIdx] = newName;
        }

        renameCandidatePoolItem(oldCat, newName);

        saveDefectDict();
        saveAdjacency();
        renderSide();
        toast('✓ 分类已重命名为：【' + newName + '】');
      });
      return;
    }

    var addTagBtn = e.target.closest('.add-to-cat-btn');
    if (addTagBtn) {
      e.stopPropagation();
      var targetCat = addTagBtn.dataset.category;
      showPromptDialog({
        title: '添加缺陷标签',
        desc: '在【' + targetCat + '】分类下新建缺陷标签（下划线开头）：',
        defaultValue: '_' + targetCat + '-',
        placeholder: '如：_' + targetCat + '-螺栓松动',
        validate: function (v) {
          if (!v || !v.trim()) return '标签内容不能为空';
          var tag = v.trim();
          if (tag.charAt(0) !== '_') tag = '_' + tag;
          if (defectDict[targetCat] && defectDict[targetCat].indexOf(tag) >= 0) return '该分类下已存在相同标签';
          return null;
        }
      }).then(function (tagText) {
        if (!tagText || !tagText.trim()) return;
        tagText = tagText.trim();
        if (tagText.charAt(0) !== '_') tagText = '_' + tagText;
        if (!defectDict[targetCat]) defectDict[targetCat] = [];
        defectDict[targetCat].push(tagText);
        saveDefectDict();
        renderSide();
        appendDefect(tagText);
        toast('✓ 已新建标签：' + tagText);
      });
      return;
    }

    var delCatBtn = e.target.closest('.del-cat-btn');
    if (delCatBtn) {
      e.stopPropagation();
      var delCat = delCatBtn.dataset.category;
      showConfirmDialog('删除分类', '确定要删除分类【' + delCat + '】及其包含的所有缺陷标签吗？\n此操作不可恢复。').then(function (ok) {
        if (!ok) return;
        delete defectDict[delCat];
        delete locationAdjacency[delCat];
        for (var k2 in locationAdjacency) {
          var arr2 = locationAdjacency[k2];
          var iIdx2 = arr2.indexOf(delCat);
          if (iIdx2 >= 0) arr2.splice(iIdx2, 1);
        }
        removeCandidatePoolItem(delCat);
        saveDefectDict();
        saveAdjacency();
        renderSide();
        toast('✓ 已删除分类：【' + delCat + '】');
      });
      return;
    }

    var criticalToggleBtn = e.target.closest('.critical-toggle-btn');
    if (criticalToggleBtn) {
      e.stopPropagation();
      toggleCriticalDefect(criticalToggleBtn.dataset.text || '');
      return;
    }

    var editTagBtn = e.target.closest('.edit-tag-btn');
    if (editTagBtn) {
      e.stopPropagation();
      var cat2 = editTagBtn.dataset.category;
      var oldText = editTagBtn.dataset.text;
      showPromptDialog({
        title: '修改缺陷标签',
        desc: '修改【' + cat2 + '】下的标签名称：',
        defaultValue: oldText,
        placeholder: '输入新标签名称…',
        validate: function (v) {
          if (!v || !v.trim()) return '标签名称不能为空';
          return null;
        }
      }).then(function (newText) {
        if (!newText || !newText.trim() || newText.trim() === oldText) return;
        newText = newText.trim();
        if (newText.charAt(0) !== '_') newText = '_' + newText;
        if (defectDict[cat2]) {
          var idx3 = defectDict[cat2].indexOf(oldText);
          if (idx3 >= 0) defectDict[cat2][idx3] = newText;
          if (criticalDefects.has(oldText)) {
            criticalDefects.delete(oldText);
            criticalDefects.add(newText);
            saveCriticalDefects();
          }
          saveDefectDict();
          renderSide();
          toast('✓ 标签已更新为：' + newText);
        }
      });
      return;
    }

    var delTagBtn = e.target.closest('.del-tag-btn');
    if (delTagBtn) {
      e.stopPropagation();
      var dCat = delTagBtn.dataset.category;
      var dText = delTagBtn.dataset.text;
      showConfirmDialog('删除标签', '确定要删除标签【' + dText + '】吗？').then(function (ok) {
        if (!ok) return;
        hideDefect(dText);
        if (criticalDefects.has(dText)) {
          criticalDefects.delete(dText);
          saveCriticalDefects();
        }
        if (defectDict[dCat]) {
          var idx2 = defectDict[dCat].indexOf(dText);
          if (idx2 >= 0) defectDict[dCat].splice(idx2, 1);
          saveDefectDict();
        }
        renderSide();
        toast('✓ 已删除标签：' + dText);
      });
      return;
    }

    var item = e.target.closest('.def-item');
    if (item) {
      var t = item.dataset.text || item.querySelector('.t').textContent;
      appendDefect(t);
    }
  });

  // 点击预览条中的红色缺陷标签徽章直接撤回/移除；点击基础名称可手动编辑命名区段
  if (previewEl) {
    previewEl.addEventListener('click', function (e) {
      var baseEl = e.target.closest('.preview-base');
      if (baseEl) {
        var name = curName();
        if (name) {
          var f = curFile() || (state.files && state.files[state.index]);
          var m = getMeta(f || name);
          var parsed = parseFilePrefixAndLocation(name, (f && f.relPath) || '');
          var nextTower = '';
          if (state.files && state.index >= 0 && state.index + 1 < state.files.length) {
            var nextF = state.files[state.index + 1];
            var nextParsed = parseFilePrefixAndLocation(nextF.name, nextF.relPath);
            if (nextParsed && nextParsed.tower && nextParsed.tower !== parsed.tower && nextParsed.tower !== '默认杆塔') {
              nextTower = nextParsed.tower;
            }
          }
          var defaultSec = m.sectionRange || suggestSection(parsed.tower, nextTower);
          showPromptDialog({
            title: '修改照片命名区段',
            desc: '请输入跨越区段（如 #63-1-#63-2 或 #001-#100），将自动替换杆塔号；若保持原名请清空输入框按回车：',
            placeholder: '例如：#63-1-#63-2 或 #001-#100',
            defaultValue: defaultSec
          }).then(function (secInput) {
            if (secInput !== null) {
              m.sectionRange = secInput.trim();
              renderSide();
              toast(m.sectionRange ? ('已设置命名区段：' + m.sectionRange) : '已恢复默认杆塔命名');
            }
          });
        }
        return;
      }
      var tagEl = e.target.closest('.preview-tag');
      if (tagEl) {
        var idx = parseInt(tagEl.dataset.idx, 10);
        var name = curName();
        if (name && !isNaN(idx)) {
          var m = getMeta(name);
          if (idx >= 0 && idx < m.appended.length) {
            var removed = m.appended.splice(idx, 1)[0];
            if (m.history) {
              for (var hi = m.history.length - 1; hi >= 0; hi--) {
                if (m.history[hi].type === 'name' && m.history[hi].tag === removed) {
                  m.history.splice(hi, 1);
                  break;
                }
              }
            }
            var f = curFile();
            var fKey = f ? (f.relPath || f.name) : name;
            if (state.markedDefectTags) {
              if (m.appended.length > 0) {
                state.markedDefectTags.set(fKey, m.appended.join(''));
              } else {
                state.markedDefectTags.delete(fKey);
              }
            }
            if (removed && removed.indexOf('裸导线') >= 0) {
              var stillHasBare = m.appended && m.appended.some(function (t) { return t.indexOf('裸导线') >= 0; });
              if (!stillHasBare) {
                m.sectionRange = '';
                m.sectionPrompted = false;
              }
            }
            renderSide();
            updateTreeCurrentDefectTag(name, m.appended.length > 0 ? m.appended.join('') : '');
            updateHud();
            toast('已撤回缺陷命名：' + (removed || ''));
          }
        }
      }
    });
  }
