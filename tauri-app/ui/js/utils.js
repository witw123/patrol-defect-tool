// 弹窗交互组件 (Alert/Confirm/Prompt/Toast) 与通用工具函数


  /* ================= 标准弹窗交互（替代原生 prompt / confirm 警告框） ================= */

  function showPromptDialog(options) {
    return new Promise(function (resolve) {
      var modal = $('promptModal');
      var titleEl = $('promptModalTitle');
      var descEl = $('promptModalDesc');
      var inputEl = $('promptModalInput');
      var btnCancel = $('promptModalCancel');
      var btnConfirm = $('promptModalConfirm');

      titleEl.textContent = options.title || '编辑';
      if (options.desc) {
        descEl.textContent = options.desc;
        descEl.style.display = 'block';
      } else {
        descEl.style.display = 'none';
      }
      inputEl.placeholder = options.placeholder || '';
      inputEl.value = options.defaultValue || '';

      modal.classList.add('show');
      setTimeout(function () {
        inputEl.focus();
        inputEl.select();
      }, 50);

      function cleanup() {
        modal.classList.remove('show');
        btnConfirm.onclick = null;
        btnCancel.onclick = null;
        modal.onclick = null;
        inputEl.onkeydown = null;
      }

      function doConfirm() {
        var val = inputEl.value;
        if (options.validate) {
          var err = options.validate(val);
          if (err) { toast(err); return; }
        }
        cleanup();
        resolve(val);
      }

      function doCancel() {
        cleanup();
        resolve(null);
      }

      btnConfirm.onclick = doConfirm;
      btnCancel.onclick = doCancel;
      modal.onclick = function (e) {
        if (e.target === modal) doCancel();
      };
      inputEl.onkeydown = function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          doConfirm();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          doCancel();
        }
      };
    });
  }

  function showConfirmDialog(title, message) {
    return new Promise(function (resolve) {
      var modal = $('confirmModal');
      var titleEl = $('confirmModalTitle');
      var msgEl = $('confirmModalMessage');
      var btnCancel = $('confirmModalCancel');
      var btnConfirm = $('confirmModalConfirm');

      titleEl.textContent = title || '确认操作';
      msgEl.textContent = message || '确定要继续吗？';
      modal.classList.add('show');

      function cleanup() {
        modal.classList.remove('show');
        btnConfirm.onclick = null;
        btnCancel.onclick = null;
        modal.onclick = null;
        window.removeEventListener('keydown', keyHandler);
      }

      function keyHandler(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          cleanup();
          resolve(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve(false);
        }
      }

      btnConfirm.onclick = function () { cleanup(); resolve(true); };
      btnCancel.onclick = function () { cleanup(); resolve(false); };
      modal.onclick = function (e) {
        if (e.target === modal) { cleanup(); resolve(false); }
      };
      window.addEventListener('keydown', keyHandler);
    });
  }


  /* ================= 工具 ================= */

  function mimeOf(name) {
    var e = name.slice(name.lastIndexOf('.')).toLowerCase();
    return e === '.png' ? 'image/png' : 'image/jpeg';
  }
  function fileKey(f) {
    if (!f) return '';
    if (typeof f === 'string') return f;
    return f.relPath || f.name || '';
  }
  function curFile() { return (state.index >= 0 && state.files) ? state.files[state.index] : null; }
  function curName() { var f = curFile(); return f ? f.name : null; }
  function curKey() { var f = curFile(); return f ? fileKey(f) : ''; }

  function sanitizeViewedPhotos() {
    if (!state.files || state.files.length === 0 || !viewedPhotosMap) return;
    var hasNestedPaths = state.files.some(function (f) { return f.relPath && f.relPath.indexOf('/') >= 0; });
    var changed = false;
    for (var k in viewedPhotosMap) {
      if (hasNestedPaths && k.indexOf('/') < 0) {
        delete viewedPhotosMap[k];
        changed = true;
      }
    }
    if (changed) saveViewedPhotos();
  }

  function isFileViewed(f) {
    if (!f) return false;
    var k = fileKey(f);
    return !!(viewedPhotosMap && viewedPhotosMap[k]);
  }

  function getMeta(target) {
    var key = '';
    if (target && typeof target === 'object') {
      key = fileKey(target);
    } else if (typeof target === 'string' && target) {
      if (state.index >= 0 && state.files && state.files[state.index]) {
        var curF = state.files[state.index];
        if (target === curF.name || target === curF.relPath) {
          key = fileKey(curF);
        } else {
          key = target;
        }
      } else {
        key = target;
      }
    } else {
      key = curKey();
    }
    if (!key) return { boxes: [], appended: [], history: [], saved: false };
    var m = state.meta.get(key);
    if (!m) {
      m = { boxes: [], appended: [], history: [], saved: false };
      state.meta.set(key, m);
    }
    if (!m.history) m.history = [];
    return m;
  }

  var toastTimer = null;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 1800);
  }
  var savedTimer = null;
  function flashSaved(msg) {
    savedFlash.textContent = msg || '已保存 ✓';
    savedFlash.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { savedFlash.classList.remove('show'); }, 1500);
  }
