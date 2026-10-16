// 全局事件绑定、主题/缩放持久化与主程序启动初始化

  /* ================= 主题 / 设置 ================= */

  function applyTheme() {
    document.body.classList.toggle('dark', theme === 'dark');
    themeSwitch.classList.toggle('on', theme === 'dark');
  }


  /* ================= 持久化 ================= */

  function loadPersisted() {
    try { theme = localStorage.getItem(KEY_THEME) || 'light'; } catch (e) {}
    try {
      output.mainName = localStorage.getItem(KEY_OUTPUT_NAME) || '';
      if (output.mainName && outputDirName) outputDirName.textContent = output.mainName;
    } catch (e) {}
    try {
      var savedLeftW = parseInt(localStorage.getItem(KEY_LEFT_WIDTH), 10);
      if (!isNaN(savedLeftW) && savedLeftW >= 240) applyLeftWidth(savedLeftW);
    } catch (e) {}
    try {
      var savedRightW = parseInt(localStorage.getItem(KEY_RIGHT_WIDTH), 10);
      if (!isNaN(savedRightW) && savedRightW >= 220) applyRightWidth(savedRightW);
    } catch (e) {}
    try {
      var savedStroke = parseInt(localStorage.getItem(KEY_STROKE), 10);
      if (!isNaN(savedStroke) && savedStroke >= 2 && savedStroke <= 50) {
        strokeWidth = savedStroke;
      }
    } catch (e) {}
    if (strokeSlider) strokeSlider.value = strokeWidth;
    try {
      savedInputName = localStorage.getItem(KEY_INPUT_NAME) || '';
      if (savedInputName) updateFolderButtonText();
    } catch (e) {}

    loadHidden();
    loadDefectDict();
    loadCriticalDefects();
    loadAdjacency();
    loadViewedPhotos();
    loadAutoCategories();
    loadCandidatePool();
  }


  /* ================= 事件绑定 ================= */

  btnFolder.addEventListener('click', function () {
    if (state.files.length > 0) {
      pickFolder(true); // 已有打开的照片，点击即为更换
    } else {
      pickFolder(false); // 尚未载入，优先恢复记忆目录
    }
  });
  btnFolder.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    pickFolder(true); // 右键强制打开选择器更换目录
  });

  btnEmptyPick.addEventListener('click', function () {
    var hasSaved = !!(savedInputName || (lastInputHandle && lastInputHandle.name));
    pickFolder(hasSaved);
  });
  if (btnEmptyRestore) {
    btnEmptyRestore.addEventListener('click', function () {
      pickFolder(false);
    });
  }

  btnOutput.addEventListener('click', function () { selectOutputDir(); });
  btnOutput.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    pickOutputDir(true).catch(function () {});
  });

  var btnMoreTools = $('btnMoreTools'), moreToolsMenu = $('moreToolsMenu');
  if (btnMoreTools && moreToolsMenu) {
    btnMoreTools.addEventListener('click', function (e) {
      e.stopPropagation();
      var willShow = !moreToolsMenu.classList.contains('show');
      if (willShow) {
        var r = btnMoreTools.getBoundingClientRect();
        moreToolsMenu.style.top = (r.bottom + 4) + 'px';
        moreToolsMenu.style.left = r.left + 'px';
      }
      moreToolsMenu.classList.toggle('show', willShow);
      btnMoreTools.classList.toggle('open', willShow);
    });
    moreToolsMenu.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'BUTTON') {
        moreToolsMenu.classList.remove('show');
        btnMoreTools.classList.remove('open');
      }
    });
    document.addEventListener('click', function (e) {
      if (!moreToolsMenu.contains(e.target) && e.target !== btnMoreTools) {
        moreToolsMenu.classList.remove('show');
        btnMoreTools.classList.remove('open');
      }
    });
  }

  if (btnClearViewedSettings) {
    btnClearViewedSettings.addEventListener('click', async function () {
      var ok = await showConfirmDialog('清空已看记录', '确定要清空所有已看照片记录吗？\n清空后将重置所有杆塔与照片的浏览进度。');
      if (!ok) return;
      viewedPhotosMap = {};
      try { localStorage.removeItem(KEY_VIEWED); } catch (e) {}
      saveViewedPhotos();
      invalidateFilterList();
      refreshTreeStats();
      renderSide();
      toast('✓ 已成功清空所有已看记录');
    });
  }


  /* ================= 首次提示 ================= */

  function initNotice() {
    var noPrompt = false;
    try { noPrompt = localStorage.getItem(KEY_NO_PROMPT) === '1'; } catch (e) {}
    if (noPrompt) return;
    var notice = $('notice');
    notice.classList.add('show');
    function close() {
      notice.classList.remove('show');
      if ($('noPromptCheck').checked) { try { localStorage.setItem(KEY_NO_PROMPT, '1'); } catch (e) {} }
      $('noticeClose').onclick = null; notice.onclick = null;
    }
    $('noticeClose').onclick = close;
    notice.onclick = function (e) { if (e.target === notice) close(); };
  }


  /* ================= 初始化 ================= */

  loadPersisted();
  initResizers();
  applyTheme();
  updateHud();
  initNotice();
  initDirectoryMemory();

// 挂载全局调试命名空间
window.Patrol = {
  state: state,
  render: render,
  toFit: toFit,
  toOriginal: toOriginal,
  switchTo: switchTo,
  stepSwitch: stepSwitch,
  scrollToLastViewedPhoto: scrollToLastViewedPhoto
};
