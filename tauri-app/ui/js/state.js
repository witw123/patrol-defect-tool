// 全局状态管理、DOM 元素缓存池与侧栏拖拽调宽


  /* ================= 状态 ================= */

  var state = {
    mode: null,
    files: [],            // {name, handle, file, mime, relPath, group}
    byName: new Map(),
    byKey: new Map(),
    indexByName: new Map(),
    indexByKey: new Map(),
    index: -1,
    meta: new Map(),      // name -> {boxes:[], appended:[], history:[], saved:false}
    cache: new Map(),     // name -> {url, img}
    view: { w: 0, h: 0, s: 1, zoom: 1, panX: 0, panY: 0, cx: 0, cy: 0 },
    natural: { w: 0, h: 0 },
    navBusy: false,
    markedFiles: new Set(),         // 输出目录中已标记保存的照片原始文件名
    markedBoxedHandles: new Map(),  // 原文件名 -> 缺陷圈示图 FileSystemFileHandle 句柄
    markedDefectTags: new Map(),    // 原文件名 -> 已标记保存的缺陷标签文本（如 '_导线断股'）
    criticalFiles: new Set(),       // 已独立保存过「危急缺陷」的原始文件名（与 markedFiles 完全独立统计）
    markedCounts: new Map(),        // 原文件名 -> 已标记保存的次数（同一照片二次编辑输出多个缺陷时递增）
    discoveredDirs: [],              // 扫描过程中发现的所有子目录路径集合（包含空文件夹，确保杆塔数100%匹配实际文件夹数）
    leafDirs: null,                  // 预计算的叶子目录缓存（避免每次统计O(N^2)）
    lastViewedIndex: -1              // 最后一个已看照片的索引（避免每次updateHud O(N)倒查）
  };
  var output = { mainHandle: null, mainName: '' };
  var defectDict = JSON.parse(JSON.stringify(DEFAULT_DEFECT_DICT)); // 动态缺陷字典：category -> [texts]
  var locationAdjacency = JSON.parse(JSON.stringify(DEFAULT_LOCATION_ADJACENCY)); // 动态关联推荐图谱
  var candidatePool = [];          // 动态可增删改的候选分类词池
  var isCandidateManageMode = false; // 是否处于候选词池管理（增删改）模式
  var hiddenDefects = {};          // 被隐藏的缺陷名 -> true
  var criticalDefects = new Set(CRITICAL_DEFECTS); // 用户可自定义的危急缺陷标签集合，默认沿用系统模板
  var viewedPhotosMap = {};        // 已浏览查看过的照片文件名映射 -> true
  var filterMode = 'all';          // 'all' | 'marked' | 'unmarked' | 'unviewed'
  var collapsedGroups = new Set(); // 折叠的前缀分组名称集合
  var collapsedTowers = new Set(); // 折叠的杆塔分组标识集合
  var lastActiveTowerKey = null;   // 当前激活展开的杆塔唯一键 (prefix:::tower)
  var lastActivePrefix = null;     // 当前激活展开的线路前缀
  var lastActiveTowerEl = null;    // 当前激活展开的杆塔 DOM 元素缓存
  var lastActivePrefixEl = null;   // 当前激活展开的线路 DOM 元素缓存
  var lastActiveLocItemEl = null;  // 当前选中的左侧列表项 DOM 元素缓存
  var lastTreeScrollTime = 0;      // 记录上次左侧树平滑滚动的时间戳，用于快切降级
  var dirRegistry = new Map();     // relDirPath -> { handle, parentHandle, name } 文件夹句柄注册表
  var theme = 'light';
  var leftWidth = 320, rightWidth = 310;


  /* ================= DOM ================= */

  var btnFolder = $('btnFolder'), btnEmptyPick = $('btnEmptyPick');
  var inputFolderBtnText = $('inputFolderBtnText');
  var btnEmptyRestore = $('btnEmptyRestore'), emptyRestoreDirName = $('emptyRestoreDirName');
  var btnOutput = $('btnOutput'), outputDirName = $('outputDirName'), btnCreateOrigFromBoxed = $('btnCreateOrigFromBoxed'), btnCleanDefectNames = $('btnCleanDefectNames');
  var strokeSlider = $('strokeSlider'), strokeVal = $('strokeVal');
  var searchInput = $('searchInput'), searchClear = $('searchClear');
  var btnExportTemplate = $('btnExportTemplate'), btnImportTemplate = $('btnImportTemplate');
  var btnPrev = $('btnPrev'), btnNext = $('btnNext');
  var counter = $('counter'), groupTag = $('groupTag'), filenameEl = $('filename');
  var dirtyDot = $('dirtyDot'), savedFlash = $('savedFlash');
  var viewer = $('viewer'), stageContainer = $('stageContainer'), stage = $('stage');
  var viewerBottomBar = $('viewerBottomBar'), previewEl = $('preview'), btnBottomSave = $('btnBottomSave'), btnClearSecondary = $('btnClearSecondary'), btnCritical = $('btnCritical');
  var pathPanel = $('pathPanel'), pathTree = $('pathTree'), dirSummaryText = $('dirSummaryText'), btnBackToCurrent = $('btnBackToCurrent');
  var btnSyncOutput = $('btnSyncOutput'), lineSearchInput = $('lineSearchInput'), lineSearchClear = $('lineSearchClear'), dirSummaryLineCount = $('dirSummaryLineCount'), lineSearchDropdown = $('lineSearchDropdown');
  var btnFilterAll = $('btnFilterAll'), btnFilterMarked = $('btnFilterMarked');
  var btnFilterUnmarked = $('btnFilterUnmarked'), btnFilterUnviewed = $('btnFilterUnviewed');
  var sideCurLine = $('sideCurLine'), sideCurTower = $('sideCurTower'), sideCurLoc = $('sideCurLoc');
  var sideCurMarkedStatus = $('sideCurMarkedStatus'), sideCurViewedStatus = $('sideCurViewedStatus'), sideCurCriticalStatus = $('sideCurCriticalStatus');
  var leftResizer = $('leftResizer'), rightResizer = $('rightResizer'), side = $('side');
  var btnExpandAll = $('btnExpandAll'), btnCollapseAll = $('btnCollapseAll'), btnAutoFit = $('btnAutoFit');
  var baseCanvas = $('baseCanvas'), overlayCanvas = $('overlayCanvas');
  var baseCtx = baseCanvas.getContext('2d');
  var overlayCtx = overlayCanvas.getContext('2d');
  var empty = $('empty'), loadingEl = $('loading'), toastEl = $('toast');
  var sideScroll = $('sideScroll');
  var btnSettings = $('btnSettings'), settingsPanel = $('settingsPanel'), themeSwitch = $('themeSwitch');
  var btnOpenRecSettings = $('btnOpenRecSettings'), btnResetDefects = $('btnResetDefects'), btnClearViewedSettings = $('btnClearViewedSettings');
  var btnExportTemplateSettings = $('btnExportTemplateSettings'), btnImportTemplateSettings = $('btnImportTemplateSettings');
  var fileInput = $('fileInput'), templateFileInput = $('templateFileInput');

  // 二级界面：推荐规则与分类列表配置弹窗 DOM
  var recommendModal = $('recommendModal');
  var tabModalRec = $('tabModalRec'), tabModalCat = $('tabModalCat'), tabModalAutoCat = $('tabModalAutoCat');
  var modalViewAutoCat = $('modalViewAutoCat'), modalAutoCatSearchInput = $('modalAutoCatSearchInput');
  var btnModalCreateAutoCat = $('btnModalCreateAutoCat'), btnResetAutoCatDefault = $('btnResetAutoCatDefault');
  var modalAutoCatListScroll = $('modalAutoCatListScroll'), btnOpenAutoCatSettings = $('btnOpenAutoCatSettings');
  var autoCategoryRules = (typeof DEFAULT_AUTO_CATEGORIES !== 'undefined') ? JSON.parse(JSON.stringify(DEFAULT_AUTO_CATEGORIES)) : {};
  var btnCloseRecModalTop = $('btnCloseRecModalTop'), btnCloseRecModal = $('btnCloseRecModal');
  var modalViewRec = $('modalViewRec'), modalViewCat = $('modalViewCat');
  
  // 目标部件与推荐关联 DOM
  var recPosSelect = $('recPosSelect'), btnCreateNewRecPos = $('btnCreateNewRecPos');
  var btnRenameCurRecPos = $('btnRenameCurRecPos'), btnDelCurRecPos = $('btnDelCurRecPos');
  var recTagContainer = $('recTagContainer'), btnClearAllCurRec = $('btnClearAllCurRec');
  var recAddCategorySelect = $('recAddCategorySelect'), recCustomAddInput = $('recCustomAddInput');
  var btnDoAddRec = $('btnDoAddRec'), recBiDirectionCheck = $('recBiDirectionCheck');

  // 候选分类池增删改 DOM
  var modalCandidateCloud = $('modalCandidateCloud'), candidatePoolCount = $('candidatePoolCount');
  var btnAddCandidateItem = $('btnAddCandidateItem'), btnToggleCandidateManage = $('btnToggleCandidateManage');
  var btnResetCandidatePool = $('btnResetCandidatePool'), candidatePoolHint = $('candidatePoolHint');

  var btnResetRecDefault = $('btnResetRecDefault');
  var btnExportRecModal = $('btnExportRecModal'), btnImportRecModal = $('btnImportRecModal');

  // 缺陷分类总表二级管理 DOM
  var modalCatSearchInput = $('modalCatSearchInput'), btnModalCreateCat = $('btnModalCreateCat');
  var modalCatListScroll = $('modalCatListScroll');

  // 导入确认弹窗相关 DOM
  var importModal = $('importModal');
  var importFileName = $('importFileName'), importCategoryCount = $('importCategoryCount');
  var importAdjacencyCount = $('importAdjacencyCount'), importExportTime = $('importExportTime');
  var btnCancelImport = $('btnCancelImport'), btnDoMergeImport = $('btnDoMergeImport'), btnDoOverwriteImport = $('btnDoOverwriteImport');
  var pendingImportData = null;


  /* ================= 左右边栏拖拽调宽与智能自适应 ================= */

  function recomputeViewerStage() {
    if (typeof invalidateCanvasRect === 'function') invalidateCanvasRect();
    if (state.index >= 0) {
      var key = curKey();
      var c = key ? state.cache.get(key) : null;
      if (c && c.img && ((c.img.naturalWidth > 0) || (c.img.width > 0))) {
        var nw = c.img.naturalWidth || c.img.width;
        var nh = c.img.naturalHeight || c.img.height;
        var fit = computeFit(nw, nh);
        fitView(fit.w, fit.h, fit.s);
        render();
      }
    }
  }

  function applyLeftWidth(w) {
    var minW = 240;
    var maxW = Math.max(minW, window.innerWidth - (rightWidth + 240));
    leftWidth = Math.min(maxW, Math.max(minW, Math.round(w)));
    pathPanel.style.width = leftWidth + 'px';
    pathPanel.style.flex = '0 0 ' + leftWidth + 'px';
    try { localStorage.setItem(KEY_LEFT_WIDTH, String(leftWidth)); } catch (e) {}
    recomputeViewerStage();
  }

  function applyRightWidth(w) {
    var minW = 240;
    var maxW = Math.max(minW, window.innerWidth - (leftWidth + 240));
    rightWidth = Math.min(maxW, Math.max(minW, Math.round(w)));
    side.style.width = rightWidth + 'px';
    side.style.flex = '0 0 ' + rightWidth + 'px';
    try { localStorage.setItem(KEY_RIGHT_WIDTH, String(rightWidth)); } catch (e) {}
    recomputeViewerStage();
  }

  function autoFitLeftPanelWidth() {
    if (!state.files || state.files.length === 0) return;
    
    var cv = document.createElement('canvas');
    var ctx = cv.getContext('2d');
    var maxW = 280;

    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      var info = parseFilePrefixAndLocation(f.name, f.relPath);

      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      var pfxW = ctx.measureText(info.prefix).width + 195;
      if (pfxW > maxW) maxW = pfxW;

      ctx.font = '600 11.5px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      var twrW = ctx.measureText('【' + info.tower + '】').width + 185;
      if (twrW > maxW) maxW = twrW;

      ctx.font = '12px system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      var locW = ctx.measureText(info.loc).width + 115;
      if (locW > maxW) maxW = locW;
    }

    var maxAllowed = Math.max(300, Math.floor(window.innerWidth * 0.55));
    var optimalW = Math.max(300, Math.min(maxAllowed, Math.ceil(maxW + 15)));
    applyLeftWidth(optimalW);
  }

  function initResizers() {
    if (leftResizer) {
      var leftDragging = false, leftStartX = 0, leftStartW = 320;
      leftResizer.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        leftDragging = true;
        leftStartX = e.clientX;
        leftStartW = pathPanel.getBoundingClientRect().width;
        leftResizer.classList.add('dragging');
        document.body.classList.add('is-resizing');
        try { leftResizer.setPointerCapture(e.pointerId); } catch (err) {}
      });
      leftResizer.addEventListener('pointermove', function (e) {
        if (!leftDragging) return;
        applyLeftWidth(leftStartW + (e.clientX - leftStartX));
      });
      function stopLeft() {
        if (!leftDragging) return;
        leftDragging = false;
        leftResizer.classList.remove('dragging');
        document.body.classList.remove('is-resizing');
        invalidateCanvasRect();
      }
      leftResizer.addEventListener('pointerup', stopLeft);
      leftResizer.addEventListener('pointercancel', stopLeft);

      leftResizer.addEventListener('dblclick', function () {
        autoFitLeftPanelWidth();
        invalidateCanvasRect();
        toast('左侧栏已自动适配宽度');
      });
    }

    if (rightResizer) {
      var rightDragging = false, rightStartX = 0, rightStartW = 310;
      rightResizer.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        rightDragging = true;
        rightStartX = e.clientX;
        rightStartW = side.getBoundingClientRect().width;
        rightResizer.classList.add('dragging');
        document.body.classList.add('is-resizing');
        try { rightResizer.setPointerCapture(e.pointerId); } catch (err) {}
      });
      rightResizer.addEventListener('pointermove', function (e) {
        if (!rightDragging) return;
        applyRightWidth(rightStartW - (e.clientX - rightStartX));
      });
      function stopRight() {
        if (!rightDragging) return;
        rightDragging = false;
        rightResizer.classList.remove('dragging');
        document.body.classList.remove('is-resizing');
        invalidateCanvasRect();
      }
      rightResizer.addEventListener('pointerup', stopRight);
      rightResizer.addEventListener('pointercancel', stopRight);
    }
  }
