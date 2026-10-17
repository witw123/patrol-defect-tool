// 输出清单管理、多线路独立清单持久化与已标状态统计


  /* ================= 输出目录扫描（获取已标记照片信息） ================= */

  function purgeOutputArtifactsFromFiles() {
    if (!state.files || state.files.length === 0) return false;
    var hasArtifacts = state.files.some(function (f) {
      var p = (f.relPath || f.name || '');
      return p.indexOf('缺陷圈示图') >= 0 || p.indexOf('缺陷原图') >= 0 || p.indexOf('危急缺陷') >= 0 || p.indexOf('全绝缘缺陷') >= 0 || p.indexOf('其他缺陷') >= 0;
    });
    if (!hasArtifacts) return false;

    state.files = state.files.filter(function (f) {
      var p = (f.relPath || f.name || '');
      return p.indexOf('缺陷圈示图') < 0 && p.indexOf('缺陷原图') < 0 && p.indexOf('危急缺陷') < 0 && p.indexOf('全绝缘缺陷') < 0 && p.indexOf('其他缺陷') < 0;
    });
    invalidateFilterList();
    state.byName = new Map();
    state.byKey = new Map();
    state.indexByName = new Map();
    state.indexByKey = new Map();
    for (var i = 0; i < state.files.length; i++) {
      var eKey = fileKey(state.files[i]);
      state.byKey.set(eKey, state.files[i]);
      state.byName.set(state.files[i].name, state.files[i]);
      state.indexByKey.set(eKey, i);
      state.indexByName.set(state.files[i].name, i);
    }
    buildInputNameIndex();
    if (state.index >= state.files.length) state.index = state.files.length - 1;
    return true;
  }

  function extractDefectTag(origName, outName) {
    if (!origName || !outName) return '';
    var origBase = origName.slice(0, origName.lastIndexOf('.'));
    var outBase = outName.slice(0, outName.lastIndexOf('.'));

    if (outBase === origBase) return '';
    if (outBase.startsWith(origBase + '_')) {
      return outBase.slice(origBase.length);
    }
    var idx = outBase.lastIndexOf(origBase);
    if (idx >= 0) {
      var after = outBase.slice(idx + origBase.length);
      if (after.startsWith('_')) return after;
    }
    var parts = outBase.split('__');
    var lastPart = parts[parts.length - 1];
    var subParts = lastPart.split('_');
    if (subParts.length > 1) {
      return '_' + subParts.slice(1).join('_');
    }
    return '';
  }

  function getDefectCategory(dTag, appended, origName, outName) {
    var desc = '';
    if (Array.isArray(appended) && appended.length > 0) {
      desc = appended.join(' ');
    } else if (dTag) {
      desc = dTag;
    } else if (origName && outName) {
      desc = extractDefectTag(origName, outName);
    } else if (outName) {
      desc = outName;
    }

    var rules = (autoCategoryRules && Object.keys(autoCategoryRules).length > 0)
      ? autoCategoryRules
      : DEFAULT_AUTO_CATEGORIES;

    if (!desc) {
      if (rules['其他缺陷'] !== undefined) return '其他缺陷';
      var allK = Object.keys(rules);
      return allK.length > 0 ? allK[allK.length - 1] : '其他缺陷';
    }

    // 优先按包含具体匹配标签的规则匹配
    for (var cat in rules) {
      var tags = rules[cat];
      if (Array.isArray(tags) && tags.length > 0) {
        for (var i = 0; i < tags.length; i++) {
          var t = (tags[i] || '').trim();
          if (t && desc.indexOf(t) >= 0) {
            return cat;
          }
        }
      }
    }

    // 未命中任何具体标签时，归入兜底分类（若存在“其他缺陷”则归入，或首个标签为空的分类）
    if (rules['其他缺陷'] !== undefined) return '其他缺陷';
    for (var c in rules) {
      if (Array.isArray(rules[c]) && rules[c].length === 0) return c;
    }
    var keys = Object.keys(rules);
    return keys.length > 0 ? keys[keys.length - 1] : '其他缺陷';
  }

  function getDefectTagsForFile(keyOrFile) {
    if (!keyOrFile) return '';
    var key = (typeof keyOrFile === 'object' && keyOrFile) ? fileKey(keyOrFile) : String(keyOrFile);
    var m = state.meta.get(key);
    if (m && m.appended && m.appended.length > 0) {
      return m.appended.join('');
    }
    if (state.markedDefectTags && state.markedDefectTags.has(key)) {
      return state.markedDefectTags.get(key);
    }
    return '';
  }


  /* ================= 输出清单：输出文件 ↔ 原图 精确映射（根治已标数统计不准 + O(1) 定位旧输出） ================= */

  var OUTPUT_MANIFEST_NAME = '输出清单.json';
  var outputManifest = null;
  var outputManifestWriteTimer = null;

  function joinManifestPath() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var p = arguments[i];
      if (p) parts.push(p);
    }
    return parts.join('/');
  }

  async function ensureOutputManifest(forceReload) {
    if (!output.mainHandle) { outputManifest = null; return null; }
    if (outputManifest && !forceReload) {
      // 输出目录已切换时丢弃内存清单（每个输出目录各自持有一份清单文件）
      if (outputManifest.dirName === output.mainHandle.name) return outputManifest;
      outputManifest = null;
    }
    if (forceReload && outputManifest && outputManifestWriteTimer) {
      // 先落盘未写入的清单变更再重新读取，避免丢条目
      clearTimeout(outputManifestWriteTimer);
      outputManifestWriteTimer = null;
      await saveOutputManifestNow();
    }
    try {
      var fh = await output.mainHandle.getFileHandle(OUTPUT_MANIFEST_NAME, { create: false });
      var file = await fh.getFile();
      var text = await file.text();
      var obj = JSON.parse(text);
      outputManifest = { dirName: output.mainHandle.name, entries: (obj && obj.entries && typeof obj.entries === 'object') ? obj.entries : {} };
    } catch (e) {
      outputManifest = { dirName: output.mainHandle.name, entries: {} };
    }
    return outputManifest;
  }

  function scheduleSaveOutputManifest() {
    if (!output.mainHandle || !outputManifest) return;
    if (outputManifestWriteTimer) clearTimeout(outputManifestWriteTimer);
    outputManifestWriteTimer = setTimeout(function () {
      outputManifestWriteTimer = null;
      saveOutputManifestNow();
    }, 300);
  }

  async function saveOutputManifestNow() {
    if (!output.mainHandle || !outputManifest) return;
    try {
      var fh = await output.mainHandle.getFileHandle(OUTPUT_MANIFEST_NAME, { create: true });
      var w = await fh.createWritable();
      await w.write(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), entries: outputManifest.entries }));
      await w.close();
    } catch (e) {
      console.warn('写入输出清单失败:', e);
    }
  }

  async function backupViewedPhotosImmediate() {
    if (!output.mainHandle) return;
    try {
      if (typeof viewedPhotosMap !== 'undefined' && viewedPhotosMap && Object.keys(viewedPhotosMap).length > 0) {
        var vfh = await output.mainHandle.getFileHandle('.巡检已看记录.json', { create: true });
        var vw = await vfh.createWritable();
        await vw.write(JSON.stringify(viewedPhotosMap));
        await vw.close();
      }
    } catch (e) {}
  }
  window.backupViewedPhotosImmediate = backupViewedPhotosImmediate;

  function manifestSet(outRelPath, origName, relPath, line) {
    if (!outRelPath || !origName) return;
    if (!outputManifest) outputManifest = { dirName: output.mainHandle ? output.mainHandle.name : '', entries: {} };
    var storedRel = relPath || origName;
    var lineName = line || (typeof window !== 'undefined' && window.__ACTIVE_LINE__) || '';
    var existed = outputManifest.entries[outRelPath];
    if (existed && existed.origName === origName && existed.relPath === storedRel && (!lineName || existed.line === lineName)) return;
    outputManifest.entries[outRelPath] = { origName: origName, relPath: storedRel, line: lineName || (existed && existed.line) || '' };
    scheduleSaveOutputManifest();
  }

  function manifestDelete(outRelPath) {
    if (!outputManifest || !outRelPath || !outputManifest.entries[outRelPath]) return;
    delete outputManifest.entries[outRelPath];
    scheduleSaveOutputManifest();
  }

  function manifestRenameKey(oldKey, newKey) {
    if (!outputManifest || !oldKey || !newKey || oldKey === newKey) return;
    var entry = outputManifest.entries[oldKey];
    if (!entry) return;
    delete outputManifest.entries[oldKey];
    outputManifest.entries[newKey] = entry;
    scheduleSaveOutputManifest();
  }

  /* 规范化命名重命名输出文件后，按「目录前缀 + 文件名后缀」改写清单键（子目录层级未知，无法拼精确键） */
  function manifestRenameKeyBySuffix(dirName, oldName, newName) {
    if (!outputManifest || !dirName || !oldName || !newName || oldName === newName) return;
    var prefix = dirName + '/';
    var changed = false;
    for (var mk in outputManifest.entries) {
      if (mk.indexOf(prefix) === 0 && (mk === prefix + oldName || mk.indexOf('/' + oldName, mk.length - oldName.length - 1) >= 0)) {
        var entry = outputManifest.entries[mk];
        var nk = mk.slice(0, mk.length - oldName.length) + newName;
        delete outputManifest.entries[mk];
        outputManifest.entries[nk] = entry;
        changed = true;
      }
    }
    if (changed) scheduleSaveOutputManifest();
  }

  function manifestRewriteForPhotoRename(oldName, oldFKey, newName, newFKey) {
    if (!outputManifest) return;
    var changed = false;
    for (var mk in outputManifest.entries) {
      var me = outputManifest.entries[mk];
      if (me.relPath === oldFKey || (me.origName === oldName && me.relPath === oldName)) {
        me.origName = newName;
        me.relPath = newFKey || newName;
        changed = true;
      }
    }
    if (changed) scheduleSaveOutputManifest();
  }

  function manifestRewriteRelPathPrefix(oldPrefix, newPrefix) {
    if (!outputManifest || !oldPrefix || !newPrefix || oldPrefix === newPrefix) return;
    var changed = false;
    for (var mk in outputManifest.entries) {
      var me = outputManifest.entries[mk];
      if (me.relPath && me.relPath.indexOf(oldPrefix + '/') === 0) {
        me.relPath = newPrefix + '/' + me.relPath.slice(oldPrefix.length + 1);
        changed = true;
      }
    }
    if (changed) scheduleSaveOutputManifest();
  }

  function manifestLookup(outRelPath) {
    if (!outputManifest || !outRelPath) return null;
    return outputManifest.entries[outRelPath] || null;
  }

  /* 从清单条目反查输入照片对象：原名精确命中 → relPath 兜底，都失配则返回 null（由调用方回退模糊匹配） */
  function resolveManifestEntry(mEntry) {
    if (!mEntry) return null;
    var hit = null;
    var idx = state.inputNameIndex;
    if (idx && idx.byExact) hit = idx.byExact.get(mEntry.origName) || null;
    if (!hit && state.byName) hit = state.byName.get(mEntry.origName) || null;
    if (!hit && mEntry.relPath && state.byKey) hit = state.byKey.get(mEntry.relPath) || null;
    return hit || null;
  }

  /* 输入照片索引：完整名精确 → O(1)；baseName 前缀/`__`包含 → 候选集；同线路同杆塔桶 → 兜底候选。
     三者合并后模糊匹配从 O(K×M) 全量打分降到仅对极小候选集打分（保存卡顿主因之二） */
  function buildInputNameIndex() {
    var byExact = new Map();
    var byBase = new Map();
    var byTower = new Map();
    if (state.files) {
      for (var i = 0; i < state.files.length; i++) {
        var sf = state.files[i];
        sf._orderIdx = i; // 同分候选排序锚点：建索引时的数组位次（与原全量遍历次序一致）
        // 与原全量打分「同分先者胜」保持一致：重名照片保留先出现的，不用后写的覆盖
        if (!byExact.has(sf.name)) byExact.set(sf.name, sf);
        var nm = sf.name;
        var dot = nm.lastIndexOf('.');
        var b = dot >= 0 ? nm.slice(0, dot) : nm;
        var arr = byBase.get(b);
        if (!arr) { arr = []; byBase.set(b, arr); }
        arr.push(sf);
        var info = parseFilePrefixAndLocation(sf.name, sf.relPath);
        sf._parsedInfo = info;
        if (info.prefix && info.tower) {
          var tk = info.prefix + '|' + info.tower;
          var tArr = byTower.get(tk);
          if (!tArr) { tArr = []; byTower.set(tk, tArr); }
          tArr.push(sf);
        }
      }
    }
    state.inputNameIndex = { byExact: byExact, byBase: byBase, byTower: byTower };
  }

  function findMatchingInputFile(fname) {
    if (!state.files || state.files.length === 0 || !fname) return null;
    if (!state.inputNameIndex) buildInputNameIndex();
    var exactIndex = state.inputNameIndex;
    var exactHit = (exactIndex && exactIndex.byExact) ? exactIndex.byExact.get(fname) : null;
    var ext = fname.slice(fname.lastIndexOf('.')).toLowerCase();
    var fBase = fname.slice(0, fname.lastIndexOf('.'));
    var fInfo = parseFilePrefixAndLocation(fname, '');

    var bestFile = null;
    var bestScore = -1;

    /* 候选集生成：任何能通过判定条件的原图，要么与 fBase 存在名字前缀/`__`包含关系（→ baseName 索引），
       要么与输出名同线路同杆塔（→ 杆塔桶，杆塔前缀匹配需枚举 fInfo.tower 全部子串）。等价于原全量遍历 */
    var candArr = [];
    var candSeen = new Set();
    function pushCand(sf) {
      if (sf && !candSeen.has(sf)) { candSeen.add(sf); candArr.push(sf); }
    }
    // 文件名全等命中也进入统一打分（同判同序）：杆塔目录名与文件名内嵌杆塔不一致等极端场景下，与原全量遍历行为完全一致
    if (exactHit) pushCand(exactHit);
    if (exactIndex && exactIndex.byBase) {
      var byBase = exactIndex.byBase;
      var seps = [];
      for (var ci = 0; ci < fBase.length; ci++) {
        var ch = fBase.charAt(ci);
        if (ch === '_' || ch === '-') seps.push(ci);
      }
      for (var si = 0; si <= seps.length; si++) {
        var cEnd = si < seps.length ? seps[si] : fBase.length;
        if (cEnd <= 0) continue;
        var hitArr = byBase.get(fBase.slice(0, cEnd));
        if (hitArr) for (var hi = 0; hi < hitArr.length; hi++) pushCand(hitArr[hi]);
      }
      var ddIdx = fBase.indexOf('__');
      while (ddIdx >= 0) {
        var st2 = ddIdx + 2;
        for (var ei2 = st2 + 1; ei2 <= fBase.length; ei2++) {
          var hitArr2 = byBase.get(fBase.slice(st2, ei2));
          if (hitArr2) for (var hi2 = 0; hi2 < hitArr2.length; hi2++) pushCand(hitArr2[hi2]);
        }
        ddIdx = fBase.indexOf('__', ddIdx + 1);
      }
    }
    if (exactIndex && exactIndex.byTower && fInfo.prefix && fInfo.tower) {
      for (var ta = 0; ta < fInfo.tower.length; ta++) {
        for (var tb = ta + 1; tb <= fInfo.tower.length; tb++) {
          var towerArr = exactIndex.byTower.get(fInfo.prefix + '|' + fInfo.tower.slice(ta, tb));
          if (towerArr) for (var thi = 0; thi < towerArr.length; thi++) pushCand(towerArr[thi]);
        }
      }
    }

    /* 保持与原全量遍历一致的先后次序（同分时先出现的胜出） */
    candArr.sort(function (a, b) {
      var ia = (typeof a._orderIdx === 'number') ? a._orderIdx : 2147483647;
      var ib = (typeof b._orderIdx === 'number') ? b._orderIdx : 2147483647;
      return ia - ib;
    });

    for (var i = 0; i < candArr.length; i++) {
      var sf = candArr[i];
      var origName = sf.name;
      var origExt = origName.slice(origName.lastIndexOf('.')).toLowerCase();
      if (origExt !== ext) continue;

      var origBase = origName.slice(0, origName.lastIndexOf('.'));
      var sfInfo = sf._parsedInfo || (sf._parsedInfo = parseFilePrefixAndLocation(sf.name, sf.relPath));

      var score = 0;
      var nameMatch = (fBase === origBase || fBase.startsWith(origBase + '_') || fBase.startsWith(origBase + '-') || fBase.startsWith(origBase + '__') || fBase.indexOf('__' + origBase) >= 0);
      if (nameMatch) {
        score += 100 + origBase.length;
      }

      var prefixMatch = sfInfo.prefix && fInfo.prefix && (sfInfo.prefix === fInfo.prefix);
      if (prefixMatch) score += 50;

      var towerMatch = sfInfo.tower && fInfo.tower && (
        sfInfo.tower === fInfo.tower ||
        fInfo.tower.startsWith(sfInfo.tower + '-') ||
        fInfo.tower.startsWith(sfInfo.tower + '~') ||
        fInfo.tower.indexOf(sfInfo.tower) >= 0
      );
      if (towerMatch) score += 50;

      var locMatch = sfInfo.loc && fInfo.loc && (sfInfo.loc === fInfo.loc || fInfo.loc.startsWith(sfInfo.loc) || sfInfo.loc.indexOf(fInfo.loc) >= 0);
      if (locMatch) score += 30;

      // 判定条件：要么文件名完全前缀匹配且同杆塔，要么同线路同杆塔同位置部件匹配
      if ((nameMatch && (towerMatch || !fInfo.tower || fInfo.tower === '默认杆塔')) || (prefixMatch && towerMatch && locMatch)) {
        if (score > bestScore) {
          bestScore = score;
          bestFile = sf;
        }
      }
    }
    return bestFile;
  }

  /* 独立扫描「危急缺陷」文件夹，得到已独立保存过危急缺陷的原始文件名集合（与主标记统计完全分离） */
  async function scanCriticalDirectory() {
    var found = new Set();
    if (!output.mainHandle) return found;
    try {
      var criticalDirHandle = null;
      if (output.mainHandle.name === '危急缺陷') {
        criticalDirHandle = output.mainHandle;
      } else {
        criticalDirHandle = await output.mainHandle.getDirectoryHandle('危急缺陷', { create: false });
      }
      if (!criticalDirHandle) return found;

      async function walk(dirH, depth, prefixPath) {
        if (depth > 4) return;
        for await (var entry of dirH.values()) {
          if (entry.kind === 'file') {
            var fname = entry.name;
            var ext = fname.slice(fname.lastIndexOf('.')).toLowerCase();
            if (IMG_EXTS.indexOf(ext) >= 0 && state.files && state.files.length > 0) {
              var critRel = joinManifestPath('危急缺陷', prefixPath, fname);
              var critEntry = manifestLookup(critRel);
              var matched = (critEntry && resolveManifestEntry(critEntry)) || findMatchingInputFile(fname);
              if (matched) {
                found.add(fileKey(matched));
              }
            }
          } else if (entry.kind === 'directory') {
            await walk(entry, depth + 1, joinManifestPath(prefixPath, entry.name));
          }
        }
      }
      await walk(criticalDirHandle, 0, '');
    } catch (e) {}
    return found;
  }

  async function scanOutputDirectory() {
    if (!output.mainHandle) return;
    try {
      // 优先清理输入图片列表，确保输出生成的图片绝对不作为输入原图参与统计
      purgeOutputArtifactsFromFiles();
      if (!state.inputNameIndex) buildInputNameIndex();
      // 优先读取「输出清单」精确映射（输出文件 → 原图），清单缺失时回退模糊匹配（兼容旧输出目录）
      await ensureOutputManifest();

      var markedFiles = new Set();
      var markedBoxedHandles = new Map();
      var markedDefectTags = new Map();
      var markedCounts = new Map();

      // 核心支持：查找「缺陷圈示图」目录（权威来源）及备用原图目录
      var boxedDirHandle = null;
      try {
        if (output.mainHandle.name === '缺陷圈示图') {
          boxedDirHandle = output.mainHandle;
        } else {
          boxedDirHandle = await output.mainHandle.getDirectoryHandle('缺陷圈示图', { create: false });
        }
      } catch (e) {}

      var origOutputDirHandle = null;
      try {
        if (output.mainHandle.name === '缺陷原图') {
          origOutputDirHandle = output.mainHandle;
        } else {
          origOutputDirHandle = await output.mainHandle.getDirectoryHandle('缺陷原图', { create: false });
        }
      } catch (e) {}

      if (!boxedDirHandle && !origOutputDirHandle) {
        state.markedFiles = markedFiles;
        state.markedBoxedHandles = markedBoxedHandles;
        state.markedDefectTags = markedDefectTags;
        state.markedCounts = markedCounts;
        state.criticalFiles = await scanCriticalDirectory();
        renderPathTree(false);
        updateHud();
        return;
      }

      async function scanTargetDir(dirH, isBoxed, depth, prefixPath) {
        if (depth > 4) return;
        for await (var entry of dirH.values()) {
          if (entry.kind === 'file') {
            var fname = entry.name;
            var ext = fname.slice(fname.lastIndexOf('.')).toLowerCase();
            if (IMG_EXTS.indexOf(ext) >= 0) {
              // 先查输出清单精确映射，再回退模糊匹配（兼容无清单的旧输出目录）
              var outRel = joinManifestPath(isBoxed ? '缺陷圈示图' : '缺陷原图', prefixPath, fname);
              var mEntry = manifestLookup(outRel);
              var matchedSf = (mEntry && resolveManifestEntry(mEntry)) || findMatchingInputFile(fname);
              if (matchedSf) {
                var matchedKey = fileKey(matchedSf);
                markedFiles.add(matchedKey);
                markedCounts.set(matchedKey, (markedCounts.get(matchedKey) || 0) + 1);
                var dTag = extractDefectTag(matchedSf.name, fname);
                if (dTag && !markedDefectTags.has(matchedKey)) {
                  markedDefectTags.set(matchedKey, dTag);
                }
                if (isBoxed) {
                  markedBoxedHandles.set(matchedKey, entry);
                }
              }
            }
          } else if (entry.kind === 'directory') {
            await scanTargetDir(entry, isBoxed, depth + 1, joinManifestPath(prefixPath, entry.name));
          }
        }
      }

      // 核心：只要存在「缺陷圈示图」目录，即严格以圈示图为唯一权威统计源，绝不额外叠加扫描原图目录造成虚高
      if (boxedDirHandle) {
        await scanTargetDir(boxedDirHandle, true, 0, '');
      } else if (origOutputDirHandle) {
        await scanTargetDir(origOutputDirHandle, false, 0, '');
      }

      state.markedFiles = markedFiles;
      state.markedBoxedHandles = markedBoxedHandles;
      state.markedDefectTags = markedDefectTags;
      state.markedCounts = markedCounts;
      state.criticalFiles = await scanCriticalDirectory();

      // 1. 尝试从输出目录读取备份的 .巡检已看记录.json
      var anyNewViewed = false;
      try {
        var vfhRead = await output.mainHandle.getFileHandle('.巡检已看记录.json', { create: false });
        var vfFile = await vfhRead.getFile();
        var vfText = await vfFile.text();
        if (vfText) {
          var vfObj = JSON.parse(vfText);
          if (vfObj && typeof vfObj === 'object') {
            for (var vk in vfObj) {
              if (vfObj[vk] && !viewedPhotosMap[vk]) {
                viewedPhotosMap[vk] = true;
                anyNewViewed = true;
              }
            }
          }
        }
      } catch (e) {}

      // 2. 缺陷照片必然已经查看过，自动将已标缺陷图片登记到已看集合
      markedFiles.forEach(function (mk) {
        if (!viewedPhotosMap[mk]) {
          viewedPhotosMap[mk] = true;
          anyNewViewed = true;
        }
      });
      if (state.files) {
        for (var mfi = 0; mfi < state.files.length; mfi++) {
          var msf = state.files[mfi];
          if (isFileViewed(msf)) {
            if (markFileViewed(msf)) anyNewViewed = true;
          }
        }
      }
      if (anyNewViewed && typeof saveViewedPhotos === 'function') {
        saveViewedPhotos(true);
      }

      invalidateFilterList();
      renderPathTree(false);
      updateHud();

      // 恢复/同步已标输出目录后，精细化清理状态发生变更的旧缓存（保留不变的纯净原图与圈示图，杜绝全部清空导致的卡顿与黑屏）
      if (state.cache) {
        var keysToEvict = [];
        for (var [k, cachedItem] of state.cache.entries()) {
          var shouldBeBoxed = !!((markedFiles.has(k) || (cachedItem.origName && markedFiles.has(cachedItem.origName))) &&
                                (markedBoxedHandles.has(k) || (cachedItem.origName && markedBoxedHandles.has(cachedItem.origName))));
          if (cachedItem.isBoxed !== shouldBeBoxed) {
            keysToEvict.push(k);
          }
        }
        for (var ki = 0; ki < keysToEvict.length; ki++) {
          var ek = keysToEvict[ki];
          var eItem = state.cache.get(ek);
          if (eItem && eItem.url) {
            try { URL.revokeObjectURL(eItem.url); } catch (e) {}
          }
          state.cache.delete(ek);
        }
      }

      // 如果当前正打开着一张图片，确保最新状态被准确加载并渲染（无论最新是圈示图还是纯净原图，绝不黑屏）
      if (state.index >= 0 && state.files[state.index]) {
        try {
          var curImgObj = await getImage(state.index);
          if (curImgObj && curImgObj.img) {
            var size = getImgSize(curImgObj);
            if (size.w > 0 && size.h > 0) {
              state.natural = { w: size.w, h: size.h };
              var fit = computeFit(size.w, size.h);
              fitView(fit.w, fit.h, fit.s);
              render(curImgObj.img);
              updateHud();
            }
          }
        } catch (e) {}
        schedulePreload(state.index);
      }

      toast('✓ 已从输出目录同步：' + markedFiles.size + ' 张独立缺陷圈示图，' + state.criticalFiles.size + ' 张危急缺陷');
    } catch (err) {
      console.warn('扫描输出目录出错:', err);
    }
  }

  if (btnSyncOutput) {
    btnSyncOutput.addEventListener('click', function () {
      if (!output.mainHandle) {
        selectOutputDir();
        return;
      }
      scanOutputDirectory();
    });
  }
