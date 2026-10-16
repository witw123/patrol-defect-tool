// 常量、存储键、IndexedDB 目录句柄与矢量 SVG 图标库


  var $ = function (id) { return document.getElementById(id); };


  /* ================= 常量与数据 ================= */

  var IMG_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff'];
  var strokeWidth = 10;
  var MIN_ZOOM = 0.1, MAX_ZOOM = 10, HANDLE_PX = 8;
  var CACHE_LIMIT = 10;

  var KEY_THEME = 'xunjian_theme';
  var KEY_NO_PROMPT = 'xunjian_no_prompt';
  var KEY_DEFECT_DICT = 'xunjian_defect_dict_v7';
  var KEY_ADJACENCY = 'xunjian_custom_adjacency_v7';
  var KEY_OUTPUT_NAME = 'xunjian_output_name';
  var KEY_INPUT_NAME = 'xunjian_input_dir_name';
  var KEY_HIDDEN = 'xunjian_hidden_defects';
  var KEY_LEFT_WIDTH = 'xunjian_left_width';
  var KEY_RIGHT_WIDTH = 'xunjian_right_width';
  var KEY_STROKE = 'xunjian_stroke_width';
  var KEY_VIEWED = 'xunjian_viewed_photos_v2';
  var KEY_CANDIDATE_POOL = 'xunjian_candidate_pool_v7';
  var KEY_CRITICAL_DEFECTS = 'xunjian_critical_defects_v1';
  var KEY_AUTO_CATEGORIES = 'xunjian_auto_categories_v1';
  var DEFAULT_AUTO_CATEGORIES = {
    '全绝缘缺陷': ['绝缘', '裸导线'],
    '其他缺陷': []
  };

  // 目录句柄持久化 (IndexedDB)
  var DB_NAME = 'xunjian_dirs_storage_v1';
  var DB_STORE = 'dir_handles';
  var lastInputHandle = null;
  var lastOutputHandle = null;
  var savedInputName = '';

  function openDirDB() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE);
          }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function () { resolve(null); };
      } catch (err) {
        resolve(null);
      }
    });
  }

  async function saveDirHandle(key, handle) {
    try {
      var db = await openDirDB();
      if (!db) return false;
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        var store = tx.objectStore(DB_STORE);
        var req = store.put(handle, key);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { resolve(false); };
      });
    } catch (e) {
      console.warn('saveDirHandle error:', e);
      return false;
    }
  }

  async function getDirHandle(key) {
    try {
      var db = await openDirDB();
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var store = tx.objectStore(DB_STORE);
        var req = store.get(key);
        req.onsuccess = function (e) { resolve(e.target.result || null); };
        req.onerror = function () { resolve(null); };
      });
    } catch (e) {
      console.warn('getDirHandle error:', e);
      return null;
    }
  }

  // 38项《常规配电缺陷描述》官方模板红色危急缺陷标准集
  var CRITICAL_DEFECTS = [
    '_杆塔-倾斜',
    '_杆塔-破损',
    '_柱瓶-表面污秽，疑似有放电灼烧痕迹',
    '_柱瓶-无扎线',
    '_柱瓶-绑扎线松脱(导线脱落)',
    '_柱瓶-脱落',
    '_悬瓶-破损（损伤、断裂、脱落）',
    '_悬瓶-表面污秽，疑似有放电灼烧痕迹',
    '_通道-通道树障、树木茂盛',
    '_跌落式熔断器-异物',
    '_跌落式熔断器-有放电痕迹',
    '_跌落式熔断器-有灼烧痕迹',
    '_跌落式熔断器-疑似灼烧痕迹',
    '_跌落式熔断器-熔断器跌落',
    '_避雷器-异物',
    '_避雷器-有放电痕迹',
    '_避雷器-有灼烧痕迹',
    '_避雷器-疑似灼烧痕迹',
    '_避雷器-损坏',
    '_柱上开关-异物',
    '_柱上开关-有放电痕迹',
    '_柱上开关-有灼烧痕迹',
    '_柱上开关-疑似灼烧痕迹',
    '_配电变压器-异物',
    '_配电变压器-有灼烧痕迹',
    '_配电变压器-疑似灼烧痕迹',
    '_变压器-异物',
    '_变压器-有灼烧痕迹',
    '_变压器-疑似灼烧痕迹',
    '_引线-断股、扭曲',
    '_导线-裸导线',
    '_导线-脱落',
    '_导线-有灼烧痕迹',
    '_导线-疑似灼烧痕迹',
    '_导线-固定卡扣缺失',
    '_导线-异物悬挂',
    '_电缆终端-有灼烧痕迹',
    '_电缆终端-疑似灼烧痕迹',
    '_刀闸-瓷瓶脏污，疑似放电痕迹',
    '_刀闸-有灼烧痕迹',
    '_互感器-破损'
  ];
  var CRITICAL_DEFECT_SET = new Set(CRITICAL_DEFECTS);

  // 危急缺陷由用户在右侧「缺陷列表」中自行维护。首次使用时默认采用系统模板中的危急缺陷；
  // 一旦用户手动调整，后续保存、导出/导入模板均以用户选择为准。
  function isCriticalDefectTag(tag) {
    if (!tag) return false;
    return criticalDefects.has(String(tag).trim());
  }

  function saveCriticalDefects() {
    try { localStorage.setItem(KEY_CRITICAL_DEFECTS, JSON.stringify(Array.from(criticalDefects))); } catch (e) {}
    sideDictVersion++;
  }

  function loadCriticalDefects() {
    try {
      var raw = localStorage.getItem(KEY_CRITICAL_DEFECTS);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          criticalDefects = new Set(arr.map(function (x) { return String(x).trim(); }).filter(Boolean));
          return;
        }
      }
    } catch (e) {}
    criticalDefects = new Set(CRITICAL_DEFECTS);
  }

  function toggleCriticalDefect(tag) {
    var t = String(tag || '').trim();
    if (!t) return;
    if (criticalDefects.has(t)) {
      criticalDefects.delete(t);
      saveCriticalDefects();
      toast('✓ 已取消【' + t + '】的危急属性');
    } else {
      criticalDefects.add(t);
      saveCriticalDefects();
      toast('✓ 已将【' + t + '】设为危急缺陷');
    }
    renderSide(true);
    updateHud();
  }

  // 默认严格按《常规配电缺陷描述》标准的设备部件/位置归类字典（共24大类，严格遵循表格标签命名）
  var DEFAULT_DEFECT_DICT = {
    '金具': [
      '_金具-U型挂环-缺销钉',
      '_金具-U型挂环-销钉即将脱出',
      '_金具-U型挂环-螺栓即将脱出',
      '_金具-U型挂环-螺母缺失',
      '_金具-U型挂环-螺母松动',
      '_金具-直角挂板-缺销钉',
      '_金具-直角挂板-销钉即将脱出',
      '_金具-直角挂板-螺栓即将脱出',
      '_金具-直角挂板-螺母缺失',
      '_金具-直角挂板-螺母松动',
      '_金具-碗头挂板-缺销钉',
      '_金具-碗头挂板-销钉即将脱出',
      '_金具-碗头挂板-螺栓即将脱出',
      '_金具-碗头挂板-螺母缺失',
      '_金具-碗头挂板-螺母松动',
      '_金具-平行挂板-缺销钉',
      '_金具-平行挂板-销钉即将脱出',
      '_金具-平行挂板-螺栓即将脱出',
      '_金具-平行挂板-螺母缺失',
      '_金具-平行挂板-螺母松动',
      '_金具-球头挂环-缺销钉',
      '_金具-球头挂环-销钉即将脱出',
      '_金具-球头挂环-螺栓即将脱出',
      '_金具-球头挂环-螺母缺失',
      '_金具-球头挂环-螺母松动'
    ],
    '杆塔': [
      '_杆塔-异物',
      '_杆塔-倾斜',
      '_杆塔-树木包围',
      '_杆塔-与树木安全距离不足',
      '_杆塔-裂纹',
      '_杆塔-破损',
      '_杆塔-鸟窝',
      '_杆塔-藤蔓攀爬'
    ],
    '塔基': [
      '_塔基-杂物堆积',
      '_塔基-立柱水淹'
    ],
    '塔头': [
      '_塔头-混凝土杆顶部风化露筋',
      '_塔头-鸟窝'
    ],
    '杆号牌': [
      '_杆号牌-缺失',
      '_杆号牌-不对应',
      '_杆号牌-模糊',
      '_杆号牌-遮挡',
      '_杆号牌-损坏'
    ],
    '横担': [
      '_横担-歪斜',
      '_横担-有鸟窝',
      '_横担-有树枝',
      '_横担-有异物'
    ],
    '抱箍': [
      '_抱箍-缺螺栓',
      '_抱箍-松动'
    ],
    '附属设施': [
      '_附属设施-防鸟设施损坏'
    ],
    '柱瓶': [
      '_柱瓶-歪斜',
      '_柱瓶-破损',
      '_柱瓶-扎线不规范',
      '_柱瓶-缺失',
      '_柱瓶-表面脏污',
      '_柱瓶-表面污秽，疑似有放电灼烧痕迹',
      '_柱瓶-无扎线',
      '_柱瓶-绑扎线松脱(导线脱落)',
      '_柱瓶-脱落'
    ],
    '悬瓶': [
      '_悬瓶-轻微破损',
      '_悬瓶-破损（损伤、断裂、脱落）',
      '_悬瓶-表面脏污',
      '_悬瓶-表面污秽，疑似有放电灼烧痕迹',
      '_悬瓶-与导线安全距离不足'
    ],
    '通道': [
      '_通道-导线与树木安全距离不足',
      '_通道-通道树障、树木茂盛',
      '_通道-弧垂过低',
      '_通道-施工现场杂物堆积'
    ],
    '跌落式熔断器': [
      '_跌落式熔断器-异物',
      '_跌落式熔断器-绝缘护套缺失',
      '_跌落式熔断器-绝缘外露（松脱、损坏）',
      '_跌落式熔断器-有放电痕迹',
      '_跌落式熔断器-有灼烧痕迹',
      '_跌落式熔断器-疑似灼烧痕迹',
      '_跌落式熔断器-表面污秽',
      '_跌落式熔断器-熔管跌落',
      '_跌落式熔断器-熔管缺失',
      '_跌落式熔断器-熔断器跌落'
    ],
    '避雷器': [
      '_避雷器-异物',
      '_避雷器-绝缘护套缺失',
      '_避雷器-绝缘外露（松脱、损坏）',
      '_避雷器-有放电痕迹',
      '_避雷器-有灼烧痕迹',
      '_避雷器-疑似灼烧痕迹',
      '_避雷器-表面污秽',
      '_避雷器-脱扣脱落',
      '_避雷器-损坏'
    ],
    '柱上开关': [
      '_柱上开关-异物',
      '_柱上开关-绝缘护套缺失',
      '_柱上开关-绝缘外露（松脱、损坏）',
      '_柱上开关-有放电痕迹',
      '_柱上开关-有灼烧痕迹',
      '_柱上开关-疑似灼烧痕迹',
      '_柱上开关-表面污秽',
      '_柱上开关-铭牌缺失'
    ],
    '配电变压器': [
      '_配电变压器-异物',
      '_配电变压器-绝缘护套缺失',
      '_配电变压器-绝缘外露（松脱、损坏）',
      '_配电变压器-有灼烧痕迹',
      '_配电变压器-疑似灼烧痕迹',
      '_配电变压器-表面污秽',
      '_配电变压器-漏油',
      '_配电变压器-植被包围、藤蔓缠绕',
      '_配电变压器-锈蚀'
    ],
    '引线': [
      '_引线-断股、扭曲',
      '_引线-有灼烧痕迹',
      '_引线-疑似灼烧痕迹',
      '_引线-存在裸露、需绝缘包裹',
      '_引线-绝缘保护套老化、破损'
    ],
    '导线': [
      '_导线-裸导线',
      '_导线-松股',
      '_导线-断股',
      '_导线-脱落',
      '_导线-有灼烧痕迹',
      '_导线-疑似灼烧痕迹',
      '_导线-固定卡扣安装不牢固',
      '_导线-固定卡扣缺失',
      '_导线-绝缘层破损、绝缘外露',
      '_导线-异物悬挂'
    ],
    '线夹': [
      '_线夹-有灼烧痕迹',
      '_线夹-绝缘保护套缺失',
      '_线夹-绝缘保护套损坏'
    ],
    '接地环': [
      '_接地环-绝缘护罩缺失',
      '_接地环-绝缘外露'
    ],
    '接地引下线': [
      '_接地引下线-断开'
    ],
    '电缆终端': [
      '_电缆终端-绝缘护罩缺失',
      '_电缆终端-绝缘外露',
      '_电缆终端-有灼烧痕迹',
      '_电缆终端-疑似灼烧痕迹'
    ],
    '刀闸': [
      '_刀闸-绝缘护套缺失',
      '_刀闸-绝缘外露（松脱、损坏）',
      '_刀闸-瓷瓶脏污，疑似放电痕迹',
      '_刀闸-有灼烧痕迹',
      '_刀闸-瓷瓶破损',
      '_刀闸-刀片脱落'
    ],
    '互感器': [
      '_互感器-绝缘护套缺失',
      '_互感器-绝缘外露（松脱、损坏）',
      '_互感器-破损'
    ],
    '拉线': [
      '_拉线-楔形挂板-销钉缺失'
    ]
  };

  // 默认电力设备部件相近关联推荐图谱 (Adjacent / Related Equipment on Pole)
  var DEFAULT_LOCATION_ADJACENCY = {
    '金具': ['横担', '悬瓶', '柱瓶', '拉线', '抱箍', '导线'],
    '杆塔': ['塔全貌', '塔头', '塔基', '杆号牌', '抱箍', '横担', '拉线', '通道', '附属设施'],
    '塔基': ['杆塔', '塔全貌', '接地引下线', '拉线', '通道'],
    '塔头': ['杆塔', '塔全貌', '横担', '柱瓶', '附属设施'],
    '杆号牌': ['杆塔', '抱箍', '通道'],
    '横担': ['柱瓶', '悬瓶', '金具', '导线', '线夹', '接地环', '抱箍', '附属设施'],
    '左横担': ['横担', '柱瓶', '悬瓶', '金具', '导线', '线夹', '接地环'],
    '右横担': ['横担', '柱瓶', '悬瓶', '金具', '导线', '线夹', '接地环'],
    '抱箍': ['横担', '杆塔', '拉线', '金具'],
    '附属设施': ['横担', '塔头', '杆塔'],
    '柱瓶': ['悬瓶', '横担', '导线', '线夹', '接地环', '金具'],
    '左相柱瓶': ['柱瓶', '悬瓶', '横担', '导线', '线夹', '接地环', '金具'],
    '中相柱瓶': ['柱瓶', '悬瓶', '横担', '导线', '线夹', '接地环', '金具'],
    '右相柱瓶': ['柱瓶', '悬瓶', '横担', '导线', '线夹', '接地环', '金具'],
    '悬瓶': ['柱瓶', '横担', '金具', '导线', '线夹', '拉线'],
    '中相悬瓶': ['悬瓶', '柱瓶', '横担', '金具', '导线', '线夹'],
    '通道': ['杆塔', '塔全貌', '导线', '塔基', '拉线'],
    '跌落式熔断器': ['配电变压器', '避雷器', '柱上开关', '引线', '导线', '接地引下线'],
    '避雷器': ['跌落式熔断器', '配电变压器', '柱上开关', '接地引下线', '接地环', '引线', '导线'],
    '柱上开关': ['刀闸', '互感器', '跌落式熔断器', '引线', '避雷器', '电缆终端'],
    '配电变压器': ['跌落式熔断器', '避雷器', '柱上开关', '引线', '接地引下线', '接地环', '导线'],
    '引线': ['导线', '跌落式熔断器', '配电变压器', '避雷器', '柱上开关', '刀闸', '互感器', '电缆终端'],
    '导线': ['引线', '线夹', '接地环', '柱瓶', '悬瓶', '横担', '通道'],
    '线夹': ['导线', '引线', '接地环', '柱瓶', '悬瓶', '横担', '金具'],
    '接地环': ['导线', '引线', '线夹', '柱瓶', '避雷器'],
    '接地引下线': ['避雷器', '配电变压器', '杆塔', '塔基'],
    '电缆终端': ['避雷器', '柱上开关', '接地引下线', '引线'],
    '刀闸': ['柱上开关', '跌落式熔断器', '互感器', '引线', '柱瓶'],
    '互感器': ['柱上开关', '刀闸', '引线', '接地引下线'],
    '拉线': ['杆塔', '金具', '抱箍', '塔基', '通道']
  };

  var KNOWN_POSITIONS = [
    '金具', '杆塔', '塔基', '塔头', '杆号牌', '横担', '抱箍', '附属设施',
    '柱瓶', '悬瓶', '通道', '跌落式熔断器', '避雷器', '柱上开关', '配电变压器',
    '引线', '导线', '线夹', '接地环', '接地引下线', '电缆终端', '刀闸', '互感器', '拉线',
    '左横担', '右横担', '左相柱瓶', '中相柱瓶', '右相柱瓶', '中相悬瓶', '左相悬瓶', '右相悬瓶',
    '熔断器', '跌落保险', '变压器', '配变', '开关', '断路器', '真空断路器', '隔离开关',
    '引流线', '导线线夹', '耐张线夹', '悬垂线夹', '基础', '杆塔基础', '塔身抱箍', '号牌', '铭牌', '防鸟设施',
    '大号侧', '小号侧', 'A相', 'B相', 'C相', '全貌', '塔全貌'
  ];


  /* ================= 极简矢量图标 (SVG Icons) ================= */
  var ICONS = {
    // 关联推荐 (链接)
    link: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>',
    // 编辑/重命名 (铅笔)
    edit: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>',
    // 添加 (加号)
    plus: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    // 删除 (垃圾桶)
    trash: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    // 移除/关闭 (叉号)
    close: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    // 警告/危急 (三角形感叹号)
    warning: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    // 对勾/成功 (Check)
    check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    // 折叠展开指示箭头 (Chevron down)
    chevronDown: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;vertical-align:middle"><polyline points="6 9 12 15 18 9"></polyline></svg>',
    // 指向箭头 (Play arrow)
    arrowRight: '<svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor" stroke="none" style="pointer-events:none;vertical-align:middle"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>'
  };
