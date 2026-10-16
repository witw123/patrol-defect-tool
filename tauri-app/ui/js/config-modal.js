// 二级配置界面 (部件/分类/词池增删改) 与模板导入导出


  /* ================= 模板导出与导入（复用全套分类与推荐机制） ================= */

  function exportTemplateFile() {
    try {
      var catCount = Object.keys(defectDict).length;
      var recCount = Object.keys(locationAdjacency).length;
      var poolCount = candidatePool.length;
      var now = new Date();
      var dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      var timeStr = now.toLocaleString('zh-CN');

      var template = {
        appName: '巡检缺陷命名分类工具',
        fileType: 'xunjian_defect_template',
        version: '2.2',
        exportTime: timeStr,
        description: '电力巡检缺陷分类标签、危急缺陷属性、推荐机制及候选词池配置文件',
        defectDict: defectDict,
        locationAdjacency: locationAdjacency,
        candidatePool: candidatePool,
        criticalDefects: Array.from(criticalDefects),
        autoCategoryRules: autoCategoryRules
      };

      var jsonStr = JSON.stringify(template, null, 2);
      var blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '巡检缺陷标签与推荐规则模板_' + dateStr + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast('✓ 已导出模板文件（包含 ' + catCount + ' 个分类、' + recCount + ' 条推荐规则、' + poolCount + ' 个候选词）');
    } catch (err) {
      toast('导出模板失败：' + (err && err.message || err));
    }
  }

  function triggerImportTemplate() {
    templateFileInput.value = '';
    templateFileInput.click();
  }

  templateFileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var content = evt.target.result;
        var data = JSON.parse(content);
        if (!data || typeof data !== 'object') {
          toast('文件格式错误：非标准 JSON 模板文件');
          return;
        }
        if (!data.defectDict && !data.locationAdjacency) {
          toast('模板内容无效：未包含缺陷分类或推荐机制数据');
          return;
        }

        pendingImportData = {
          fileName: file.name,
          exportTime: data.exportTime || '未知',
          defectDict: data.defectDict || {},
          locationAdjacency: data.locationAdjacency || {},
          candidatePool: Array.isArray(data.candidatePool) ? data.candidatePool : null,
          criticalDefects: Array.isArray(data.criticalDefects) ? data.criticalDefects : null,
          autoCategoryRules: (data.autoCategoryRules && typeof data.autoCategoryRules === 'object') ? data.autoCategoryRules : null
        };

        var catNum = Object.keys(pendingImportData.defectDict).length;
        var recNum = Object.keys(pendingImportData.locationAdjacency).length;

        importFileName.textContent = file.name;
        importCategoryCount.textContent = catNum + ' 个';
        importAdjacencyCount.textContent = recNum + ' 条';
        importExportTime.textContent = pendingImportData.exportTime;

        importModal.classList.add('show');
      } catch (err) {
        toast('读取模板文件失败：' + (err && err.message || err));
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  function closeImportModal() {
    importModal.classList.remove('show');
    pendingImportData = null;
  }

  btnCancelImport.addEventListener('click', closeImportModal);
  importModal.addEventListener('click', function (e) {
    if (e.target === importModal) closeImportModal();
  });

  btnDoOverwriteImport.addEventListener('click', function () {
    if (!pendingImportData) return;
    defectDict = JSON.parse(JSON.stringify(pendingImportData.defectDict));
    locationAdjacency = JSON.parse(JSON.stringify(pendingImportData.locationAdjacency));
    if (Array.isArray(pendingImportData.criticalDefects)) {
      criticalDefects = new Set(pendingImportData.criticalDefects.map(function (x) { return String(x).trim(); }).filter(Boolean));
    } else {
      criticalDefects = new Set();
      for (var impCat0 in defectDict) {
        var impItems0 = defectDict[impCat0] || [];
        for (var impIdx0 = 0; impIdx0 < impItems0.length; impIdx0++) {
          if (CRITICAL_DEFECT_SET.has(impItems0[impIdx0])) criticalDefects.add(impItems0[impIdx0]);
        }
      }
    }
    // 防止模板中残留已删除标签的危急属性，只保留当前缺陷列表中存在的标签。
    var importedTagSet = new Set();
    for (var impCat1 in defectDict) {
      var impItems1 = defectDict[impCat1] || [];
      for (var impIdx1 = 0; impIdx1 < impItems1.length; impIdx1++) importedTagSet.add(impItems1[impIdx1]);
    }
    criticalDefects = new Set(Array.from(criticalDefects).filter(function (x) { return importedTagSet.has(x); }));
    if (pendingImportData.candidatePool) {
      candidatePool = pendingImportData.candidatePool.slice();
      saveCandidatePool();
    }
    saveDefectDict();
    saveCriticalDefects();
      if (pendingImportData.autoCategoryRules) {
        for (var ac in pendingImportData.autoCategoryRules) {
          if (!autoCategoryRules[ac]) {
            autoCategoryRules[ac] = pendingImportData.autoCategoryRules[ac];
          } else {
            var exTags = autoCategoryRules[ac];
            var imTags = pendingImportData.autoCategoryRules[ac];
            for (var ii = 0; ii < imTags.length; ii++) {
              if (exTags.indexOf(imTags[ii]) < 0) exTags.push(imTags[ii]);
            }
          }
        }
        saveAutoCategories();
      }

    saveAdjacency();
    closeImportModal();
    renderSide();
    if (recommendModal.classList.contains('show')) {
      renderCurrentRecPosDetails();
      renderModalCategoryList();
      renderModalAutoCategoryList();
    }
    toast('✓ 已成功按模板完全覆盖分类、推荐规则与候选词池！');
  });

  btnDoMergeImport.addEventListener('click', function () {
    if (!pendingImportData) return;
    var newCats = 0, newTags = 0, newRules = 0, newPool = 0;

    var impDict = pendingImportData.defectDict;
    var importedCriticalSet = Array.isArray(pendingImportData.criticalDefects) ? new Set(pendingImportData.criticalDefects.map(function (x) { return String(x).trim(); })) : null;
    for (var cat in impDict) {
      if (!defectDict[cat]) {
        defectDict[cat] = impDict[cat].slice();
        newCats++;
      } else {
        var existList = defectDict[cat];
        var toAddList = impDict[cat] || [];
        for (var i = 0; i < toAddList.length; i++) {
          if (existList.indexOf(toAddList[i]) < 0) {
            existList.push(toAddList[i]);
            newTags++;
          }
        }
      }
    }

    // 模板若包含危急属性，则同步导入这些标签的危急设置；未包含该字段的旧模板不改变现有设置。
    if (importedCriticalSet) {
      for (var impCat2 in impDict) {
        var impItems2 = impDict[impCat2] || [];
        for (var impIdx2 = 0; impIdx2 < impItems2.length; impIdx2++) {
          var impTag2 = impItems2[impIdx2];
          if (importedCriticalSet.has(impTag2)) criticalDefects.add(impTag2);
        }
      }
    }

    var impAdj = pendingImportData.locationAdjacency;
    for (var pos in impAdj) {
      if (!locationAdjacency[pos]) {
        locationAdjacency[pos] = impAdj[pos].slice();
        newRules++;
      } else {
        var existRecs = locationAdjacency[pos];
        var toAddRecs = impAdj[pos] || [];
        for (var j = 0; j < toAddRecs.length; j++) {
          if (existRecs.indexOf(toAddRecs[j]) < 0) {
            existRecs.push(toAddRecs[j]);
            newRules++;
          }
        }
      }
    }

    if (pendingImportData.candidatePool) {
      newPool = addCandidatePoolItem(pendingImportData.candidatePool);
    }

    if (pendingImportData.autoCategoryRules) {
      if (!autoCategoryRules) autoCategoryRules = {};
      for (var ac in pendingImportData.autoCategoryRules) {
        if (!autoCategoryRules[ac]) {
          autoCategoryRules[ac] = pendingImportData.autoCategoryRules[ac].slice();
        } else {
          var exTags = autoCategoryRules[ac];
          var imTags = pendingImportData.autoCategoryRules[ac];
          for (var ii = 0; ii < imTags.length; ii++) {
            if (exTags.indexOf(imTags[ii]) < 0) exTags.push(imTags[ii]);
          }
        }
      }
      saveAutoCategories();
    }

    saveDefectDict();
    saveCriticalDefects();
    saveAdjacency();
    closeImportModal();
    renderSide();
    if (recommendModal.classList.contains('show')) {
      renderCurrentRecPosDetails();
      renderModalCategoryList();
      renderModalAutoCategoryList();
    }
    toast('✓ 智能合并完成：新增 ' + newCats + ' 个分类，补充 ' + newTags + ' 个标签与 ' + newRules + ' 条推荐规则！');
  });

  if (btnExportTemplate) btnExportTemplate.addEventListener('click', exportTemplateFile);
  if (btnImportTemplate) btnImportTemplate.addEventListener('click', triggerImportTemplate);
  if (btnExportTemplateSettings) btnExportTemplateSettings.addEventListener('click', function () { settingsPanel.classList.remove('show'); exportTemplateFile(); });
  if (btnImportTemplateSettings) btnImportTemplateSettings.addEventListener('click', function () { settingsPanel.classList.remove('show'); triggerImportTemplate(); });
  if (btnExportRecModal) btnExportRecModal.addEventListener('click', exportTemplateFile);
  if (btnImportRecModal) btnImportRecModal.addEventListener('click', triggerImportTemplate);


  /* ================= 二级配置界面（目标部件增删改、关联分类增删改、分类列表增删改、候选词池增删改） ================= */

  var curEditingRecPos = '';
  var activeModalTab = 'rec'; // 'rec' | 'cat' | 'autocat'

  function setModalTab(tab) {
    activeModalTab = tab;
    tabModalRec.classList.toggle('active', tab === 'rec');
    tabModalCat.classList.toggle('active', tab === 'cat');
    if (tabModalAutoCat) tabModalAutoCat.classList.toggle('active', tab === 'autocat');
    modalViewRec.style.display = tab === 'rec' ? 'flex' : 'none';
    modalViewCat.style.display = tab === 'cat' ? 'flex' : 'none';
    if (modalViewAutoCat) modalViewAutoCat.style.display = tab === 'autocat' ? 'flex' : 'none';
    if (tab === 'cat') renderModalCategoryList();
    if (tab === 'autocat') renderModalAutoCategoryList();
  }

  tabModalRec.addEventListener('click', function () { setModalTab('rec'); });
  tabModalCat.addEventListener('click', function () { setModalTab('cat'); });
  if (tabModalAutoCat) tabModalAutoCat.addEventListener('click', function () { setModalTab('autocat'); });

  function openRecommendModal(targetPos, preferredTab) {
    var allPositions = new Set();
    for (var p in locationAdjacency) allPositions.add(p);
    for (var c in defectDict) allPositions.add(c);
    for (var i = 0; i < candidatePool.length; i++) allPositions.add(candidatePool[i]);

    var posArr = Array.from(allPositions).sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN');
    });

    var curSelected = targetPos || curEditingRecPos || (posArr.length > 0 ? posArr[0] : '');
    if (targetPos && posArr.indexOf(targetPos) < 0) {
      posArr.unshift(targetPos);
      curSelected = targetPos;
    }

    var posHtml = '';
    for (var j = 0; j < posArr.length; j++) {
      var pName = posArr[j];
      var hasRule = !!(locationAdjacency[pName] && locationAdjacency[pName].length > 0);
      var ruleText = hasRule ? ' (' + locationAdjacency[pName].length + '项推荐)' : '';
      posHtml += '<option value="' + esc(pName) + '"' + (pName === curSelected ? ' selected' : '') + '>' + esc(pName) + ruleText + '</option>';
    }
    recPosSelect.innerHTML = posHtml;

    curEditingRecPos = curSelected;
    renderCurrentRecPosDetails();
    setModalTab(preferredTab || 'rec');
    recommendModal.classList.add('show');
  }

  /* ---- 1. 目标部件与关联分类增删改 ---- */

  function renderCurrentRecPosDetails() {
    var pos = recPosSelect.value || curEditingRecPos;
    if (!pos) {
      recTagContainer.innerHTML = '<div style="color:var(--muted);font-size:11.5px;padding:8px">请选择或新建一个目标部件</div>';
      return;
    }
    curEditingRecPos = pos;

    var list = locationAdjacency[pos] || [];
    var html = '';
    if (list.length > 0) {
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        html += '<span class="rec-chip" data-item="' + esc(item) + '"><span>' + esc(item) + '</span><span class="edit-chip" data-item="' + esc(item) + '" title="修改此关联分类名称">' + ICONS.edit + '</span><span class="del-chip" data-item="' + esc(item) + '" title="移除此推荐">' + ICONS.close + '</span></span>';
      }
    } else {
      html += '<div style="color:var(--muted);font-size:12px;padding:8px">暂未配置相近关联推荐，可通过下方添加</div>';
    }
    recTagContainer.innerHTML = html;

    var allCats = getAllKnownCategories();
    var available = [];
    var candidateHtml = '';

    for (var m = 0; m < allCats.length; m++) {
      var candidate = allCats[m];
      if (candidate === pos) continue;
      var isAdded = list.indexOf(candidate) >= 0;
      if (!isAdded) available.push(candidate);

      if (isCandidateManageMode) {
        candidateHtml += '<span class="candidate-pill managing" data-candidate="' + esc(candidate) + '">';
        candidateHtml += '  <span>' + esc(candidate) + '</span>';
        candidateHtml += '  <span class="pill-action edit" data-candidate="' + esc(candidate) + '" title="重命名此候选词">' + ICONS.edit + '</span>';
        candidateHtml += '  <span class="pill-action del" data-candidate="' + esc(candidate) + '" title="从候选池彻底删除">' + ICONS.close + '</span>';
        candidateHtml += '</span>';
      } else {
        candidateHtml += '<span class="candidate-pill' + (isAdded ? ' active' : '') + '" data-cat="' + esc(pos) + '" data-candidate="' + esc(candidate) + '" title="' + (isAdded ? '已关联（点击可直接移除）' : '点击直接关联推荐') + '">' + (isAdded ? (ICONS.check + ' ') : (ICONS.plus + ' ')) + esc(candidate) + '</span>';
      }
    }

    var addOptHtml = '<option value="">-- 从已有选择 --</option>';
    for (var a = 0; a < available.length; a++) {
      addOptHtml += '<option value="' + esc(available[a]) + '">' + esc(available[a]) + '</option>';
    }
    recAddCategorySelect.innerHTML = addOptHtml;
    recCustomAddInput.value = '';

    if (candidatePoolCount) candidatePoolCount.textContent = '(共 ' + allCats.length + ' 个词项)';
    modalCandidateCloud.innerHTML = candidateHtml;
  }

  function closeRecommendModal() {
    recommendModal.classList.remove('show');
    renderSide();
  }

  recPosSelect.addEventListener('change', function () {
    renderCurrentRecPosDetails();
  });

  // 目标部件：增
  btnCreateNewRecPos.addEventListener('click', function () {
    showPromptDialog({
      title: '新建目标部件',
      desc: '请输入新目标部件/规则对象名称：\n（如：避雷针、护栏、隔离开关、跌落式熔断器等）',
      placeholder: '输入部件名称…'
    }).then(function (newPos) {
      if (newPos && newPos.trim()) {
        newPos = newPos.trim();
        if (!locationAdjacency[newPos]) {
          locationAdjacency[newPos] = [];
          saveAdjacency();
        }
        addCandidatePoolItem(newPos);
        openRecommendModal(newPos, 'rec');
        toast('✓ 已新建目标部件规则：【' + newPos + '】');
      }
    });
  });

  // 目标部件：改 (重命名)
  btnRenameCurRecPos.addEventListener('click', function () {
    var curPos = recPosSelect.value;
    if (!curPos) return;
    showPromptDialog({
      title: '重命名目标部件',
      desc: '修改目标部件名称将同步更新推荐规则与分类字典：',
      defaultValue: curPos
    }).then(function (newName) {
      if (newName && newName.trim() && newName.trim() !== curPos) {
        newName = newName.trim();
        var oldList = locationAdjacency[curPos] || [];
        delete locationAdjacency[curPos];
        locationAdjacency[newName] = oldList;

        // 同步更新全局引用
        for (var k in locationAdjacency) {
          var arr = locationAdjacency[k];
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] === curPos) arr[i] = newName;
          }
        }

        renameCandidatePoolItem(curPos, newName);

        if (defectDict[curPos]) {
          defectDict[newName] = defectDict[curPos];
          delete defectDict[curPos];
          saveDefectDict();
        }

        saveAdjacency();
        openRecommendModal(newName, 'rec');
        renderSide();
        toast('✓ 已将目标部件【' + curPos + '】重命名为【' + newName + '】');
      }
    });
  });

  // 目标部件：删
  btnDelCurRecPos.addEventListener('click', function () {
    var curPos = recPosSelect.value;
    if (!curPos) return;
    showConfirmDialog('删除目标部件', '确定要删除目标部件【' + curPos + '】的全部推荐规则吗？').then(function (ok) {
      if (!ok) return;
      delete locationAdjacency[curPos];
      saveAdjacency();
      openRecommendModal('', 'rec');
      renderSide();
      toast('✓ 已删除目标部件【' + curPos + '】的推荐规则');
    });
  });

  // 关联分类：改 (重命名关联分类项) 与 删 (移除关联项)
  recTagContainer.addEventListener('click', function (e) {
    var editChip = e.target.closest('.edit-chip');
    if (editChip) {
      var oldItem = editChip.dataset.item;
      var pos = recPosSelect.value;
      if (pos && oldItem) {
        showPromptDialog({
          title: '修改关联推荐分类',
          defaultValue: oldItem
        }).then(function (newItem) {
          if (newItem && newItem.trim() && newItem.trim() !== oldItem) {
            newItem = newItem.trim();
            var list = locationAdjacency[pos] || [];
            var idx = list.indexOf(oldItem);
            if (idx >= 0) {
              list[idx] = newItem;
              addCandidatePoolItem(newItem);
              saveAdjacency();
              renderCurrentRecPosDetails();
              renderSide();
              toast('✓ 已将推荐项修改为【' + newItem + '】');
            }
          }
        });
      }
      return;
    }

    var delChip = e.target.closest('.del-chip');
    if (delChip) {
      var targetItem = delChip.dataset.item;
      var pos2 = recPosSelect.value;
      if (pos2 && targetItem) {
        removeRecommendationRule(pos2, targetItem);
        renderCurrentRecPosDetails();
        renderSide();
        toast('已从【' + pos2 + '】的推荐中移除【' + targetItem + '】');
      }
    }
  });

  // 关联分类：清空全部
  btnClearAllCurRec.addEventListener('click', function () {
    var pos = recPosSelect.value;
    if (!pos) return;
    showConfirmDialog('清空推荐规则', '确定要清空【' + pos + '】关联的所有推荐分类吗？').then(function (ok) {
      if (!ok) return;
      clearCategoryRecommendations(pos);
      renderCurrentRecPosDetails();
      renderSide();
      toast('✓ 已清空【' + pos + '】的关联推荐');
    });
  });

  /* ---- 候选分类池增、删、改交互实现 ---- */

  // 切换候选词池管理模式
  if (btnToggleCandidateManage) {
    btnToggleCandidateManage.addEventListener('click', function () {
      isCandidateManageMode = !isCandidateManageMode;
      btnToggleCandidateManage.classList.toggle('active', isCandidateManageMode);
      btnToggleCandidateManage.textContent = isCandidateManageMode ? '完成管理' : '管理词池';
      candidatePoolHint.innerHTML = isCandidateManageMode
        ? '<span style="color:var(--accent);font-weight:600">管理模式已开启</span>：点击词项上的修改图标可直接改名，点击删除图标可彻底删除，点击右上角「新增词项」随时添加'
        : '点击下方药丸可直接为当前目标部件添加/移除推荐关联；点击上方「管理词池」可自由改名或删除词项：';
      renderCurrentRecPosDetails();
    });
  }

  // 候选分类池：增
  if (btnAddCandidateItem) {
    btnAddCandidateItem.addEventListener('click', function () {
      showPromptDialog({
        title: '新增候选词项',
        desc: '向候选分类池添加新词项（支持输入多个，用逗号或空格隔开）：\n（例如：避雷针, 氧化锌避雷器, 绝缘横担）',
        placeholder: '输入词项名称…'
      }).then(function (text) {
        if (text && text.trim()) {
          var items = text.split(/[,，、;；\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
          var added = addCandidatePoolItem(items);
          renderCurrentRecPosDetails();
          toast('✓ 已成功向候选分类池添加 ' + added + ' 个新词项！');
        }
      });
    });
  }

  // 候选分类池：恢复默认
  if (btnResetCandidatePool) {
    btnResetCandidatePool.addEventListener('click', function () {
      showConfirmDialog('恢复默认候选词池', '确定要恢复系统默认的候选分类池吗？自定义添加的候选词将被重置。').then(function (ok) {
        if (!ok) return;
        candidatePool = getDefaultCandidatePool();
        saveCandidatePool();
        renderCurrentRecPosDetails();
        toast('✓ 已恢复系统默认候选分类池');
      });
    });
  }

  // 候选池药丸交互（支持点选关联 + 管理模式下改名与删除）
  modalCandidateCloud.addEventListener('click', function (e) {
    var editIcon = e.target.closest('.pill-action.edit');
    if (editIcon) {
      var oldWord = editIcon.dataset.candidate;
      showPromptDialog({
        title: '修改候选分类词',
        defaultValue: oldWord
      }).then(function (newWord) {
        if (newWord && newWord.trim() && newWord.trim() !== oldWord) {
          newWord = newWord.trim();
          renameCandidatePoolItem(oldWord, newWord);
          renderCurrentRecPosDetails();
          renderSide();
          toast('✓ 已将候选词【' + oldWord + '】修改为【' + newWord + '】');
        }
      });
      return;
    }

    var delIcon = e.target.closest('.pill-action.del');
    if (delIcon) {
      var delWord = delIcon.dataset.candidate;
      showConfirmDialog('删除候选词', '确定要从候选分类池中彻底删除【' + delWord + '】吗？').then(function (ok) {
        if (!ok) return;
        removeCandidatePoolItem(delWord);
        renderCurrentRecPosDetails();
        toast('✓ 已从候选池删除【' + delWord + '】');
      });
      return;
    }

    if (isCandidateManageMode) return; // 管理模式下不响应关联点选

    var pill = e.target.closest('.candidate-pill');
    if (pill) {
      var cat = pill.dataset.cat;
      var candidate = pill.dataset.candidate;
      var list = locationAdjacency[cat] || [];
      if (list.indexOf(candidate) >= 0) {
        removeRecommendationRule(cat, candidate);
        toast('已从【' + cat + '】移除【' + candidate + '】');
      } else {
        addRecommendationRule(cat, candidate, recBiDirectionCheck.checked);
        toast('已为【' + cat + '】添加【' + candidate + '】');
      }
      renderCurrentRecPosDetails();
      renderSide();
    }
  });

  // 关联分类：输入框添加 (支持多个以逗号/空格分隔)
  btnDoAddRec.addEventListener('click', function () {
    var pos = recPosSelect.value;
    if (!pos) { toast('请先选择目标部件'); return; }

    var rawInput = (recCustomAddInput.value || '').trim();
    var targets = [];
    if (rawInput) {
      targets = rawInput.split(/[,，、;；\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    } else if (recAddCategorySelect.value) {
      targets = [recAddCategorySelect.value];
    }

    if (targets.length === 0) { toast('请选择或输入要关联推荐的分类名称'); return; }

    var added = addRecommendationRule(pos, targets, recBiDirectionCheck.checked);
    renderCurrentRecPosDetails();
    renderSide();
    toast('已为【' + pos + '】成功添加 ' + added + ' 项关联推荐！');
  });

  btnResetRecDefault.addEventListener('click', function () {
    if (activeModalTab === 'autocat') {
      showConfirmDialog('重置分类库', '确定要恢复默认自动保存分类库吗？\n恢复后将重置为「全绝缘缺陷」与「其他缺陷」默认规则。').then(function (ok) {
        if (!ok) return;
        resetAutoCategories();
        renderModalAutoCategoryList();
        toast('✓ 已恢复默认自动保存分类库');
      });
      return;
    }
    showConfirmDialog('恢复默认推荐图谱', '确定要恢复系统默认的相近关联推荐图谱吗？自定义推荐规则将被重置。').then(function (ok) {
      if (!ok) return;
      locationAdjacency = JSON.parse(JSON.stringify(DEFAULT_LOCATION_ADJACENCY));
      saveAdjacency();
      renderCurrentRecPosDetails();
      renderSide();
      toast('✓ 已恢复系统默认推荐规则');
    });
  });

  /* ---- 2. 缺陷分类总表管理（分类列表与标签增删改） ---- */

  function renderModalCategoryList() {
    var q = (modalCatSearchInput.value || '').trim().toLowerCase();
    var cats = Object.keys(defectDict).sort(function (a, b) {
      return a.localeCompare(b, 'zh-CN');
    });

    var html = '';
    var matchCount = 0;

    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var items = defectDict[cat] || [];

      if (q) {
        var matchCat = cat.toLowerCase().indexOf(q) >= 0;
        var matchItem = items.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
        if (!matchCat && !matchItem) continue;
      }

      html += '<div class="cat-card-modal" data-category="' + esc(cat) + '">';
      html += '  <div class="cat-card-modal-head">';
      html += '    <span>【' + esc(cat) + '】 <span style="font-size:11px;color:var(--muted);font-weight:normal">(' + items.length + '项标签)</span></span>';
      html += '    <div style="display:flex;align-items:center;gap:4px">';
      html += '      <button class="mini-tool-btn modal-add-tag-btn" data-category="' + esc(cat) + '" title="添加新标签">加标签</button>';
      html += '      <button class="mini-tool-btn modal-edit-cat-btn" data-category="' + esc(cat) + '" title="重命名分类">重命名</button>';
      html += '      <button class="mini-tool-btn modal-del-cat-btn" data-category="' + esc(cat) + '" style="color:var(--accent)" title="删除分类">删除</button>';
      html += '    </div>';
      html += '  </div>';

      html += '  <div class="cat-card-modal-body">';
      if (items.length > 0) {
        for (var j = 0; j < items.length; j++) {
          var t = items[j];
          html += '<span class="modal-def-tag" data-category="' + esc(cat) + '" data-tag="' + esc(t) + '">';
          html += '  <span>' + esc(t) + '</span>';
          html += '  <span class="tag-btn-icon modal-edit-tag" data-category="' + esc(cat) + '" data-tag="' + esc(t) + '" title="修改标签名称">' + ICONS.edit + '</span>';
          html += '  <span class="tag-btn-icon modal-del-tag" data-category="' + esc(cat) + '" data-tag="' + esc(t) + '" title="删除此标签">' + ICONS.close + '</span>';
          html += '</span>';
        }
      } else {
        html += '<span style="font-size:11px;color:var(--muted)">暂无缺陷标签，可点击右上角「加标签」添加</span>';
      }
      html += '  </div>';
      html += '</div>';
      matchCount++;
    }

    if (matchCount === 0) {
      html = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:24px 0">未找到符合搜索条件的缺陷分类</div>';
    }

    modalCatListScroll.innerHTML = html;
  }

  modalCatSearchInput.addEventListener('input', renderModalCategoryList);

  // 分类列表：增
  btnModalCreateCat.addEventListener('click', function () {
    showPromptDialog({
      title: '新建缺陷分类',
      placeholder: '如：接地线、护栏、隔离开关…',
      validate: function (v) {
        if (!v || !v.trim()) return '分类名称不能为空';
        if (defectDict[v.trim()]) return '已存在同名分类';
        return null;
      }
    }).then(function (newCat) {
      if (newCat && newCat.trim()) {
        newCat = newCat.trim();
        defectDict[newCat] = [];
        if (!locationAdjacency[newCat]) locationAdjacency[newCat] = [];
        addCandidatePoolItem(newCat);
        saveDefectDict();
        saveAdjacency();
        renderModalCategoryList();
        renderSide();
        toast('✓ 已新建分类：【' + newCat + '】');
      }
    });
  });

  // 分类列表与标签：改 / 删 / 增
  modalCatListScroll.addEventListener('click', function (e) {
    var addTagBtn = e.target.closest('.modal-add-tag-btn');
    if (addTagBtn) {
      var targetCat = addTagBtn.dataset.category;
      showPromptDialog({
        title: '添加缺陷标签',
        desc: '在【' + targetCat + '】分类下新建缺陷标签（下划线开头）：',
        defaultValue: '_' + targetCat + '-',
        placeholder: '如：_' + targetCat + '-螺母松动',
        validate: function (v) {
          if (!v || !v.trim()) return '标签内容不能为空';
          var tag = v.trim();
          if (tag.charAt(0) !== '_') tag = '_' + tag;
          if (defectDict[targetCat] && defectDict[targetCat].indexOf(tag) >= 0) return '该分类下已存在相同标签';
          return null;
        }
      }).then(function (tagText) {
        if (tagText && tagText.trim()) {
          tagText = tagText.trim();
          if (tagText.charAt(0) !== '_') tagText = '_' + tagText;
          if (!defectDict[targetCat]) defectDict[targetCat] = [];
          defectDict[targetCat].push(tagText);
          saveDefectDict();
          renderModalCategoryList();
          renderSide();
          toast('✓ 已添加标签：' + tagText);
        }
      });
      return;
    }

    var editCatBtn = e.target.closest('.modal-edit-cat-btn');
    if (editCatBtn) {
      var oldCat = editCatBtn.dataset.category;
      showPromptDialog({
        title: '重命名分类',
        desc: '修改分类名称将同步更新全局引用：',
        defaultValue: oldCat,
        validate: function (v) {
          if (!v || !v.trim()) return '分类名称不能为空';
          if (v.trim() !== oldCat && defectDict[v.trim()]) return '已存在同名分类';
          return null;
        }
      }).then(function (newName) {
        if (newName && newName.trim() && newName.trim() !== oldCat) {
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
            for (var a = 0; a < arr.length; a++) {
              if (arr[a] === oldCat) arr[a] = newName;
            }
          }

          renameCandidatePoolItem(oldCat, newName);

          saveDefectDict();
          saveAdjacency();
          renderModalCategoryList();
          renderSide();
          toast('✓ 分类已重命名为：【' + newName + '】');
        }
      });
      return;
    }

    var delCatBtn = e.target.closest('.modal-del-cat-btn');
    if (delCatBtn) {
      var delCat = delCatBtn.dataset.category;
      showConfirmDialog('删除分类', '确定要删除分类【' + delCat + '】及其包含的所有缺陷标签吗？').then(function (ok) {
        if (!ok) return;
        var deletedCategoryTags = defectDict[delCat] || [];
        delete defectDict[delCat];
        for (var dcIdx = 0; dcIdx < deletedCategoryTags.length; dcIdx++) {
          criticalDefects.delete(deletedCategoryTags[dcIdx]);
        }
        saveCriticalDefects();
        delete locationAdjacency[delCat];
        for (var k2 in locationAdjacency) {
          var arr2 = locationAdjacency[k2];
          var iIdx2 = arr2.indexOf(delCat);
          if (iIdx2 >= 0) arr2.splice(iIdx2, 1);
        }
        removeCandidatePoolItem(delCat);
        saveDefectDict();
        saveAdjacency();
        renderModalCategoryList();
        renderSide();
        toast('✓ 已删除分类：【' + delCat + '】');
      });
      return;
    }

    var editTagBtn = e.target.closest('.modal-edit-tag');
    if (editTagBtn) {
      var cat = editTagBtn.dataset.category;
      var oldTag = editTagBtn.dataset.tag;
      showPromptDialog({
        title: '修改缺陷标签',
        desc: '修改【' + cat + '】下的标签名称：',
        defaultValue: oldTag,
        validate: function (v) {
          if (!v || !v.trim()) return '标签名称不能为空';
          return null;
        }
      }).then(function (newTag) {
        if (newTag && newTag.trim() && newTag.trim() !== oldTag) {
          newTag = newTag.trim();
          if (newTag.charAt(0) !== '_') newTag = '_' + newTag;
          if (defectDict[cat]) {
            var idx = defectDict[cat].indexOf(oldTag);
            if (idx >= 0) defectDict[cat][idx] = newTag;
            saveDefectDict();
            renderModalCategoryList();
            renderSide();
            toast('✓ 标签已更新为：' + newTag);
          }
        }
      });
      return;
    }

    var delTagBtn = e.target.closest('.modal-del-tag');
    if (delTagBtn) {
      var cat2 = delTagBtn.dataset.category;
      var dTag = delTagBtn.dataset.tag;
      showConfirmDialog('删除标签', '确定要删除标签【' + dTag + '】吗？').then(function (ok) {
        if (!ok) return;
        if (defectDict[cat2]) {
          var idx2 = defectDict[cat2].indexOf(dTag);
          if (idx2 >= 0) defectDict[cat2].splice(idx2, 1);
          saveDefectDict();
          renderModalCategoryList();
          renderSide();
          toast('✓ 已删除标签：' + dTag);
        }
      });
      return;
    }
  });

  btnCloseRecModalTop.addEventListener('click', closeRecommendModal);
  btnCloseRecModal.addEventListener('click', closeRecommendModal);
  recommendModal.addEventListener('click', function (e) {
    if (e.target === recommendModal) closeRecommendModal();
  });


  /* ================= 自动保存分类库增删改 UI 实现 ================= */

  function renderModalAutoCategoryList() {
    if (!modalAutoCatListScroll) return;
    var filterQ = (modalAutoCatSearchInput && modalAutoCatSearchInput.value || '').trim().toLowerCase();
    var rules = autoCategoryRules || DEFAULT_AUTO_CATEGORIES;
    var cats = Object.keys(rules);

    var html = '';
    var matchCount = 0;

    for (var i = 0; i < cats.length; i++) {
      var cat = cats[i];
      var tags = rules[cat] || [];

      if (filterQ) {
        var matchCat = cat.toLowerCase().indexOf(filterQ) >= 0;
        var matchTag = tags.some(function (t) { return (t || '').toLowerCase().indexOf(filterQ) >= 0; });
        if (!matchCat && !matchTag) continue;
      }

      var isDefault = (tags.length === 0);
      var tagCountDesc = isDefault ? '兜底分类 · 未命中其它分类时自动保存至此' : (tags.length + ' 项匹配标签');

      html += '<div class="cat-card-modal" data-autocat="' + esc(cat) + '">';
      html += '  <div class="cat-card-modal-head">';
      html += '    <span><b>【' + esc(cat) + '】</b> <span style="font-size:11px;color:var(--muted);font-weight:normal">(' + tagCountDesc + ')</span></span>';
      html += '    <div style="display:flex;align-items:center;gap:4px">';
      html += '      <button class="mini-tool-btn modal-add-autotag-btn" data-autocat="' + esc(cat) + '" title="为该分类添加匹配关键词标签">加标签</button>';
      html += '      <button class="mini-tool-btn modal-edit-autocat-btn" data-autocat="' + esc(cat) + '" title="重命名该分类名称">重命名</button>';
      if (cats.length > 1) {
        html += '      <button class="mini-tool-btn modal-del-autocat-btn" data-autocat="' + esc(cat) + '" style="color:var(--accent)" title="删除该分类">删除</button>';
      }
      html += '    </div>';
      html += '  </div>';

      html += '  <div class="cat-card-modal-body">';
      if (tags.length > 0) {
        for (var ti = 0; ti < tags.length; ti++) {
          var tag = tags[ti];
          html += '<span class="modal-def-tag" data-autocat="' + esc(cat) + '" data-autotag="' + esc(tag) + '">';
          html += '  <span>' + esc(tag) + '</span>';
          html += '  <span class="tag-btn-icon modal-edit-autotag" data-autocat="' + esc(cat) + '" data-autotag="' + esc(tag) + '" title="修改此匹配标签">' + ICONS.edit + '</span>';
          html += '  <span class="tag-btn-icon modal-del-autotag" data-autocat="' + esc(cat) + '" data-autotag="' + esc(tag) + '" title="删除此匹配标签">' + ICONS.close + '</span>';
          html += '</span>';
        }
      } else {
        html += '<span style="font-size:11px;color:var(--muted)">暂无特定匹配标签（作为默认兜底输出目录；点击右上角「加标签」可添加匹配规则）</span>';
      }
      html += '  </div>';
      html += '</div>';
      matchCount++;
    }

    if (matchCount === 0) {
      html = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:24px 0">未找到符合搜索条件的自动保存分类</div>';
    }

    modalAutoCatListScroll.innerHTML = html;
  }


  if (btnOpenAutoCatSettings) {
    btnOpenAutoCatSettings.addEventListener('click', function () {
      openRecommendModal('', 'autocat');
    });
  }

  if (modalAutoCatSearchInput) {
    modalAutoCatSearchInput.addEventListener('input', renderModalAutoCategoryList);
  }

  // 新建自动保存分类
  if (btnModalCreateAutoCat) {
    btnModalCreateAutoCat.addEventListener('click', function () {
      showPromptDialog({
        title: '新建自动保存分类',
        desc: '新建保存子目录分类名称（如：全绝缘缺陷、其他缺陷、通道缺陷、金具缺陷等）：',
        placeholder: '输入分类名称…',
        validate: function (v) {
          if (!v || !v.trim()) return '分类名称不能为空';
          var name = v.trim();
          if (autoCategoryRules && autoCategoryRules[name] !== undefined) return '已存在同名分类';
          var invalidPattern = new RegExp('[/\\:*?"<>|]');
          if (invalidPattern.test(name)) return '分类名称不能包含 \ / : * ? " < > | 字符';
          return null;
        }
      }).then(function (newCat) {
        if (newCat && newCat.trim()) {
          newCat = newCat.trim();
          if (!autoCategoryRules) autoCategoryRules = {};
          autoCategoryRules[newCat] = [];
          saveAutoCategories();
          renderModalAutoCategoryList();
          toast('✓ 已新建自动保存分类：【' + newCat + '】');
        }
      });
    });
  }

  // 恢复默认分类库
  if (btnResetAutoCatDefault) {
    btnResetAutoCatDefault.addEventListener('click', function () {
      showConfirmDialog('重置分类库', '确定要恢复默认自动保存分类库吗？\n恢复后将重置为「全绝缘缺陷」与「其他缺陷」默认规则。').then(function (ok) {
        if (!ok) return;
        resetAutoCategories();
        renderModalAutoCategoryList();
        toast('✓ 已恢复默认自动保存分类库');
      });
    });
  }

  // 分类卡片内的标签增、改、删与分类重命名、删除（事件委托）
  if (modalAutoCatListScroll) {
    modalAutoCatListScroll.addEventListener('click', function (e) {
      // 1. 添加标签
      var addTagBtn = e.target.closest('.modal-add-autotag-btn');
      if (addTagBtn) {
        var cat = addTagBtn.dataset.autocat;
        showPromptDialog({
          title: '添加分类匹配标签',
          desc: '在【' + cat + '】下添加触发此分类的缺陷描述关键词（支持输入多个，用逗号或空格隔开）：',
          placeholder: '如：绝缘、裸导线、接地…',
          validate: function (v) {
            if (!v || !v.trim()) return '标签关键词不能为空';
            return null;
          }
        }).then(function (tagText) {
          if (tagText && tagText.trim()) {
            var rawList = tagText.trim().split(/[,，\s]+/);
            if (!autoCategoryRules[cat]) autoCategoryRules[cat] = [];
            var addedCount = 0;
            for (var ri = 0; ri < rawList.length; ri++) {
              var item = rawList[ri].trim();
              if (item && autoCategoryRules[cat].indexOf(item) < 0) {
                autoCategoryRules[cat].push(item);
                addedCount++;
              }
            }
            if (addedCount > 0) {
              saveAutoCategories();
              renderModalAutoCategoryList();
              toast('✓ 已为【' + cat + '】添加 ' + addedCount + ' 个匹配标签');
            } else {
              toast('所输入的标签已存在');
            }
          }
        });
        return;
      }

      // 2. 重命名分类
      var editCatBtn = e.target.closest('.modal-edit-autocat-btn');
      if (editCatBtn) {
        var oldCat = editCatBtn.dataset.autocat;
        showPromptDialog({
          title: '重命名自动保存分类',
          desc: '修改分类名称：',
          defaultValue: oldCat,
          validate: function (v) {
            if (!v || !v.trim()) return '分类名称不能为空';
            var name = v.trim();
            if (name !== oldCat && autoCategoryRules && autoCategoryRules[name] !== undefined) return '已存在同名分类';
            var invalidPattern = new RegExp('[/\\:*?"<>|]');
            if (invalidPattern.test(name)) return '分类名称不能包含 \ / : * ? " < > | 字符';
            return null;
          }
        }).then(function (newName) {
          if (newName && newName.trim() && newName.trim() !== oldCat) {
            newName = newName.trim();
            var tags = autoCategoryRules[oldCat] || [];
            delete autoCategoryRules[oldCat];
            autoCategoryRules[newName] = tags;
            saveAutoCategories();
            renderModalAutoCategoryList();
            toast('✓ 分类已重命名为：【' + newName + '】');
          }
        });
        return;
      }

      // 3. 删除分类
      var delCatBtn = e.target.closest('.modal-del-autocat-btn');
      if (delCatBtn) {
        var delCat = delCatBtn.dataset.autocat;
        showConfirmDialog('删除分类', '确定要删除自动保存分类【' + delCat + '】及其所有匹配标签吗？').then(function (ok) {
          if (!ok) return;
          delete autoCategoryRules[delCat];
          if (Object.keys(autoCategoryRules).length === 0) {
            autoCategoryRules['其他缺陷'] = [];
          }
          saveAutoCategories();
          renderModalAutoCategoryList();
          toast('✓ 已删除分类：【' + delCat + '】');
        });
        return;
      }

      // 4. 编辑单个标签
      var editTagBtn = e.target.closest('.modal-edit-autotag');
      if (editTagBtn) {
        var cat4 = editTagBtn.dataset.autocat;
        var oldTag = editTagBtn.dataset.autotag;
        showPromptDialog({
          title: '修改匹配标签',
          desc: '在【' + cat4 + '】下修改标签关键词：',
          defaultValue: oldTag,
          validate: function (v) {
            if (!v || !v.trim()) return '标签关键词不能为空';
            return null;
          }
        }).then(function (newTag) {
          if (newTag && newTag.trim() && newTag.trim() !== oldTag) {
            newTag = newTag.trim();
            var list = autoCategoryRules[cat4] || [];
            var tidx = list.indexOf(oldTag);
            if (tidx >= 0) {
              list[tidx] = newTag;
              saveAutoCategories();
              renderModalAutoCategoryList();
              toast('✓ 已将标签修改为【' + newTag + '】');
            }
          }
        });
        return;
      }

      // 5. 删除单个标签
      var delTagBtn = e.target.closest('.modal-del-autotag');
      if (delTagBtn) {
        var cat5 = delTagBtn.dataset.autocat;
        var targetTag = delTagBtn.dataset.autotag;
        var list5 = autoCategoryRules[cat5] || [];
        var tidx5 = list5.indexOf(targetTag);
        if (tidx5 >= 0) {
          list5.splice(tidx5, 1);
          saveAutoCategories();
          renderModalAutoCategoryList();
          toast('✓ 已从【' + cat5 + '】中移除标签【' + targetTag + '】');
        }
        return;
      }
    });
  }
