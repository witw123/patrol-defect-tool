// Tauri 文件系统 shim：把浏览器 File System Access API 映射到 Tauri 命令与自定义协议。
// 加载顺序：本文件必须在原 HTML 主脚本之前执行（index.html 已注入到 <head>）。
(function () {
  'use strict';

  function invoke(cmd, args) {
    var inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
      || (window.__TAURI__ && window.__TAURI__.invoke)
      || null;
    if (!inv) {
      return Promise.reject(new Error('Tauri invoke 尚未就绪: ' + cmd));
    }
    return inv(cmd, args);
  }

  function b64urlEncode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step)
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // 二进制快速通道：ArrayBuffer 请求体 + 自定义头携带路径，绕开 JSON/base64 序列化。
  async function writeRaw(path, bytes) {
    var buffer = (bytes && bytes.buffer && bytes.byteLength === bytes.buffer.byteLength)
      ? bytes.buffer
      : (bytes && bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
    try {
      return await window.__TAURI__.core.invoke('write_file_raw', buffer, {
        headers: { 'x-file-path-b64': b64urlEncode(path) }
      });
    } catch (e) {
      console.warn('write_file_raw 写入受阻，自动转入 write_file_base64 保障通道:', e);
      return await invoke('write_file_base64', {
        path: path,
        data: bytesToBase64(new Uint8Array(buffer))
      });
    }
  }

  function bytesToBase64(bytes) {
    var binary = '';
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step)
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(binary);
  }

  function b64Decode(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function fileUrl(path) {
    return 'http://pdefile.localhost/' + b64urlEncode(path);
  }

  function normPath(p) {
    return (p || '').replace(/[\\/]+$/, '');
  }

  function joinPath(dir, name) {
    return normPath(dir) + '\\' + name;
  }

  function parentOf(path) {
    var index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    return index > 0 ? path.slice(0, index) : path;
  }

  function mimeOf(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    var table = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
      json: 'application/json', txt: 'text/plain'
    };
    return table[ext] || 'application/octet-stream';
  }

  function extractWholeLine(rawStr, rootHint) {
    var s = String(rawStr || '').trim();
    var root = String(rootHint || (typeof window !== 'undefined' && (window.savedInputName || window.__ACTIVE_LINE__)) || '').trim();

    // 如果 root 提供了明确的整条线路名（以线路/专线/联络线/回线/工程/线 结尾），提取出根主线
    var rootLineRegex = /^(?:(?:\d+\s*(?:k|kV|KV|千伏))?[\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]+?(?:\d+)?(?:线路|专线|联络线|回线|工程|线))/i;
    var rm = root ? root.match(rootLineRegex) : null;
    var rootWhole = rm ? rm[0].trim() : '';

    // 如果待提取字符串以 rootWhole 开头，或自身是支线/分支/变台，直接归入 rootWhole
    if (rootWhole && (s.startsWith(rootWhole) || /^(?:主线|支线|分支|变台)/.test(s) || s.endsWith('支线') || s.endsWith('分支') || /#变/.test(s))) {
      return rootWhole;
    }

    // 1. 匹配带电压等级的标准线路名：如 10kV八联141线、10kV临沟121线、35kV城关线
    var volLineRegex = /^(?:(?:\d+\s*(?:k|kV|KV|千伏))[\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]+?(?:\d+)?(?:线路|专线|联络线|回线|工程|线))/i;
    var vm = s.match(volLineRegex);
    if (vm) {
      return vm[0].trim();
    }

    // 2. 如果没有电压等级，但以明确的线路名开头，且后面跟着主线/支线/分支/#变等
    var branchSplitRegex = /^(.+?(?:线路|专线|联络线|回线|工程|线))(?:主线|支线|分支|变台|#变|东分|西分|南分|北分|[\u4e00-\u9fa50-9_#\-]*?(?:支线|分支|#变)).*$/;
    var sm = s.match(branchSplitRegex);
    if (sm && sm[1]) {
      return sm[1].trim();
    }

    // 3. 通用线路匹配（无电压等级）：如 八联141线
    var genLineRegex = /^([\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]+?(?:\d+)?(?:线路|专线|联络线|回线|工程|线))/;
    var gm = s.match(genLineRegex);
    if (gm) {
      var cand = gm[1].trim();
      if (!/^(?:主线|支线|分支)$/.test(cand) && !cand.endsWith('支线') && !cand.endsWith('分支')) {
        return cand;
      }
    }

    if (rootWhole) return rootWhole;
    return s || '默认线路';
  }
  window.extractWholeLine = extractWholeLine;

  function extractLineFromKeyOrEntry(outRelPath, mEnt) {
    var raw = '';
    if (mEnt && mEnt.line) raw = String(mEnt.line).trim();
    if (!raw && outRelPath) {
      var slashIdx = outRelPath.lastIndexOf('/');
      var fname = slashIdx >= 0 ? outRelPath.slice(slashIdx + 1) : outRelPath;
      var parts = fname.split('_');
      if (parts.length >= 2 && parts[0].trim()) {
        var cand = parts[0].trim();
        if (!/^(?:DJI|IMG|DSC|DCIM|PANO|VID|SCREENSHOT|QQ图片|微信图片)/i.test(cand)) {
          raw = cand;
        }
      }
    }
    if (!raw && mEnt && mEnt.relPath) {
      var relParts = String(mEnt.relPath).replace(/\\/g, '/').split('/').filter(Boolean);
      if (relParts.length > 1) {
        var cand2 = relParts[0].trim();
        if (!/^(?:DJI|IMG|DSC|DCIM|PANO|VID|SCREENSHOT)/i.test(cand2) && !/^#?\d+/.test(cand2)) {
          raw = cand2;
        }
      }
    }
    if (!raw && typeof window !== 'undefined' && window.__ACTIVE_LINE__) {
      raw = String(window.__ACTIVE_LINE__).trim();
    }
    return extractWholeLine(raw);
  }

  function sanitizeLineName(name) {
    return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  // 内存记录已写入/已读取的各线路清单内容特征指纹，只对真正发生变动的脏线路落盘
  var lastSavedManifestLineMap = new Map();

  // ---------- 文件句柄 ----------
  function ShimFileHandle(path, name) {
    this.__path = path;
    this.__name = name;
    this.kind = 'file';
    Object.defineProperty(this, 'name', { get: function () { return this.__name; } });
  }

  ShimFileHandle.prototype.getFile = async function () {
    if (this.__manifestContent !== undefined) {
      return new File([this.__manifestContent], this.__name, { type: 'application/json' });
    }
    try {
      var res = await fetch(fileUrl(this.__path));
      if (res.ok) {
        var blob = await res.blob();
        var file = new File([blob], this.__name, { type: mimeOf(this.__name) });
        file.__sourcePath = this.__path;
        return file;
      }
    } catch (e) { }
    var base64 = await invoke('read_file_base64', { path: this.__path });
    var bytes = b64Decode(base64);
    var fallbackFile = new File([bytes], this.__name, { type: mimeOf(this.__name) });
    fallbackFile.__sourcePath = this.__path;
    return fallbackFile;
  };

  ShimFileHandle.prototype.createWritable = async function () {
    var path = this.__path;
    var handleName = this.__name;
    var chunks = [];
    var directCopySource = null;
    return {
      write: async function (data) {
        if (data && data.__sourcePath && chunks.length === 0) {
          directCopySource = data.__sourcePath;
          return;
        }
        directCopySource = null;
        if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()));
        else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data));
        else if (data && data.buffer) chunks.push(new Uint8Array(data.buffer || data));
        else chunks.push(new TextEncoder().encode(String(data)));
      },
      close: async function () {
        if (handleName === '输出清单.json') {
          // 清单只存安装目录数据区，绝对不落输出目录；按整条线路（整个线，非支线）独立保存清单。
          var textContent = '';
          if (chunks.length > 0) {
            var total = 0;
            chunks.forEach(function (c) { total += c.length; });
            var merged = new Uint8Array(total);
            var offset = 0;
            chunks.forEach(function (c) { merged.set(c, offset); offset += c.length; });
            textContent = new TextDecoder().decode(merged);
          }

          var parsedObj = null;
          try { parsedObj = JSON.parse(textContent); } catch (e) {}
          var allEntries = (parsedObj && parsedObj.entries && typeof parsedObj.entries === 'object') ? parsedObj.entries : {};
          var byLine = {};
          var keys = Object.keys(allEntries);

          for (var k = 0; k < keys.length; k++) {
            var outKey = keys[k];
            var mEnt = allEntries[outKey];
            var lineName = extractLineFromKeyOrEntry(outKey, mEnt);
            var safeLine = sanitizeLineName(lineName);
            if (!safeLine || safeLine === '默认线路') safeLine = '';
            if (!byLine[safeLine]) byLine[safeLine] = {};
            byLine[safeLine][outKey] = mEnt;
          }

          var targetLines = new Set([...Object.keys(byLine), ...lastSavedManifestLineMap.keys()]);
          if (targetLines.size === 0) {
            var emptyPayload = textContent || '{"version":1,"entries":{}}';
            if (lastSavedManifestLineMap.get('') !== emptyPayload) {
              await invoke('write_app_file', {
                name: '输出清单.json',
                content: emptyPayload
              });
              lastSavedManifestLineMap.set('', emptyPayload);
            }
          } else {
            for (var sLine of targetLines) {
              var lineManifestName = sLine ? ('输出清单_' + sLine + '.json') : '输出清单.json';
              var entriesForLine = byLine[sLine] || {};
              var entryCount = Object.keys(entriesForLine).length;
              var lineFingerprint = JSON.stringify(entriesForLine);

              if (entryCount === 0 && sLine) {
                // 若该线路已无条目且之前存在记录，清理空清单文件
                if (lastSavedManifestLineMap.has(sLine)) {
                  try {
                    var appDir2 = await invoke('app_data_dir');
                    await invoke('remove_entry', { path: joinPath(appDir2, lineManifestName), recursive: false });
                  } catch (e) {}
                  lastSavedManifestLineMap.delete(sLine);
                }
                continue;
              }

              // 核心脏检查：如果该线路的清单条目未发生任何增删改，绝对不写盘！
              if (lastSavedManifestLineMap.get(sLine) === lineFingerprint) {
                continue;
              }

              var filePayload = JSON.stringify({
                version: 1,
                savedAt: new Date().toISOString(),
                line: sLine || '默认线路',
                entries: entriesForLine
              }, null, 2);

              await invoke('write_app_file', {
                name: lineManifestName,
                content: filePayload
              });
              lastSavedManifestLineMap.set(sLine, lineFingerprint);
            }
          }
          return;
        }
        if (directCopySource) {
          try {
            await invoke('copy_file', { from: directCopySource, to: path });
            return;
          } catch (e) {
            console.warn('copy_file 失败，回退常规写入:', e);
          }
        }
        var total = 0;
        chunks.forEach(function (c) { total += c.length; });
        var merged = new Uint8Array(total);
        var offset = 0;
        chunks.forEach(function (c) { merged.set(c, offset); offset += c.length; });
        await writeRaw(path, merged);
      }
    };
  };

  ShimFileHandle.prototype.move = async function (newName) {
    this.__path = await invoke('rename_entry', { path: this.__path, newName: newName });
    this.__name = newName;
  };

  ShimFileHandle.prototype.remove = async function () {
    return invoke('remove_entry', { path: this.__path, recursive: false });
  };

  ShimFileHandle.prototype.isSameEntry = function (other) {
    return other && other.__path === this.__path;
  };

  // ---------- 目录句柄 ----------
  function ShimDirHandle(path) {
    this.__path = path;
    this.kind = 'directory';
    Object.defineProperty(this, 'name', {
      get: function () {
        var parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
        return parts[parts.length - 1];
      }
    });
  }

  // 注意语义区分（与标准 File System Access API 一致）：
  //   values()  产出句柄
  //   entries() 产出 [名称, 句柄] 成对数组 —— HTML 的 scanImagesRecursive 依赖此结构
  function makeChild(dirPath, entry) {
    var child = joinPath(dirPath, entry.name);
    return entry.is_dir ? new ShimDirHandle(child) : new ShimFileHandle(child, entry.name);
  }

  ShimDirHandle.prototype.values = async function* () {
    var entries = await invoke('list_entries', { path: this.__path });
    for (var i = 0; i < entries.length; i++) {
      yield makeChild(this.__path, entries[i]);
    }
  };

  ShimDirHandle.prototype.entries = async function* () {
    var entries = await invoke('list_entries', { path: this.__path });
    for (var i = 0; i < entries.length; i++) {
      yield [entries[i].name, makeChild(this.__path, entries[i])];
    }
  };

  ShimDirHandle.prototype.getDirectoryHandle = async function (name, options) {
    var child = joinPath(this.__path, name);
    var exists = await invoke('exists', { path: child });
    if (!exists) {
      if (options && options.create) await invoke('mkdir', { path: child });
      else throw new Error('NotFoundError: 目录不存在: ' + name);
    }
    return new ShimDirHandle(child);
  };

  ShimDirHandle.prototype.getFileHandle = async function (name, options) {
    // 输出清单不再存输出目录：内容只保存在安装目录数据区，读写均虚拟转发。
    if (name === '输出清单.json') {
      var child0 = joinPath(this.__path, name);
      if (await invoke('exists', { path: child0 })) {
        await invoke('remove_entry', { path: child0, recursive: false });
      }

      var appDir = await invoke('app_data_dir');
      var entries = await invoke('list_entries', { path: appDir });
      var mergedEntries = {};

      for (var i = 0; i < entries.length; i++) {
        var ent = entries[i];
        if (ent.is_dir) continue;
        var ename = ent.name;

        // 读取所有合法的输出清单：输出清单_*.json、*_输出清单.json、输出清单.json
        var isManifest = (ename === '输出清单.json') ||
                         (ename.startsWith('输出清单_') && ename.endsWith('.json')) ||
                         (ename.endsWith('_输出清单.json'));
        if (isManifest) {
          var raw = await invoke('read_app_file', { name: ename });
          if (raw) {
            try {
              var obj = JSON.parse(raw);
              if (obj && obj.entries && typeof obj.entries === 'object') {
                Object.assign(mergedEntries, obj.entries);
                var curLineKey = (ename === '输出清单.json') ? '' : sanitizeLineName(extractWholeLine(ename.slice('输出清单_'.length, ename.length - '.json'.length)));
                lastSavedManifestLineMap.set(curLineKey, JSON.stringify(obj.entries));
              }
            } catch (e) {}
          }
        }
      }

      var handle = new ShimFileHandle(joinPath(this.__path, name), name);
      handle.__manifestContent = JSON.stringify({
        version: 1,
        entries: mergedEntries
      });
      return handle;
    }
    var child = joinPath(this.__path, name);
    var exists = await invoke('exists', { path: child });
    if (!exists) {
      if (options && options.create) {
        await invoke('write_file_base64', { path: child, data: '' });
      } else {
        throw new Error('NotFoundError: 文件不存在: ' + name);
      }
    }
    return new ShimFileHandle(child, name);
  };

  ShimDirHandle.prototype.removeEntry = async function (name, options) {
    return invoke('remove_entry', {
      path: joinPath(this.__path, name),
      recursive: !!(options && options.recursive)
    });
  };

  ShimDirHandle.prototype.queryPermission = async function () { return 'granted'; };
  ShimDirHandle.prototype.requestPermission = async function () { return 'granted'; };
  ShimDirHandle.prototype.isSameEntry = function (other) {
    return other && other.__path === this.__path;
  };

  // ---------- 目录选择 ----------
  window.showDirectoryPicker = async function () {
    var path = await invoke('pick_folder');
    if (!path) throw new Error('AbortError');
    return new ShimDirHandle(path);
  };

  // HTML 中的文件输入（模板导入）由 webview 原生支持，无需处理。

  // ---------- localStorage -> 安装目录数据文件（已看缓存/字典/主题/目录记忆等全部持久化） ----------
  // Rust 启动时把 data/localStorage.json 注入 window.__PATROL_DATA__，这里同步接管后节流写回。
  var __nativeStorage = null;
  try { __nativeStorage = window.localStorage; } catch (e) {}

  var __patrolStore = (window.__PATROL_DATA__ && typeof window.__PATROL_DATA__ === 'object')
    ? window.__PATROL_DATA__ : {};
  var __patrolTimer = null;

  // 1. 如果原生 webview localStorage 中有旧数据，迁移进 __patrolStore（防止老版本数据丢失）
  if (__nativeStorage && typeof __nativeStorage.getItem === 'function') {
    try {
      for (var ni = 0; ni < __nativeStorage.length; ni++) {
        var nk = __nativeStorage.key(ni);
        if (nk && !Object.prototype.hasOwnProperty.call(__patrolStore, nk)) {
          var nv = __nativeStorage.getItem(nk);
          if (nv !== null) __patrolStore[nk] = nv;
        }
      }
    } catch (e) {}
  }

  // 2. 兜底异步从磁盘读取 localStorage.json 补充
  if (invoke) {
    invoke('read_app_file', { name: 'localStorage.json' }).then(function (raw) {
      if (!raw) return;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          var hasNew = false;
          for (var pk in parsed) {
            if (!Object.prototype.hasOwnProperty.call(__patrolStore, pk)) {
              __patrolStore[pk] = parsed[pk];
              hasNew = true;
            }
          }
          if (hasNew) {
            // 如果补充读到了新的已看记录，及时更新内存并刷新界面
            if (typeof loadViewedPhotos === 'function') {
              loadViewedPhotos();
              if (typeof refreshTreeStats === 'function') refreshTreeStats();
            }
          }
        }
      } catch (e) {}
    }).catch(function () {});
  }

  function persistStore(immediate) {
    if (immediate) {
      if (__patrolTimer) {
        clearTimeout(__patrolTimer);
        __patrolTimer = null;
      }
      try {
        invoke('write_app_file', {
          name: 'localStorage.json',
          content: JSON.stringify(__patrolStore)
        }).catch(function (e) {
          console.warn('[Storage] immediate write failed:', e);
        });
      } catch (e) {
        console.warn('[Storage] immediate invoke error:', e);
      }
      return;
    }
    // 防抖写入：200ms 后置持久化，连续翻图期间绝不阻塞，翻图停顿或离开时自动落盘
    if (__patrolTimer) clearTimeout(__patrolTimer);
    __patrolTimer = setTimeout(function () {
      __patrolTimer = null;
      try {
        invoke('write_app_file', {
          name: 'localStorage.json',
          content: JSON.stringify(__patrolStore)
        }).catch(function (e) {
          console.warn('[Storage] debounced write failed:', e);
        });
      } catch (e) {
        console.warn('[Storage] debounced invoke error:', e);
      }
    }, 200);
  }

  function SimpleStorage() { }
  SimpleStorage.prototype.getItem = function (k) {
    k = String(k);
    return Object.prototype.hasOwnProperty.call(__patrolStore, k) ? __patrolStore[k] : null;
  };
  SimpleStorage.prototype.setItem = function (k, v) {
    var strK = String(k);
    var strV = String(v);
    if (__patrolStore[strK] === strV) return;
    __patrolStore[strK] = strV;
    persistStore();
  };
  SimpleStorage.prototype.removeItem = function (k) {
    delete __patrolStore[String(k)];
    persistStore();
  };
  SimpleStorage.prototype.clear = function () {
    for (var k in __patrolStore) delete __patrolStore[k];
    persistStore(true);
  };
  SimpleStorage.prototype.flush = function () {
    persistStore(true);
  };
  SimpleStorage.prototype.key = function (i) {
    var keys = Object.keys(__patrolStore);
    return i >= 0 && i < keys.length ? keys[i] : null;
  };
  Object.defineProperty(SimpleStorage.prototype, 'length', {
    get: function () { return Object.keys(__patrolStore).length; }
  });

  try {
    Object.defineProperty(window, 'localStorage', {
      value: new SimpleStorage(),
      configurable: true,
      writable: true
    });
  } catch (e) {
    try { window.localStorage = new SimpleStorage(); } catch (e2) {}
  }

  // 页面卸载或退到后台时强制即刻落盘
  window.addEventListener('beforeunload', function () { persistStore(true); });
  window.addEventListener('pagehide', function () { persistStore(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) persistStore(true);
  });


  // ---------- IndexedDB shim：目录句柄持久化为路径字符串（底层走上面的 localStorage） ----------
  var STORE_KEY = '__pdefile_handle_db__';
  function loadDB() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveDB(store) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { }
  }
  function serializeHandle(value) {
    if (value instanceof ShimDirHandle) return { __shim: 'dir', path: value.__path };
    if (value instanceof ShimFileHandle) return { __shim: 'file', path: value.__path, name: value.__name };
    return value;
  }
  function deserializeHandle(value) {
    if (value && value.__shim === 'dir') return new ShimDirHandle(value.path);
    if (value && value.__shim === 'file') return new ShimFileHandle(value.path, value.name);
    return value || null;
  }

  function makeRequest(setup) {
    var request = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null };
    setTimeout(function () {
      try {
        setup(request);
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (e) {
        if (request.onerror) request.onerror(e);
      }
    }, 0);
    return request;
  }

  if (invoke) {
    window.indexedDB = {
      open: function () {
        return makeRequest(function (request) {
          request.result = {
            objectStoreNames: { contains: function () { return true; } },
            transaction: function () {
              return {
                objectStore: function () {
                  return {
                    put: function (value, key) {
                      return makeRequest(function (request) {
                        var store = loadDB();
                        store[key] = serializeHandle(value);
                        saveDB(store);
                      });
                    },
                    get: function (key) {
                      return makeRequest(function (request) {
                        var store = loadDB();
                        request.result = deserializeHandle(store[key]);
                      });
                    },
                    delete: function (key) {
                      return makeRequest(function (request) {
                        var store = loadDB();
                        delete store[key];
                        saveDB(store);
                      });
                    }
                  };
                }
              };
            }
          };
        });
      }
    };
  }

  // 标记 shim 就绪，便于排查加载顺序问题。
  window.__patrolShimReady = true;

  // ---------- 界面缩放支持 ----------
  var ZOOM_KEY = 'patrol_ui_zoom';
  function applyZoom(scale) {
    try {
      if (invoke) invoke('set_zoom', { scale: Number(scale) });
    } catch (e) { }
  }
  window.__patrolApplyZoom = applyZoom;

  // ---------- 界面修饰（仅外观，不动逻辑） ----------
  // 1. 去掉顶部工具栏下方出现的横向滚动条；
  // 2. 左下角设置齿轮按钮被渲染成黑块，固定为主题底色（浅色白底深字，深色反之）。
  var style = document.createElement('style');
  style.textContent =
    'html, body { overflow-x: hidden !important; }' +
    '#btnSettings { background: #FFFFFF !important; color: #1F2937 !important; border-color: #E5E7EB !important; }' +
    'body.dark #btnSettings { background: #1F1F1F !important; color: #F5F5F5 !important; border-color: #3A3A3A !important; }';
  document.addEventListener('DOMContentLoaded', function () {
    document.head.appendChild(style);
    try {
      var saved = parseFloat(localStorage.getItem(ZOOM_KEY));
      if (!isNaN(saved) && saved >= 0.5 && saved <= 2) {
        applyZoom(saved);
      }
    } catch (e) {}
  });
})();
