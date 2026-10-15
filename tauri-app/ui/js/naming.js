// 智能线路/杆塔提取、关联图谱匹配、裸导线区段与命名规范化


  /* ================= 智能线路/支线、子文件夹杆塔与位置精确提取（标准切分不漏字） ================= */

  var parsedFileCache = new Map();
  function parseFilePrefixAndLocation(filename, relPath) {
    var key = (relPath || '') + ':::' + (filename || '');
    var cached = parsedFileCache.get(key);
    if (cached) return cached;
    var res = _rawParseFilePrefixAndLocation(filename, relPath);
    parsedFileCache.set(key, res);
    return res;
  }

  var towerRegex = /(?:#\s*\d+(?:[-~_]\d+|[A-Za-z])?(?:[-~_]#?\s*\d+(?:[-~_]\d+|[A-Za-z])*)?(?:号?[杆塔基]|#)?|\d+\s*#\s*(?:号?[杆塔基])(?!(?:支线|主线|联络线|专线|回线|线路|线))|\d+\s*#(?![\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#]*(?:支线|主线|联络线|专线|回线|线路|线))|\d+\s*号(?:杆塔|[杆塔基])|\d+\s*(?:杆塔|[杆塔基])|第\s*\d+(?:[-~_]\d+|[A-Za-z])?\s*号?[杆塔基]|\d+[-~_]\d+(?:号?[杆塔基]|跨|档)|(?:[PTGNptgn]|Tower|Pole)\s*[-_]?\s*\d+(?:[-~_]\d+|[A-Za-z])?|^\d+(?:[-_]\d+)?$)/i;

  function isTowerFolderName(name) {
    if (!name) return false;
    var s = String(name).trim();
    if (!s) return false;
    // 排除常见内部非杆塔文件夹（相机内部文件夹、拍摄类别子目录、常见系统文件夹）
    if (/^(?:DCIM|\d+MEDIA|PANORAMA|PANO|可见光|红外|红外测温|测温|细部|全景|通道|无人机|照片|图片|待检|未检|新建文件夹|其他|其它)$/i.test(s)) return false;
    // 排除线路文件夹名（包含主线/支线/联络线/专线/线路等，或带电压等级如 10kV）
    if (/(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|工程)/.test(s)) return false;
    if (/(?:10|35|110|220|500|750|1000)\s*(?:k|kV|KV|千伏)/i.test(s)) return false;
    return towerRegex.test(s);
  }

  function extractLineAndTowerFromDirParts(dirParts, rootLineName) {
    var line = '';
    var tower = '';
    var rootName = rootLineName || savedInputName || (lastInputHandle && lastInputHandle.name) || '默认线路';

    if (!dirParts || dirParts.length === 0) {
      return { prefix: rootName, tower: '', towerNum: 999999 };
    }

    // 从后往前寻找第一个满足杆塔命名规则的目录层级
    var towerIdx = -1;
    for (var i = dirParts.length - 1; i >= 0; i--) {
      var seg = dirParts[i].trim();
      if (isTowerFolderName(seg)) {
        tower = seg;
        towerIdx = i;
        break;
      }
    }

    if (towerIdx >= 0) {
      // 杆塔上方的最近一层目录就是线路名
      if (towerIdx > 0) {
        line = dirParts[towerIdx - 1].trim();
      } else {
        line = rootName;
      }
    } else {
      // 目录层级中没有显式杆塔：最后一层可能是线路名
      var lastSeg = dirParts[dirParts.length - 1].trim();
      var isLine = /(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|工程)/.test(lastSeg) ||
                   /(?:10|35|110|220|500|750|1000)\s*(?:k|kV|KV|千伏)/i.test(lastSeg);
      if (isLine) {
        line = lastSeg;
      } else if (dirParts.length >= 2) {
        line = dirParts[0].trim();
      } else {
        line = rootName;
      }
      tower = ''; // 留空，以便后续从文件名提取杆塔
    }

    var towerNum = 999999;
    if (tower) {
      var numM = tower.match(/\d+/);
      if (numM) towerNum = parseInt(numM[0], 10);
    }
    return { prefix: line || rootName, tower: tower, towerNum: towerNum };
  }

  function parseDirToLineAndTower(dirPath, rootLineName) {
    var rel = String(dirPath || '').replace(/\\/g, '/');
    var parts = rel.split('/').filter(Boolean);
    return extractLineAndTowerFromDirParts(parts, rootLineName);
  }

  function _rawParseFilePrefixAndLocation(filename, relPath) {
    var rawName = String(filename || '');
    var base = rawName.replace(/\.[^.]+$/, '');
    var rel = String(relPath || filename || '').replace(/\\/g, '/');
    var parts = rel.split('/').filter(Boolean);
    var dirParts = parts.slice(0, -1);
    var rootLineName = savedInputName || (lastInputHandle && lastInputHandle.name) || '默认线路';

    // 1. 核心首选：从实际文件夹层级结构精准提取线路和杆塔
    var dirParsed = extractLineAndTowerFromDirParts(dirParts, rootLineName);
    var line = dirParsed.prefix;
    var tower = dirParsed.tower;
    var towerNum = dirParsed.towerNum;

    // 2. 若目录未体现杆塔，从文件名安全提取杆塔
    if (!tower || tower === '默认杆塔') {
      var isCameraSeq = /^(?:DJI|IMG|DSC|DCIM|PANO|VID|SCREENSHOT|QQ图片|微信图片)/i.test(base);
      var segs = base.split(/[_\s]+/).filter(Boolean);
      for (var j = 0; j < segs.length; j++) {
        var s = segs[j];
        var stm = s.match(towerRegex);
        if (stm && (stm[0] === s || /^[#PTGN\d]/i.test(s))) {
          tower = stm[0].replace(/\s+/g, '');
          break;
        } else if (!isCameraSeq && /^\d+$/.test(s) && (j === 0 || j === 1)) {
          var n = parseInt(s, 10);
          tower = '#' + (s.length >= 3 ? s : (n < 10 ? '0' + n : n));
          break;
        }
      }
      if (!tower) {
        var rawTm = base.match(towerRegex);
        if (rawTm) tower = rawTm[0].replace(/\s+/g, '');
      }
    }

    // 3. 若仍无线路，检查文件名
    if (!line || line === '默认线路') {
      var lineVolRegex = /(?:(?:10|35|110|220|500|750|1000)\s*(?:k|kV|KV|千伏)[\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]*?(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|线|工程))/i;
      var lineGenRegex = /[\u4e00-\u9fa5\u2160-\u217fA-Za-z0-9_#\-\(\)（）]{2,}?(?:支线|主线|联络线|专线|回线|备用线|电缆线|线路|工程)/;
      var cleanForLine = base.replace(/(?:导线|避雷线|接地线|地线|引流线|拉线|跳线)(?:线夹|绑带|连接)?/g, '');
      var fLm = cleanForLine.match(lineVolRegex) || cleanForLine.match(lineGenRegex);
      if (fLm) line = fLm[0].trim();
      else line = rootLineName;
    }

    if (tower) {
      var numM = tower.match(/\d+/);
      if (numM) towerNum = parseInt(numM[0], 10);
    } else {
      tower = '默认杆塔';
    }

    // 4. 提取位置部件 loc（去掉线路和杆塔后剩余的纯部件文字，如 大号侧通道、杆号牌）
    var locClean = base;
    if (line && line !== '默认线路') locClean = locClean.split(line).join('');
    if (tower && tower !== '默认杆塔') locClean = locClean.split(tower).join('');
    locClean = locClean.replace(/^10k[Vv]?[\u4e00-\u9fa5\u2160-\u217f0-9_#\-]+?__/i, '');
    locClean = locClean.replace(/^[_\-—\s#]+|[_\-—\s#]+$/g, '').trim();

    return {
      prefix: line || '默认线路',
      tower: tower,
      towerNum: towerNum,
      loc: locClean || base
    };
  }


  /* ================= 位置提取与相近关联图谱匹配 ================= */

  function detectLocation(name) {
    var raw = String(name || '');
    var parsed = parseFilePrefixAndLocation(raw, '');
    var targetLoc = parsed.loc;

    for (var i = 0; i < KNOWN_POSITIONS.length; i++) {
      var kp = KNOWN_POSITIONS[i];
      if (targetLoc === kp || targetLoc.indexOf(kp) >= 0) {
        return kp;
      }
    }

    return targetLoc || raw.replace(/\.[^.]+$/, '');
  }

  function getRelatedPositions(loc) {
    if (!loc) return [];
    var related = [];
    var added = {};
    added[loc] = true;

    if (locationAdjacency[loc]) {
      var direct = locationAdjacency[loc];
      for (var i = 0; i < direct.length; i++) {
        if (!added[direct[i]]) {
          related.push(direct[i]);
          added[direct[i]] = true;
        }
      }
    }

    for (var key in locationAdjacency) {
      if (loc.indexOf(key) >= 0 || key.indexOf(loc) >= 0) {
        var subDirect = locationAdjacency[key];
        for (var j = 0; j < subDirect.length; j++) {
          if (!added[subDirect[j]]) {
            related.push(subDirect[j]);
            added[subDirect[j]] = true;
          }
        }
      }
    }

    return related;
  }


  /* ================= 规范化命名工具（去除变压器1等模板多余数字编号） ================= */

  function cleanDefectFileName(name) {
    if (!name || typeof name !== 'string') return name;
    var dotIdx = name.lastIndexOf('.');
    if (dotIdx < 0) return name;
    var ext = name.slice(dotIdx);
    var base = name.slice(0, dotIdx);

    // 文件名切分格式支持：
    // 1. 标准下划线分割：线路前缀(0) _ 杆塔号(1) _ 部件位置(2) _ [可选序号(3)] _ [缺陷描述...]
    // 2. 杆塔文件夹内部单文件名：变压器1.jpg、绝缘子 (2).jpg、变压器-1.jpg、变压器_1.jpg
    var parts = base.split('_');
    if (parts.length >= 3) {
      // 仅清洗第 2 段（部件位置，如将 _变压器 (2)_ 清洗为 _变压器_）
      parts[2] = parts[2].replace(/[\s（\(【\[#\-_]*[\d一二三四五六七八九十]+[\s）\)】\]#\-_]*$/, '');
      // 若第 3 段也是纯数字/序号（如 线路_#001_变压器_1 或 线路_#001_变压器_1_导线断股），清洗掉多余序号段
      if (parts.length >= 4 && /^[\s（\(【\[#\-_]*[\d一二三四五六七八九十]+[\s）\)】\]#\-_]*$/.test(parts[3])) {
        parts.splice(3, 1);
      }
      return parts.join('_') + ext;
    } else if (parts.length === 2) {
      if (/^[\s（\(【\[#\-_]*[\d一二三四五六七八九十]+[\s）\)】\]#\-_]*$/.test(parts[1])) {
        return parts[0] + ext;
      } else {
        parts[1] = parts[1].replace(/[\s（\(【\[#\-_]*[\d一二三四五六七八九十]+[\s）\)】\]#\-_]*$/, '');
        return parts.join('_') + ext;
      }
    } else if (parts.length === 1) {
      var cleaned = base.replace(/[\s（\(【\[#\-_]*[\d一二三四五六七八九十]+[\s）\)】\]#\-_]*$/, '');
      return cleaned + ext;
    }
    return name;
  }

  async function safeRenameFileHandle(dirHandle, fileHandle, oldName, newName) {
    if (oldName === newName) return true;
    var renamed = false;
    if (fileHandle && typeof fileHandle.move === 'function') {
      try {
        await fileHandle.move(newName);
        renamed = true;
      } catch (moveErr) {
        // move() 在本地目录 picker 句柄下通常会抛出 NotSupportedError，转入备用方案
      }
    }
    if (!renamed && dirHandle && fileHandle) {
      var file = await fileHandle.getFile();
      var newTarget = await dirHandle.getFileHandle(newName, { create: true });
      var w = await newTarget.createWritable();
      await w.write(file);
      await w.close();
      try { await dirHandle.removeEntry(oldName); } catch (remErr) {}
      renamed = true;
    }
    return renamed;
  }


  /* ================= 裸导线区段与命名辅助 ================= */

  function isSectionRange(str) {
    if (!str) return false;
    if ((str.match(/#/g) || []).length >= 2) return true;
    if (/^#?\d{2,}[-_~]#?\d{2,}$/.test(str)) return true;
    if (/^#?\d+[-_]\d+[-_~]#?\d+/.test(str)) return true;
    return false;
  }

  function suggestSection(tower, nextTower) {
    if (nextTower && tower && tower !== nextTower && tower !== '默认杆塔' && nextTower !== '默认杆塔') {
      var pNext = nextTower.startsWith('#') ? nextTower : ('#' + nextTower);
      var pCur = tower.startsWith('#') ? tower : ('#' + tower);
      return pCur + '-' + pNext;
    }
    if (!tower || tower === '默认杆塔') return '#001-#002';
    if (isSectionRange(tower)) return tower;
    var prefix = tower.startsWith('#') ? '#' : '';
    var mSub = tower.match(/^#?(\d+)[-_](\d+)$/);
    if (mSub) {
      var mainNum = mSub[1];
      var subNum = parseInt(mSub[2], 10);
      return prefix + mainNum + '-' + subNum + '-' + prefix + mainNum + '-' + (subNum + 1);
    }
    var mSingle = tower.match(/^#?(\d+)([A-Za-z]?)$/);
    if (mSingle) {
      var numStr = mSingle[1];
      var suffix = mSingle[2] || '';
      var len = numStr.length;
      var n = parseInt(numStr, 10);
      var nextN = String(n + 1);
      if (len > 1 && nextN.length < len) {
        nextN = nextN.padStart(len, '0');
      }
      return prefix + numStr + suffix + '-' + prefix + nextN + suffix;
    }
    return tower + '-';
  }

  function getCustomBaseName(name, m) {
    if (!name) return '';
    var rawBase = name.slice(0, name.lastIndexOf('.'));
    if (!m || !m.sectionRange) return rawBase;
    var section = String(m.sectionRange || '').trim();
    if (!section) return rawBase;

    var f = (state.files && state.files[state.index]) || curFile();
    var relPath = (f && f.relPath) || '';
    var parsed = parseFilePrefixAndLocation(name, relPath);

    // 1. 如果原始名已包含区段格式（如 #001-#002 或 #63-1-#63-2），整段优先替换
    var secRegex = /#?\d+(?:[-_]\d+)?[-_~]#?\d+(?:[-_]\d+)?/;
    if (secRegex.test(rawBase)) {
      return rawBase.replace(secRegex, section);
    }

    // 2. 如果原始名包含解析出的杆塔名，精准替换为输入区段 (如 10kV周吴115主线_#63-1_大号侧通道 -> 10kV周吴115主线_#001-#100_大号侧通道)
    if (parsed.tower && parsed.tower !== '默认杆塔' && rawBase.indexOf(parsed.tower) >= 0) {
      return rawBase.replace(parsed.tower, section);
    }

    // 3. 如果包含下划线/空格隔开的杆塔编号（如 _001_ 或 #001_）
    var towerBare = (parsed.tower || '').replace(/^#/, '');
    if (towerBare) {
      var segRegex = new RegExp('([_\\s])#?' + towerBare + '([_\\s]|$)', 'i');
      if (segRegex.test(rawBase)) {
        return rawBase.replace(segRegex, function(m0, p1, p2) { return p1 + section + p2; });
      }
    }

    // 4. 如果不含杆塔名（如大号侧通道.jpg），但能解析出线路名
    if (parsed.prefix && parsed.prefix !== '默认线路') {
      var loc = parsed.loc || rawBase;
      return parsed.prefix + '_' + section + '_' + loc;
    }

    return section + '_' + rawBase;
  }

  async function promptBareWireSection(name, m, isSaving) {
    if (!name || !m) return true;
    var f = curFile() || (state.files && state.files[state.index]);
    var relPath = (f && f.relPath) || '';
    var parsed = parseFilePrefixAndLocation(name, relPath);
    var nextTower = '';
    if (state.files && state.index >= 0 && state.index + 1 < state.files.length) {
      var nextF = state.files[state.index + 1];
      var nextParsed = parseFilePrefixAndLocation(nextF.name, nextF.relPath);
      if (nextParsed && nextParsed.tower && nextParsed.tower !== parsed.tower && nextParsed.tower !== '默认杆塔') {
        nextTower = nextParsed.tower;
      }
    }
    var defaultSec = m.sectionRange || suggestSection(parsed.tower, nextTower);

    var descText = isSaving
      ? '检测到当前保存的图片已标记「裸导线」缺陷。请输入命名区段（如：#001-#100），将自动替换杆塔号；直接回车确认保存：'
      : '检测到当前标记了「裸导线」缺陷。请输入命名区段（如：#001-#100），将自动替换文件名中的杆塔号；若保持原名请直接回车：';

    var secInput = await showPromptDialog({
      title: '裸导线区段命名',
      desc: descText,
      placeholder: '例如：#001-#100 或 #63-1-#63-2',
      defaultValue: defaultSec
    });

    if (secInput === null) {
      return false; // 用户取消
    }

    m.sectionRange = secInput.trim();
    m.sectionPrompted = true;
    renderSide();
    if (m.sectionRange) {
      toast('✓ 已设置命名区段：' + m.sectionRange);
    }
    return true;
  }
