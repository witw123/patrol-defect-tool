// Tauri 文件系统 shim：把浏览器 File System Access API 映射到 Tauri 命令与自定义协议。
// 加载顺序：本文件必须在原 HTML 主脚本之前执行（index.html 已注入到 <head>）。
(function () {
  'use strict';

  var invoke = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core.invoke : null;

  function b64urlEncode(text) {
    var bytes = new TextEncoder().encode(text);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
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

  function joinPath(dir, name) {
    return dir.replace(/[\\/]+$/, '') + '\\' + name;
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

  // ---------- 文件句柄 ----------
  function ShimFileHandle(path, name) {
    this.__path = path;
    this.__name = name;
    this.kind = 'file';
    Object.defineProperty(this, 'name', { get: function () { return this.__name; } });
  }

  ShimFileHandle.prototype.getFile = async function () {
    var base64 = await invoke('read_file_base64', { path: this.__path });
    var bytes = b64Decode(base64);
    return new File([bytes], this.__name, { type: mimeOf(this.__name) });
  };

  ShimFileHandle.prototype.createWritable = async function () {
    var path = this.__path;
    var handleName = this.__name;
    var chunks = [];
    return {
      write: async function (data) {
        if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()));
        else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data));
        else if (data && data.buffer) chunks.push(new Uint8Array(data.buffer || data));
        else chunks.push(new TextEncoder().encode(String(data)));
      },
      close: async function () {
        var total = 0;
        chunks.forEach(function (c) { total += c.length; });
        var merged = new Uint8Array(total);
        var offset = 0;
        chunks.forEach(function (c) { merged.set(c, offset); offset += c.length; });
        await invoke('write_file_base64', { path: path, data: bytesToBase64(merged) });
        if (handleName === '输出清单.json') {
          try {
            await invoke('write_app_file', {
              name: 'manifest-' + b64urlEncode(parentOf(path)) + '.json',
              content: new TextDecoder().decode(merged)
            });
          } catch (e) { }
        }
      }
    };
  };

  ShimFileHandle.prototype.move = async function (newName) {
    this.__path = await invoke('rename_entry', { path: this.__path, newName: newName });
    this.__name = newName;
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
    var child = joinPath(this.__path, name);
    var exists = await invoke('exists', { path: child });
    if (!exists && name === '输出清单.json') {
      // 安装目录有镜像而输出目录丢失时，自动还原，保证清单不丢。
      var mirror = await invoke('read_app_file', {
        name: 'manifest-' + b64urlEncode(this.__path) + '.json'
      });
      if (mirror) {
        var raw = new TextEncoder().encode(mirror);
        await invoke('write_file_base64', { path: child, data: bytesToBase64(raw) });
        exists = true;
      }
    }
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
  // Rust 启动时把 data/localStorage.json 注入 window.__PATROL_DATA__，这里同步接管后防抖写回。
  var __patrolStore = (window.__PATROL_DATA__ && typeof window.__PATROL_DATA__ === 'object')
    ? window.__PATROL_DATA__ : {};
  var __patrolTimer = null;
  function persistStore() {
    if (__patrolTimer) clearTimeout(__patrolTimer);
    __patrolTimer = setTimeout(function () {
      __patrolTimer = null;
      try {
        invoke('write_app_file', {
          name: 'localStorage.json',
          content: JSON.stringify(__patrolStore)
        });
      } catch (e) { }
    }, 250);
  }
  function SimpleStorage() { }
  SimpleStorage.prototype.getItem = function (k) {
    k = String(k);
    return Object.prototype.hasOwnProperty.call(__patrolStore, k) ? __patrolStore[k] : null;
  };
  SimpleStorage.prototype.setItem = function (k, v) {
    __patrolStore[String(k)] = String(v);
    persistStore();
  };
  SimpleStorage.prototype.removeItem = function (k) {
    delete __patrolStore[String(k)];
    persistStore();
  };
  SimpleStorage.prototype.clear = function () {
    for (var k in __patrolStore) delete __patrolStore[k];
    persistStore();
  };
  SimpleStorage.prototype.key = function (i) {
    var keys = Object.keys(__patrolStore);
    return i >= 0 && i < keys.length ? keys[i] : null;
  };
  Object.defineProperty(SimpleStorage.prototype, 'length', {
    get: function () { return Object.keys(__patrolStore).length; }
  });
  window.localStorage = new SimpleStorage();

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
  });
})();
