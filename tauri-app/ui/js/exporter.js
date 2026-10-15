// 双目录保存 (缺陷圈示图+缺陷原图)、危急缺陷保存与清理机制


  /* ================= 一键从「缺陷圈示图」匹配生成「缺陷原图」 ================= */

  async function createOriginalPhotosFromBoxed() {
    if (!state.files || state.files.length === 0) {
      toast('请先点击「选择输入文件夹」载入原始照片');
      return;
    }
    var ok = await ensureOutputDir();
    if (!ok) return;

    var boxedFolderHandle = null;
    try {
      boxedFolderHandle = await output.mainHandle.getDirectoryHandle('缺陷圈示图', { create: false });
    } catch (e) {}

    if (!boxedFolderHandle) {
      toast('当前输出目录下未找到「缺陷圈示图」文件夹');
      return;
    }

    loadingEl.style.display = '';
    try {
      var boxedFiles = [];
      async function collectBoxedFiles(dirH, depth) {
        if (depth > 4) return;
        for await (var entry of dirH.values()) {
          if (entry.kind === 'file') {
            var ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
            if (IMG_EXTS.indexOf(ext) >= 0) {
              boxedFiles.push({ name: entry.name, handle: entry, parentDirName: dirH.name });
            }
          } else if (entry.kind === 'directory') {
            await collectBoxedFiles(entry, depth + 1);
          }
        }
      }
      await collectBoxedFiles(boxedFolderHandle, 0);

      if (boxedFiles.length === 0) {
        toast('「缺陷圈示图」文件夹中未检测到任何图片');
        return;
      }

      var origFolderHandle = await output.mainHandle.getDirectoryHandle('缺陷原图', { create: true });
      var matchedCount = 0;
      var notFoundFiles = [];

      for (var bi = 0; bi < boxedFiles.length; bi++) {
        var bFile = boxedFiles[bi];
        var bName = bFile.name;
        var bExt = bName.slice(bName.lastIndexOf('.')).toLowerCase();
        var bBase = bName.slice(0, bName.lastIndexOf('.'));

        var matchedOrigF = findMatchingInputFile(bName);

        if (matchedOrigF) {
          var cleanBlob = matchedOrigF.file || await matchedOrigF.handle.getFile();
          var subCategory = (bFile.parentDirName === '全绝缘缺陷' || bFile.parentDirName === '其他缺陷')
            ? bFile.parentDirName
            : getDefectCategory(null, null, matchedOrigF.name, bName);
          var subOrigFolderHandle = await origFolderHandle.getDirectoryHandle(subCategory, { create: true });
          var targetOrigHandle = await subOrigFolderHandle.getFileHandle(bName, { create: true });
          var w = await targetOrigHandle.createWritable();
          await w.write(cleanBlob);
          await w.close();

          var mKey = fileKey(matchedOrigF);
          manifestSet('缺陷原图/' + subCategory + '/' + bName, matchedOrigF.name, mKey);
          matchedCount++;
          if (state.markedFiles) {
            state.markedFiles.add(mKey);
          }
          if (state.markedCounts) {
            state.markedCounts.set(mKey, (state.markedCounts.get(mKey) || 0) + 1);
          }
          var dTag = extractDefectTag(matchedOrigF.name, bName);
          if (dTag && state.markedDefectTags) {
            state.markedDefectTags.set(mKey, dTag);
          }
        } else {
          notFoundFiles.push(bName);
        }
      }

      await scanOutputDirectory();

      if (notFoundFiles.length > 0) {
        toast('✓ 已生成 ' + matchedCount + ' 张缺陷原图（有 ' + notFoundFiles.length + ' 张圈示图在输入目录未匹配到原图）');
      } else {
        toast('✓ 成功为全部 ' + matchedCount + ' 张圈示图生成并导入对应的「缺陷原图」！');
      }
    } catch (err) {
      toast('生成缺陷原图失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  if (btnCreateOrigFromBoxed) {
    btnCreateOrigFromBoxed.addEventListener('click', function () {
      createOriginalPhotosFromBoxed();
    });
  }


  /* ================= 规范输出文件夹中的缺陷命名 ================= */

  async function checkAndCleanOutputDefectNames() {
    var ok = await ensureOutputDir();
    if (!ok) return;

    loadingEl.style.display = '';
    try {
      var targetDirNames = ['缺陷圈示图', '缺陷原图', '危急缺陷'];
      var tasks = []; // { dirName, dirHandle, oldName, newName, fileHandle }

      for (var d = 0; d < targetDirNames.length; d++) {
        var dName = targetDirNames[d];
        var dirH = null;
        try {
          dirH = await output.mainHandle.getDirectoryHandle(dName, { create: false });
        } catch (e) {}
        if (!dirH) continue;

        async function scanAndCollect(dh, depth) {
          if (depth > 4) return;
          for await (var entry of dh.values()) {
            if (entry.kind === 'file') {
              var ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
              if (IMG_EXTS.indexOf(ext) >= 0) {
                var cleaned = cleanDefectFileName(entry.name);
                if (cleaned !== entry.name) {
                  tasks.push({
                    dirName: dName,
                    dirHandle: dh,
                    oldName: entry.name,
                    newName: cleaned,
                    fileHandle: entry
                  });
                }
              }
            } else if (entry.kind === 'directory') {
              await scanAndCollect(entry, depth + 1);
            }
          }
        }
        await scanAndCollect(dirH, 0);
      }

      loadingEl.style.display = 'none';

      if (tasks.length === 0) {
        toast('✓ 输出文件夹命名规范，未发现需要修改的模板数字编号');
        return;
      }

      // 生成修改预览清单
      var previewLines = [];
      var seen = new Set();
      for (var i = 0; i < tasks.length; i++) {
        var key = tasks[i].oldName + ' ➔ ' + tasks[i].newName;
        if (!seen.has(key)) {
          seen.add(key);
          previewLines.push((seen.size) + '. ' + key);
        }
      }

      var msg = '在输出文件夹中发现 ' + tasks.length + ' 个文件（' + seen.size + ' 种命名）需要规范化：\n\n' +
                previewLines.slice(0, 10).join('\n') +
                (previewLines.length > 10 ? ('\n... 等共 ' + previewLines.length + ' 项') : '') +
                '\n\n确定要批量执行重命名修改吗？';

      var confirmed = await showConfirmDialog('检查与修改输出命名', msg);
      if (!confirmed) return;

      loadingEl.style.display = '';

      var successCount = 0;
      for (var ti = 0; ti < tasks.length; ti++) {
        var t = tasks[ti];
        try {
          var ok = await safeRenameFileHandle(t.dirHandle, t.fileHandle, t.oldName, t.newName);
          if (ok) {
            successCount++;
            manifestRenameKeyBySuffix(t.dirName, t.oldName, t.newName);
          }
        } catch (renameErr) {
          console.warn('重命名文件失败:', t.oldName, renameErr);
        }
      }

      // 重新全量扫描输出目录并刷新全部统计与列表
      await scanOutputDirectory();

      toast('✓ 成功规范修改了 ' + successCount + ' 个输出缺陷文件的命名！');
    } catch (err) {
      toast('修改输出命名失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  if (btnCleanDefectNames) {
    btnCleanDefectNames.addEventListener('click', function () {
      checkAndCleanOutputDefectNames();
    });
  }


  /* ================= 删除指定原始照片在输出目录中已保存的所有缺陷文件 ================= */

  async function deleteExistingDefectOutputs(origName, onlyDirNames, relPath) {
    if (!origName || !output.mainHandle) return 0;
    var targetDirNames = onlyDirNames || ['缺陷圈示图', '缺陷原图', '危急缺陷'];
    var origExt = origName.slice(origName.lastIndexOf('.')).toLowerCase();
    var origBase = origName.slice(0, origName.lastIndexOf('.'));
    var origInfo = parseFilePrefixAndLocation(origName, relPath || '');
    var targetKey = relPath || origName;
    var isMarked = !!(state.markedFiles && (state.markedFiles.has(targetKey) || state.markedFiles.has(origName)));
    var deletedCount = 0;
    await ensureOutputManifest();

    // 性能优化：优先通过输出清单反查已知关联文件精准删除，未标文件 0ms 瞬间跳过
    var knownRelPaths = [];
    if (outputManifest && outputManifest.entries) {
      for (var outRelKey in outputManifest.entries) {
        var mEnt = outputManifest.entries[outRelKey];
        if (mEnt && (mEnt.relPath === targetKey || mEnt.origName === origName)) {
          knownRelPaths.push(outRelKey);
        }
      }
    }
    if (!isMarked && knownRelPaths.length === 0) {
      return 0;
    }
    if (knownRelPaths.length > 0) {
      for (var ki = 0; ki < knownRelPaths.length; ki++) {
        var outRel = knownRelPaths[ki];
        try {
          var parts = outRel.split('/');
          var currH = output.mainHandle;
          for (var pi = 0; pi < parts.length - 1; pi++) {
            currH = await currH.getDirectoryHandle(parts[pi], { create: false });
          }
          await currH.removeEntry(parts[parts.length - 1]);
          deletedCount++;
        } catch (e) { }
        manifestDelete(outRel);
      }
      return deletedCount;
    }

    async function cleanInDirectory(dh, depth, prefixPath, dirName) {
      if (depth > 4) return;
      var toRemove = [];
      for await (var entry of dh.values()) {
        if (entry.kind === 'file') {
          var fname = entry.name;
          var ext = fname.slice(fname.lastIndexOf('.')).toLowerCase();
          if (ext === origExt) {
            var targetKey = relPath || origName;
            // 先查输出清单精确映射：命中且属于本原图 → 删除；属于其他原图 → 跳过（绝不误删）；未命中 → 回退模糊匹配
            var outRel = joinManifestPath(dirName, prefixPath, fname);
            var mEntry = manifestLookup(outRel);
            if (mEntry) {
              if (mEntry.relPath === targetKey || mEntry.origName === origName) {
                toRemove.push({ name: fname, outRel: outRel });
              }
            } else {
              var matchedInput = findMatchingInputFile(fname);
              if (matchedInput) {
                if (fileKey(matchedInput) === targetKey) {
                  toRemove.push({ name: fname });
                }
              } else {
                var fBase = fname.slice(0, fname.lastIndexOf('.'));
                var customBase = (typeof getCustomBaseName === 'function') ? getCustomBaseName(origName, getMeta(origName)) : '';
                if (customBase && (fBase === customBase || fBase.startsWith(customBase + '_'))) {
                  toRemove.push({ name: fname });
                } else if (fBase === origBase || fBase.startsWith(origBase + '_') || fBase.indexOf('__' + origBase) >= 0) {
                  var fInfo = parseFilePrefixAndLocation(fname, '');
                  if (!origInfo.tower || origInfo.tower === '默认杆塔' || (fInfo.tower && fInfo.tower === origInfo.tower)) {
                    toRemove.push({ name: fname });
                  }
                }
              }
            }
          }
        } else if (entry.kind === 'directory') {
          await cleanInDirectory(entry, depth + 1, joinManifestPath(prefixPath, entry.name), dirName);
        }
      }
      for (var r = 0; r < toRemove.length; r++) {
        try {
          await dh.removeEntry(toRemove[r].name);
          deletedCount++;
          if (toRemove[r].outRel) manifestDelete(toRemove[r].outRel);
        } catch (remErr) {
          console.warn('删除输出文件失败:', toRemove[r].name, remErr);
          // 物理文件已不存在（被外部删除）时同步清理清单残留，避免陈旧映射滞留
          if (toRemove[r].outRel && remErr && (remErr.name === 'NotFoundError' || remErr.name === 'TypeMismatchError')) {
            manifestDelete(toRemove[r].outRel);
          }
        }
      }
    }

    for (var d = 0; d < targetDirNames.length; d++) {
      var dName = targetDirNames[d];
      var dirH = null;
      try {
        if (output.mainHandle.name === dName) {
          dirH = output.mainHandle;
        } else {
          dirH = await output.mainHandle.getDirectoryHandle(dName, { create: false });
        }
      } catch (e) {}
      if (!dirH) continue;
      await cleanInDirectory(dirH, 0, '', dName);
    }
    return deletedCount;
  }

  /* ================= 取消缺陷标记并删除输出目录对应文件 ================= */

  function updateTreeAfterCancel(targetF, origName, fKey, idx) {
    if (!pathTree) return;
    var targetIdx = (idx !== undefined && idx >= 0) ? idx : (state.files ? state.files.indexOf(targetF) : -1);
    var targetItem = targetIdx >= 0 ? pathTree.querySelector('.loc-item[data-idx="' + targetIdx + '"]') : null;
    if (!targetItem && origName) {
      try {
        targetItem = pathTree.querySelector('.loc-item[data-raw-name="' + CSS.escape(origName) + '"]');
      } catch (e) {}
    }
    if (!targetItem) {
      targetItem = pathTree.querySelector('.loc-item.current');
    }

    if (targetItem) {
      // 1. 移除已标徽章与删除按钮
      var markedSpan = targetItem.querySelector('.item-marked-tag');
      if (markedSpan) markedSpan.remove();
      var delBtn = targetItem.querySelector('.btn-cancel-marked-mini');
      if (delBtn) delBtn.remove();

      // 2. 移除缺陷标签文本
      var defectTagSpan = targetItem.querySelector('.item-defect-tag');
      if (defectTagSpan) defectTagSpan.remove();

      // 3. 在“已标记”筛选模式下就地隐藏该节点
      if (filterMode === 'marked') {
        targetItem.style.display = 'none';
      }
    }

    invalidateFilterList();
    refreshTreeStats();
  }

  async function cancelMarkedDefect(target) {
    var origName = '';
    var idx = -1;
    var targetF = null;
    if (typeof target === 'number') {
      idx = target;
      if (state.files && state.files[idx]) {
        targetF = state.files[idx];
        origName = targetF.name;
      }
    } else if (typeof target === 'string') {
      origName = target;
      if (state.files) {
        for (var i = 0; i < state.files.length; i++) {
          if (state.files[i].relPath === origName || fileKey(state.files[i]) === origName) {
            idx = i;
            targetF = state.files[i];
            break;
          }
        }
        if (!targetF) {
          for (var i = 0; i < state.files.length; i++) {
            if (state.files[i].name === origName) {
              idx = i;
              targetF = state.files[i];
              break;
            }
          }
        }
      }
    } else if (target && typeof target === 'object') {
      targetF = target;
      origName = target.name || '';
      if (state.files) idx = state.files.indexOf(target);
    } else {
      targetF = curFile();
      origName = curName();
      idx = state.index;
    }

    if (!origName) {
      toast('未选择任何图片');
      return;
    }

    var fKey = targetF ? fileKey(targetF) : origName;
    var isMarked = !!(state.markedFiles && state.markedFiles.has(fKey));
    if (!isMarked) {
      toast('该图片尚未标记为缺陷图片');
      return;
    }

    var confirmed = await showConfirmDialog(
      '取消标记确认',
      '确定要取消「' + origName + '」的缺陷标记，并从输出目录（缺陷圈示图、缺陷原图与危急缺陷）中删除对应的已保存图片吗？'
    );
    if (!confirmed) return;

    try {
      // 1. 内存中立即同步清除已标状态与标签（0ms 瞬时响应，绝不让用户等待）
      if (state.markedFiles) { state.markedFiles.delete(fKey); }
      if (state.markedBoxedHandles) { state.markedBoxedHandles.delete(fKey); }
      if (state.markedDefectTags) { state.markedDefectTags.delete(fKey); }
      if (state.markedCounts) { state.markedCounts.delete(fKey); }
      if (state.criticalFiles) { state.criticalFiles.delete(fKey); }

      // 2. 清理该照片所有元数据（红框、追加缺陷标签、历史记录、保存标记）
      var m = getMeta(targetF || origName);
      m.saved = false;
      m.boxes = [];
      m.appended = [];
      m.history = [];
      m.isSecondaryEdit = false;
      m.tagsCleared = true;
      selectedIndex = -1;

      // 3. 彻底释放并移除已标记圈示图的显存与解码缓存，防止残留
      var oldC1 = state.cache.get(fKey);
      if (oldC1) { disposeCacheItem(oldC1); state.cache.delete(fKey); }
      var oldC2 = state.cache.get(origName);
      if (oldC2) { disposeCacheItem(oldC2); state.cache.delete(origName); }

      // 4. 清理针对该图片的在途解码 Promise，防止旧圈示图异步返回冲刷纯净原图
      inFlightImagePromises.delete(fKey + '_auto');
      inFlightImagePromises.delete(fKey + '_clean');
      inFlightImagePromises.delete(origName + '_auto');
      inFlightImagePromises.delete(origName + '_clean');

      // 5. 立即切换并瞬时加载/渲染初始纯净大图（零延迟，无需等待磁盘删除和全盘扫描）
      if (idx >= 0) {
        state.index = idx;
        var cleanC = await getImage(idx, true);
        if (cleanC && cleanC.img && ((cleanC.img.naturalWidth > 0) || (cleanC.img.width > 0))) {
          var cnw = cleanC.img.naturalWidth || cleanC.img.width;
          var cnh = cleanC.img.naturalHeight || cleanC.img.height;
          state.natural = { w: cnw, h: cnh };
          var fit = computeFit(cnw, cnh);
          fitView(fit.w, fit.h, fit.s);
          render(cleanC.img);
          renderSide();
          updateHud();
        }
      }

      // 6. 增量更新左侧树节点与统计徽章（O(1)，绝不重构整树，不扰动滚动条）
      updateTreeAfterCancel(targetF, origName, fKey, idx);

      // 7. 异步在后台从输出目录（缺陷圈示图、缺陷原图与危急缺陷）中删除已输出文件，绝不阻塞 UI 与画面刷新
      deleteExistingDefectOutputs(origName, null, targetF ? targetF.relPath : null).then(function (deletedCount) {
        toast('✓ 已成功取消标记，并还原为初始原图（已清理 ' + deletedCount + ' 个输出文件）');
      }).catch(function (delErr) {
        console.warn('删除输出文件警告:', delErr);
      });

    } catch (err) {
      toast('取消标记失败：' + (err && err.message || err));
    }
  }

  /* ================= 物理删除输入文件夹中的原图文件 ================= */

  async function deleteInputPhoto(target) {
    var idx = -1;
    var f = null;
    if (typeof target === 'number') {
      idx = target;
      if (state.files && state.files[idx]) f = state.files[idx];
    } else if (typeof target === 'string') {
      if (state.files) {
        for (var i = 0; i < state.files.length; i++) {
          if (state.files[i].relPath === target || fileKey(state.files[i]) === target || state.files[i].name === target) {
            idx = i;
            f = state.files[i];
            break;
          }
        }
      }
    } else if (target && typeof target === 'object') {
      f = target;
      if (state.files) idx = state.files.indexOf(target);
    } else {
      idx = state.index;
      if (state.files && state.files[idx]) f = state.files[idx];
    }

    if (!f || idx < 0) {
      toast('未选择任何图片');
      return;
    }

    var fileName = f.name;
    var fKey = fileKey(f);

    var confirmed = await showConfirmDialog(
      '删除原图确认',
      '确定要彻底物理删除输入文件夹中的原图文件【' + fileName + '】吗？\n\n此操作将直接从本地磁盘彻底删除该原图且无法撤回（绝不删除或影响已输出的标记结果）。'
    );
    if (!confirmed) return;

    try {
      loadingEl.style.display = '';

      // 严格要求：只会物理删除输入文件夹原图，绝不触碰或删除输出目录中的任何文件
      var deletedFromDisk = false;

      // 方案 A: Tauri 原生 invoke (若句柄有绝对路径)
      if (window.__TAURI__ && window.__TAURI__.invoke && f.handle && f.handle.__path) {
        try {
          await window.__TAURI__.invoke('remove_entry', { path: f.handle.__path, recursive: false });
          deletedFromDisk = true;
        } catch (tErr) {
          console.warn('Tauri remove_entry 异常，尝试句柄方法:', tErr);
        }
      }

      // 方案 B: handle.remove() (现代标准 File System Access API 或 Tauri Shim)
      if (!deletedFromDisk && f.handle && typeof f.handle.remove === 'function') {
        try {
          await f.handle.remove({ recursive: false });
          deletedFromDisk = true;
        } catch (hErr) {
          console.warn('f.handle.remove() 异常，尝试父目录 removeEntry:', hErr);
        }
      }

      // 方案 C: 父目录 dirHandle.removeEntry(fileName)
      if (!deletedFromDisk) {
        var parentPrefix = '';
        if (f.relPath) {
          var sIdx = f.relPath.lastIndexOf('/');
          if (sIdx >= 0) parentPrefix = f.relPath.slice(0, sIdx + 1);
        }
        var dirInfo = dirRegistry ? dirRegistry.get(parentPrefix) : null;
        var dirHandle = dirInfo ? dirInfo.handle : lastInputHandle;
        if (dirHandle && typeof dirHandle.removeEntry === 'function') {
          await dirHandle.removeEntry(fileName);
          deletedFromDisk = true;
        }
      }

      if (!deletedFromDisk) {
        throw new Error('未能定位到可写入的输入文件句柄，磁盘删除未完成');
      }

      // 3. 清理解析与元数据
      if (parsedFileCache) {
        parsedFileCache.delete(f.relPath || f.name);
        parsedFileCache.delete(f.name);
      }
      if (state.meta) {
        state.meta.delete(fKey);
        state.meta.delete(f.name);
      }
      if (viewedPhotosMap) {
        delete viewedPhotosMap[fKey];
        delete viewedPhotosMap[f.name];
        saveViewedPhotos();
      }

      // 4. 清理显存与解码缓存
      var c1 = state.cache.get(fKey);
      if (c1) { disposeCacheItem(c1); state.cache.delete(fKey); }
      var c2 = state.cache.get(f.name);
      if (c2) { disposeCacheItem(c2); state.cache.delete(f.name); }
      inFlightImagePromises.delete(fKey + '_auto');
      inFlightImagePromises.delete(fKey + '_clean');
      inFlightImagePromises.delete(f.name + '_auto');
      inFlightImagePromises.delete(f.name + '_clean');

      // 5. 从 state.files 移除并更新内存索引
      state.files.splice(idx, 1);
      invalidateFilterList();
      state.byName = new Map();
      state.byKey = new Map();
      state.indexByName = new Map();
      state.indexByKey = new Map();
      for (var i = 0; i < state.files.length; i++) {
        var k = fileKey(state.files[i]);
        state.byKey.set(k, state.files[i]);
        state.byName.set(state.files[i].name, state.files[i]);
        state.indexByKey.set(k, i);
        state.indexByName.set(state.files[i].name, i);
      }
      buildInputNameIndex();

      // 6. 增量更新左侧树与统计徽章
      renderPathTree(false);
      refreshTreeStats();

      // 7. 切换至下一张（或最后一张，若全删完则重置回空状态）
      if (state.files.length === 0) {
        state.index = -1;
        selectedIndex = -1;
        if (baseCanvas && baseCtx) baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
        if (overlayCanvas && overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        updateHud();
        renderSide();
      } else {
        var nextIdx = (idx < state.files.length) ? idx : (state.files.length - 1);
        state.index = -1;
        await switchTo(nextIdx, true);
      }

      toast('✓ 已彻底删除输入原图文件：' + fileName);
    } catch (err) {
      console.error('删除输入原图失败:', err);
      toast('删除输入原图失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }
  window.deleteInputPhoto = deleteInputPhoto;


  /* ================= 自动双目录保存：输出一张未圈原图到「缺陷原图」，输出一张已圈图到「缺陷圈示图」 ================= */

  function updateOutputButtonText() {
    var name = (output.mainHandle ? output.mainHandle.name : '') || output.mainName || (lastOutputHandle ? lastOutputHandle.name : '') || '';
    if (output.mainHandle) {
      outputDirName.textContent = output.mainHandle.name;
      outputDirName.style.color = 'var(--ok)';
      btnOutput.title = '当前输出目录：' + output.mainHandle.name + '（已连接，点击更换，右键强制选择）';
    } else if (name) {
      outputDirName.textContent = name + ' (点击连接)';
      outputDirName.style.color = 'var(--warn)';
      btnOutput.title = '上次记忆的输出目录：' + name + '（点击直接恢复连接，右键更换新目录）';
    } else {
      outputDirName.textContent = '未设置';
      outputDirName.style.color = 'var(--accent)';
      btnOutput.title = '点击设置或连接保存输出文件夹';
    }
  }

  async function pickOutputDir(forceNewPicker) {
    if (!window.showDirectoryPicker) {
      toast('需要 Chrome/Edge 且支持 File System Access API');
      return false;
    }

    // 1. 如果不是强制重新选择，且已有记忆句柄但尚未连接，优先恢复该句柄
    if (!forceNewPicker && lastOutputHandle && !output.mainHandle) {
      try {
        var status = await lastOutputHandle.queryPermission({ mode: 'readwrite' });
        if (status !== 'granted') {
          status = await lastOutputHandle.requestPermission({ mode: 'readwrite' });
        }
        if (status === 'granted') {
          output.mainHandle = lastOutputHandle;
          output.mainName = lastOutputHandle.name || '';
          try { localStorage.setItem(KEY_OUTPUT_NAME, output.mainName); } catch (e) {}
          updateOutputButtonText();
          scanOutputDirectory();
          toast('✓ 已连接记忆的输出目录：' + output.mainName);
          return true;
        }
      } catch (e) {
        console.warn('恢复输出目录句柄失败，将打开目录选择器:', e);
      }
    }

    // 2. 弹出系统目录选择器（自动定位在上次输出目录或输入目录）
    var opts = { mode: 'readwrite' };
    if (lastOutputHandle) opts.startIn = lastOutputHandle;
    else if (lastInputHandle) opts.startIn = lastInputHandle;

    var handle = await window.showDirectoryPicker(opts);
    output.mainHandle = handle;
    outputManifest = null;
    if (outputManifestWriteTimer) { clearTimeout(outputManifestWriteTimer); outputManifestWriteTimer = null; }
    output.mainName = handle.name || '';
    lastOutputHandle = handle;
    try { localStorage.setItem(KEY_OUTPUT_NAME, output.mainName); } catch (e) {}
    await saveDirHandle('last_output_handle', handle);
    updateOutputButtonText();
    scanOutputDirectory();
    toast('保存输出目录已设置为：' + output.mainName);
    return true;
  }

  function ensureOutputDir() {
    return new Promise(async function (resolve) {
      if (output.mainHandle) {
        try {
          var status0 = await output.mainHandle.queryPermission({ mode: 'readwrite' });
          if (status0 !== 'granted') {
            status0 = await output.mainHandle.requestPermission({ mode: 'readwrite' });
          }
          if (status0 === 'granted') {
            resolve(true);
            return;
          }
        } catch (e) {}
      }

      // 优先尝试恢复记忆的输出目录
      if (lastOutputHandle) {
        try {
          var status = await lastOutputHandle.queryPermission({ mode: 'readwrite' });
          if (status !== 'granted') {
            status = await lastOutputHandle.requestPermission({ mode: 'readwrite' });
          }
          if (status === 'granted') {
            output.mainHandle = lastOutputHandle;
            output.mainName = lastOutputHandle.name;
            try { localStorage.setItem(KEY_OUTPUT_NAME, output.mainName); } catch (e) {}
            updateOutputButtonText();
            scanOutputDirectory();
            resolve(true);
            return;
          }
        } catch (e) {}
      }

      pickOutputDir(true).then(function (ok) { resolve(!!ok); }).catch(function (err) {
        if (err && err.name === 'AbortError') resolve(false);
        else { toast('选择输出文件夹失败：' + (err && err.message || err)); resolve(false); }
      });
    });
  }

  function selectOutputDir() {
    if (output.mainHandle) {
      // 已经连接，点击允许更换
      pickOutputDir(true).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        toast('更换失败：' + (err && err.message || err));
      });
    } else {
      // 尚未连接，优先恢复连接
      pickOutputDir(false).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        toast('选择失败：' + (err && err.message || err));
      });
    }
  }

  function composite(img, mime, boxes) {
    return new Promise(function (resolve, reject) {
      if (!img) {
        reject(new Error('未提供有效的源图片'));
        return;
      }
      var cv = document.createElement('canvas');
      var nw = img.naturalWidth || img.width || 0;
      var nh = img.naturalHeight || img.height || 0;
      if (!nw || !nh) {
        reject(new Error('源图片尺寸无效(' + nw + 'x' + nh + ')'));
        return;
      }
      cv.width = nw;
      cv.height = nh;
      var ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      if (boxes && boxes.length) {
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'miter';
        for (var i = 0; i < boxes.length; i++) ctx.strokeRect(boxes[i].x, boxes[i].y, boxes[i].w, boxes[i].h);
      }
      var exportMime = (mime === 'image/png') ? 'image/png' : 'image/jpeg';
      var quality = (exportMime === 'image/jpeg') ? 0.95 : undefined;
      cv.toBlob(function (blob) {
        if (blob) resolve({ blob: blob, canvas: cv });
        else reject(new Error('导出图片失败：Canvas生成Blob为空'));
      }, exportMime, quality);
    });
  }

  function markBadgeText(key) {
    var c = (state.markedCounts && state.markedCounts.get(key)) || 0;
    return c > 1 ? ('已标*' + c) : '已标';
  }

  function updateTreeAfterSave(name, dTag, relPath) {
    if (!pathTree) return;
    var curEl = pathTree.querySelector('.loc-item.current');
    if (!curEl) {
      renderPathTree(false);
      return;
    }
    var itemKey = relPath || name;

    // 1. 在当前项徽章中添加或更新“已标”与“删除”按钮
    var badges = curEl.querySelector('.item-status-badges');
    if (!badges) {
      badges = document.createElement('div');
      badges.className = 'item-status-badges';
      curEl.appendChild(badges);
    }
    var markedSpan = badges.querySelector('.item-marked-tag');
    if (!markedSpan) {
      markedSpan = document.createElement('span');
      markedSpan.className = 'item-marked-tag';
      markedSpan.title = '已输出保存为缺陷图片';
      badges.insertBefore(markedSpan, badges.firstChild);
    }
    markedSpan.textContent = markBadgeText(itemKey);

    if (!badges.querySelector('.btn-cancel-marked-mini')) {
      var delBtn = document.createElement('button');
      delBtn.className = 'btn-cancel-marked-mini';
      delBtn.dataset.idx = state.index;
      delBtn.dataset.rawName = itemKey;
      delBtn.title = '取消已标：删除输出目录中该缺陷图片并还原原图';
      delBtn.type = 'button';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2" fill="none" style="display:block"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
      badges.appendChild(delBtn);
    }

    // 2. 在当前项名称后添加或更新缺陷标签
    var nameTextEl = curEl.querySelector('.photo-name-text');
    if (nameTextEl) {
      var existingTag = nameTextEl.querySelector('.item-defect-tag');
      if (dTag) {
        if (existingTag) {
          existingTag.textContent = dTag;
        } else {
          var defectSpan = document.createElement('span');
          defectSpan.className = 'item-defect-tag';
          defectSpan.style.cssText = 'color:var(--accent);font-weight:600';
          defectSpan.textContent = dTag;
          nameTextEl.appendChild(defectSpan);
        }
      } else if (existingTag) {
        existingTag.remove();
      }
    }

    // 3. 联动精准刷新全局与杆塔已标统计
    if (filterMode === 'marked' || filterMode === 'unmarked') {
      renderPathTree(false);
      return;
    }
    refreshTreeStats();
  }

  async function ensureSectionRangeIfBareWire(f, name, m) {
    if (!f) return true;
    var fKey = f.relPath || f.name;
    var isBareWire = (m.appended && m.appended.some(function (t) { return t.indexOf('裸导线') >= 0; }));
    if (!isBareWire) {
      var existingTag = getDefectTagsForFile(fKey) || getDefectTagsForFile(name);
      if (existingTag && existingTag.indexOf('裸导线') >= 0) {
        isBareWire = true;
      }
    }
    if (!isBareWire) return true;

    // 如果选择标签时已经输入过区段（或已有区段值/已确认过），保存时无需二次弹窗，直接复用保存！
    if (m.sectionRange || m.sectionPrompted) return true;

    var parsed = parseFilePrefixAndLocation(name, f.relPath);
    var nextTower = '';
    if (state.files && state.index >= 0 && state.index + 1 < state.files.length) {
      var nextF = state.files[state.index + 1];
      var nextParsed = parseFilePrefixAndLocation(nextF.name, nextF.relPath);
      if (nextParsed && nextParsed.tower && nextParsed.tower !== parsed.tower && nextParsed.tower !== '默认杆塔') {
        nextTower = nextParsed.tower;
      }
    }
    var defaultSec = m.sectionRange || suggestSection(parsed.tower, nextTower);
    var secInput = await showPromptDialog({
      title: '裸导线区段命名',
      desc: '检测到当前标记了「裸导线」缺陷。请输入命名区段（如 #63-1-#63-2 或 #001-#100），将自动替换杆塔号；若保持原名请清空输入框按回车：',
      placeholder: '例如：#63-1-#63-2 或 #001-#100',
      defaultValue: defaultSec
    });
    if (secInput === null) {
      return false; // 用户取消保存
    }
    m.sectionRange = secInput.trim();
    m.sectionPrompted = true;
    renderSide();
    return true;
  }

  async function saveBothFolders() {
    var name = curName();
    if (!name) { toast('未打开任何图片'); return; }
    var ok = await ensureOutputDir();
    if (!ok) return;

    var f = curFile() || (state.files && state.files[state.index]);
    if (!f) { toast('未找到当前图片对象'); return; }
    var fKey = f.relPath || f.name;

    var m = getMeta(f);
    var c = state.cache.get(fKey);
    if (c && c.relPath && f.relPath && c.relPath !== f.relPath) {
      c = null;
    }
    var isBoxedImg = c && c.isBoxed;

    // 当图片未圈或未加缺陷标签时保存弹出提示确认（若底图已是圈示图，视为已有红框）
    var hasBoxes = (m.boxes && m.boxes.length > 0) || isBoxedImg;
    var hasTags = m.appended && m.appended.length > 0;
    if (!hasBoxes || !hasTags) {
      var warnMsg = '';
      if (!hasBoxes && !hasTags) {
        warnMsg = '当前图片【未圈示红框】且【未添加缺陷标签】，确定要直接保存输出吗？';
      } else if (!hasBoxes) {
        warnMsg = '当前图片已添加标签，但【尚未圈示缺陷红框】，确定要直接保存输出吗？';
      } else {
        warnMsg = '当前图片已圈示红框，但【尚未添加缺陷标签】，确定要直接保存输出吗？';
      }
      var confirmed = await showConfirmDialog('保存提示确认', warnMsg);
      if (!confirmed) return;
    }

    // 裸导线区段输入拦截提示
    var secOk = await ensureSectionRangeIfBareWire(f, name, m);
    if (!secOk) return;

    var nv = newNamePreview();
    var outFileName = nv.full;

    loadingEl.style.display = '';
    try {
      // 1. 如果不是二次编辑模式（即常规重新圈示/修改标签/继续圈示覆盖），自动先删掉之前保存的旧文件，直接覆盖旧图；
      //    如果是点击「清除并二次编辑」后的保存，则保留原有已保存图片，独立输出新增缺陷图片！
      var isSecondary = !!m.isSecondaryEdit;
      if (!isSecondary) {
        await deleteExistingDefectOutputs(name, null, f.relPath);
        if (state.criticalFiles) {
          state.criticalFiles.delete(fKey);
        }
      }

      // 2. 判断是否为全绝缘缺陷：缺陷描述带有“绝缘”或“裸导线”
      var dTag = (m.appended && m.appended.length > 0) ? m.appended.join('') : '';
      var subCategory = getDefectCategory(dTag, m.appended, name, outFileName);

      // 3. 准备输出目录：缺陷圈示图、缺陷原图，及其对应的分类子目录（全绝缘缺陷 / 其他缺陷）
      var [boxedFolderHandle, originalFolderHandle] = await Promise.all([
        output.mainHandle.getDirectoryHandle('缺陷圈示图', { create: true }),
        output.mainHandle.getDirectoryHandle('缺陷原图', { create: true })
      ]);
      var [subBoxedFolderHandle, subOrigFolderHandle] = await Promise.all([
        boxedFolderHandle.getDirectoryHandle(subCategory, { create: true }),
        originalFolderHandle.getDirectoryHandle(subCategory, { create: true })
      ]);

      // 4. 判断是否为危急缺陷（匹配模板红色缺陷或人工标记）
      var isCritical = false;
      if (m.isCritical || isCriticalDefectTag(dTag)) {
        isCritical = true;
      }
      for (var ti = 0; ti < (m.appended || []).length; ti++) {
        if (isCriticalDefectTag(m.appended[ti])) {
          isCritical = true;
          break;
        }
      }

      var criticalFolderHandle = null;
      if (isCritical) {
        criticalFolderHandle = await output.mainHandle.getDirectoryHandle('危急缺陷', { create: true });
      }

      var cleanBlob = f.file || await f.handle.getFile();
      var cleanImg = null;
      var cleanUrl = null;
      if (!isBoxedImg && c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0))) {
        cleanImg = c.img;
      } else {
        cleanUrl = URL.createObjectURL(cleanBlob);
        cleanImg = await loadImageElement(cleanUrl);
      }

      // 核心支持：若在已标圈示图上继续圈示，底图以现有的圈示图为基底叠加新绘制的红框，并直接覆盖保存
      var baseImgForComposite = (isBoxedImg && c && c.img) ? c.img : cleanImg;

      var boxedBlob;
      var compositedCanvas = null;
      if (m.boxes.length > 0) {
        var _cr1 = await composite(baseImgForComposite, f.mime, m.boxes);
        boxedBlob = _cr1.blob;
        compositedCanvas = _cr1.canvas;
      } else if (isBoxedImg && c && c.img) {
        var _cr2 = await composite(c.img, f.mime, []);
        boxedBlob = _cr2.blob;
        compositedCanvas = _cr2.canvas;
      } else {
        boxedBlob = cleanBlob;
      }
      if (cleanUrl) {
        try { URL.revokeObjectURL(cleanUrl); } catch (e) {}
      }

      var [targetBoxed, targetOrig] = await Promise.all([
        subBoxedFolderHandle.getFileHandle(outFileName, { create: true }),
        subOrigFolderHandle.getFileHandle(outFileName, { create: true })
      ]);

      async function writeStream(handle, data) {
        var w = await handle.createWritable();
        await w.write(data);
        await w.close();
      }

      var writeTasks = [
        writeStream(targetBoxed, boxedBlob),
        writeStream(targetOrig, cleanBlob)
      ];

      if (isCritical && criticalFolderHandle) {
        var targetCritical = await criticalFolderHandle.getFileHandle(outFileName, { create: true });
        writeTasks.push(writeStream(targetCritical, boxedBlob));
      }

      await Promise.all(writeTasks);

      // 输出清单精确映射：输出文件 → 原图（按整个线路归档清单，非支线）
      var manifestRel = f.relPath || fKey;
      var curLinePfx = (m && m.prefix) || (f && f.prefix) || (nv && nv.full && nv.full.split('_')[0]) || (typeof window !== 'undefined' && window.__ACTIVE_LINE__) || '';
      var wholeLine = (typeof extractWholeLine === 'function') ? extractWholeLine(curLinePfx) : curLinePfx;
      if (typeof window !== 'undefined') window.__ACTIVE_LINE__ = wholeLine;
      manifestSet('缺陷圈示图/' + subCategory + '/' + outFileName, name, manifestRel, wholeLine);
      manifestSet('缺陷原图/' + subCategory + '/' + outFileName, name, manifestRel, wholeLine);
      if (isCritical && criticalFolderHandle) {
        manifestSet('危急缺陷/' + outFileName, name, manifestRel, wholeLine);
      }

      m.saved = true;
      m.boxes = []; // 新圈示已成功合成入图片，清空交互框
      m.isSecondaryEdit = false;

      if (state.markedFiles) {
        state.markedFiles.add(fKey);
      }
      if (state.markedBoxedHandles) {
        state.markedBoxedHandles.set(fKey, targetBoxed);
      }
      if (state.markedDefectTags && dTag) {
        state.markedDefectTags.set(fKey, dTag);
      }
      if (state.markedCounts) {
        if (isSecondary) {
          var prevCount = state.markedCounts.get(fKey) || 1;
          state.markedCounts.set(fKey, prevCount + 1);
        } else {
          state.markedCounts.set(fKey, 1);
        }
      }
      if (isCritical && state.criticalFiles) {
        state.criticalFiles.add(fKey);
      }

      // 保存成功后立即在画布上展示烘焙红框的圈示图（直接复用合成画布回显，砍掉「blob→再次解码」的第三次解码）
      var boxedImg;
      if (compositedCanvas) {
        boxedImg = compositedCanvas;
        state.cache.set(fKey, {
          url: null,
          img: boxedImg,
          origName: name,
          relPath: f.relPath,
          key: fKey,
          isBoxed: true
        });
      } else {
        var boxedUrl = URL.createObjectURL(boxedBlob);
        boxedImg = await loadImageElement(boxedUrl);
        state.cache.set(fKey, {
          url: boxedUrl,
          img: boxedImg,
          origName: name,
          relPath: f.relPath,
          key: fKey,
          isBoxed: true
        });
      }
      var bw = boxedImg.naturalWidth || boxedImg.width || (state.natural ? state.natural.w : 0);
      var bh = boxedImg.naturalHeight || boxedImg.height || (state.natural ? state.natural.h : 0);
      state.natural = { w: bw, h: bh };
      render(boxedImg);
      renderSide();
      invalidateFilterList();
      updateHud();

      // 局部增量刷新已标状态
      updateTreeAfterSave(name, dTag, f.relPath);

      var saveMsg = isCritical
        ? ('已覆盖保存到「缺陷圈示图/' + subCategory + '」、「缺陷原图/' + subCategory + '」与「危急缺陷」 ✓')
        : ('已覆盖保存到「缺陷圈示图/' + subCategory + '」与「缺陷原图/' + subCategory + '」 ✓');
      if (isSecondary) {
        saveMsg = '【二次编辑保存成功】' + saveMsg + '（保留原保存文件）';
      }
      flashSaved(saveMsg);
      toast(isSecondary ? ('✓ 二次编辑保存成功：' + outFileName + ' ➔ ' + subCategory + '（已保留原保存图片）') : ('✓ 已覆盖更新缺陷图片：' + outFileName + ' ➔ ' + subCategory + (isCritical ? ' / 危急缺陷' : '')));
    } catch (err) {
      toast('保存失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }


  /* ================= 危急缺陷：独立保存，仅写入「危急缺陷」文件夹，与「保存缺陷图片」按钮完全无关联 ================= */

  var CRIT_ICON_DEFAULT = '<svg id="btnCriticalIcon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:block"><path d="M12 2 1 21h22L12 2zm0 5.6 7.2 12.4H4.8L12 7.6zM11 10h2v5h-2v-5zm0 6.5h2v2h-2v-2z"/></svg>';
  var CRIT_ICON_SAVED = '<svg id="btnCriticalIcon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.6" fill="none" style="display:block"><path d="M4 12.5l5 5L20 7"/></svg>';

  function updateCriticalButtonState(isSaved) {
    if (!btnCritical) return;
    btnCritical.classList.toggle('saved', !!isSaved);
    btnCritical.innerHTML = (isSaved ? CRIT_ICON_SAVED : CRIT_ICON_DEFAULT) +
      '<span id="btnCriticalLabel" class="label">' + (isSaved ? '已存危急' : '危急缺陷') + '</span>';
    btnCritical.title = isSaved
      ? '已独立保存到「危急缺陷」文件夹。再次点击将用当前圈示图覆盖更新该文件'
      : '独立保存危急缺陷：仅将当前圈示图保存到「危急缺陷」文件夹，与「保存缺陷图片」按钮互不关联、互不影响';
  }

  async function saveCriticalOnly() {
    var name = curName();
    if (!name) { toast('未打开任何图片'); return; }
    var ok = await ensureOutputDir();
    if (!ok) return;

    var f = curFile() || (state.files && state.files[state.index]);
    if (!f) { toast('未找到当前图片对象'); return; }
    var fKey = f.relPath || f.name;

    var m = getMeta(f);
    var c = state.cache.get(fKey);
    if (c && c.relPath && f.relPath && c.relPath !== f.relPath) {
      c = null;
    }
    var isBoxedImg = c && c.isBoxed;

    var hasBoxes = (m.boxes && m.boxes.length > 0) || isBoxedImg;
    if (!hasBoxes) {
      var confirmed = await showConfirmDialog('保存提示确认', '当前图片【尚未圈示红框】，确定要直接将圈示图保存到「危急缺陷」文件夹吗？');
      if (!confirmed) return;
    }

    // 裸导线区段输入拦截提示
    var secOk = await ensureSectionRangeIfBareWire(f, name, m);
    if (!secOk) return;

    var nv = newNamePreview();
    var outFileName = nv.full;

    loadingEl.style.display = '';
    try {
      // 先清理该照片此前独立保存到「危急缺陷」的旧文件（避免改标签/改序号后新旧文件同时残留）
      await deleteExistingDefectOutputs(name, ['危急缺陷'], f.relPath);

      var criticalFolderHandle = await output.mainHandle.getDirectoryHandle('危急缺陷', { create: true });

      var cleanBlob = f.file || await f.handle.getFile();
      var cleanUrl = URL.createObjectURL(cleanBlob);
      var cleanImg = await loadImageElement(cleanUrl);

      var baseImgForComposite = (isBoxedImg && c && c.img) ? c.img : cleanImg;

      var boxedBlob;
      var compositedCanvas = null;
      if (m.boxes.length > 0) {
        var _cr1c = await composite(baseImgForComposite, f.mime, m.boxes);
        boxedBlob = _cr1c.blob;
        compositedCanvas = _cr1c.canvas;
      } else if (isBoxedImg && c && c.img) {
        var _cr2c = await composite(c.img, f.mime, []);
        boxedBlob = _cr2c.blob;
        compositedCanvas = _cr2c.canvas;
      } else {
        boxedBlob = cleanBlob;
      }
      try { URL.revokeObjectURL(cleanUrl); } catch (e) {}

      var targetCritical = await criticalFolderHandle.getFileHandle(outFileName, { create: true });
      var w = await targetCritical.createWritable();
      await w.write(boxedBlob);
      await w.close();

      // 输出清单精确映射：危急缺陷输出文件 → 原图（按整个线路归档）
      var critLinePfx = (m && m.prefix) || (f && f.prefix) || (outFileName && outFileName.split('_')[0]) || (typeof window !== 'undefined' && window.__ACTIVE_LINE__) || '';
      var wholeLineCrit = (typeof extractWholeLine === 'function') ? extractWholeLine(critLinePfx) : critLinePfx;
      manifestSet('危急缺陷/' + outFileName, name, f.relPath || fKey, wholeLineCrit);

      m.saved = true;
      m.boxes = [];
      if (state.criticalFiles) {
        state.criticalFiles.add(fKey);
      }

      var boxedImg;
      if (compositedCanvas) {
        boxedImg = compositedCanvas;
        state.cache.set(fKey, { url: null, img: boxedImg, origName: name, relPath: f.relPath, key: fKey, isBoxed: true });
      } else {
        var boxedUrl = URL.createObjectURL(boxedBlob);
        boxedImg = await loadImageElement(boxedUrl);
        state.cache.set(fKey, { url: boxedUrl, img: boxedImg, origName: name, relPath: f.relPath, key: fKey, isBoxed: true });
      }
      var bw2 = boxedImg.naturalWidth || boxedImg.width || (state.natural ? state.natural.w : 0);
      var bh2 = boxedImg.naturalHeight || boxedImg.height || (state.natural ? state.natural.h : 0);
      state.natural = { w: bw2, h: bh2 };
      render(boxedImg);
      invalidateFilterList();
      updateHud();
      renderSide();

      flashSaved('已保存到「危急缺陷」 ✓');
      toast('✓ 已独立覆盖保存圈示图到「危急缺陷」：' + outFileName);
    } catch (err) {
      toast('保存失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }

  async function cancelCriticalOnly(origName) {
    var f = curFile();
    origName = origName || (f ? f.name : curName());
    if (!origName) { toast('未选择任何图片'); return; }
    var fKey = f ? (f.relPath || f.name) : origName;
    if (!state.criticalFiles || !state.criticalFiles.has(fKey)) {
      toast('该图片尚未独立保存过危急缺陷');
      return;
    }
    var confirmed = await showConfirmDialog(
      '撤回危急缺陷确认',
      '确定要撤回「' + origName + '」的危急缺陷保存吗？将仅从「危急缺陷」文件夹中删除对应文件，不影响「缺陷圈示图」与「缺陷原图」。'
    );
    if (!confirmed) return;

    loadingEl.style.display = '';
    try {
      var deletedCount = await deleteExistingDefectOutputs(origName, ['危急缺陷'], f ? f.relPath : null);
      if (state.criticalFiles) {
        state.criticalFiles.delete(fKey);
      }
      updateHud();
      renderSide();
      toast('✓ 已从「危急缺陷」文件夹删除 ' + deletedCount + ' 个文件');
    } catch (err) {
      toast('撤回失败：' + (err && err.message || err));
    } finally {
      loadingEl.style.display = 'none';
    }
  }


  /* ================= 清除并二次编辑（支持同一照片输出多个不同缺陷） ================= */

  async function clearForSecondaryEdit() {
    var f = curFile();
    var name = curName();
    if (!name || !f) { toast('未打开任何图片'); return; }
    var fKey = f.relPath || f.name;
    var m = getMeta(f);
    m.boxes = [];
    m.appended = [];
    m.history = [];
    m.isSecondaryEdit = true;
    m.tagsCleared = true;
    m.sectionRange = '';
    m.sectionPrompted = false;
    m.saved = false;
    selectedIndex = -1;
    updateTreeCurrentDefectTag(name, '');

    // 二次编辑时切回纯净原图以供重新圈示：彻底释放旧圈示图显存与在途任务
    var oldC1 = fKey ? state.cache.get(fKey) : null;
    if (oldC1) { disposeCacheItem(oldC1); state.cache.delete(fKey); }

    inFlightImagePromises.delete(fKey + '_auto');
    inFlightImagePromises.delete(fKey + '_clean');
    loadingEl.style.display = '';
    try {
      var c = await getImage(state.index, true);
      if (c && c.img) {
        var size = getImgSize(c);
        if (size.w > 0 && size.h > 0) {
          state.natural = { w: size.w, h: size.h };
          var fit = computeFit(size.w, size.h);
          fitView(fit.w, fit.h, fit.s);
          render(c.img);
        }
      }
    } catch (err) {} finally {
      loadingEl.style.display = 'none';
    }

    renderSide(true);
    updateHud();
    toast('✓ 已清除并切换至纯净原图，可重新圈示与选标签（二次保存不会覆盖原有保存）');
  }
