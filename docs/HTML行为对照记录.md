# HTML 行为对照记录

## 验证方式

以仓库的 `巡检缺陷命名分类工具_怀旧版.html` 为行为来源，不以旧规划中的概括代替源码。
运行 `node tools/capture-html-baseline.cjs`，在隔离 JavaScript 上下文中执行指定的原版纯函数，
生成包含源码 SHA-256 的输入/期望输出 JSON。原生测试读取这些结果，不自行猜测预期。
此脚本只用于开发测试；原生应用运行不读取 HTML，也不依赖 Node.js。

## 已建立的对照

| HTML 函数 | 原生代码 | 本轮证据 | 范围限制 |
|---|---|---|---|
| `cleanDefectFileName` | `FileNameRules.Clean` | 16 个原函数生成用例通过 | 已接入批处理规范命名（含预览确认） |
| `_rawParseFilePrefixAndLocation` 的线路、杆塔解析 | `PathRules.ParseRelative` | 14 个原函数生成用例通过 | 部件 loc 已在 10 组重命名用例中对齐，排序、towerNum 尚未移植 |
| `scanImagesRecursive` 的目录排除 | `PhotoScanner` | 集成测试覆盖成果目录和点号目录排除 | 空目录注册、完整排序尚未对齐 |
| `getDefectCategory` 和 `extractDefectTag` | `DefectCategoryRule` | 8 组原函数对照通过 | 已接入成果保存与分类 |
| `suggestSection` / `getCustomBaseName` | `SectionRules` | 12 组建议、6 组替换通过 | 保存前区段弹窗已接入保存流程 |
| `newNamePreview` 的已选标签分支 | `FileNameRules.Preview` | 5 组原函数对照通过 | 已保存标签自动回填尚未对齐 |
| `computeNewFileName`（照片重命名） | `PhotoRenameRules.ComputeNewFileName` | 10 组原函数生成用例通过（html-rename.json） | 照片重命名已接入目录树双击流程 |
| `clampBox` / `moveBox` / `resizeBox` | `BoxGeometry` | 6 组几何测试对齐原版语义（含越界收敛为 0） | 红框绘制/移动/调整/删除按钮全部接入画布 |
| `hitBox` / `hitHandle` / `hitDeleteBtn` / `drawHandles` | `MainWindow.Canvas` | 屏幕空间命中（容差 4px、手柄 8px、圆钮 13px、偏移 12px）与原版常量一致 | 人工验收待执行 |
| `zoomAt` / `toFit` / `undoLastAction` / `deleteSelectedBox` | `MainWindow.Canvas` | 滚轮 1.15 倍光标缩放、0.1–10 限幅、双击适应、右键平移、Ctrl+Z 先标签后红框 | 人工验收待执行 |
| `refreshTreeStats` / `markBadgeText` | `MainWindow.Tree` | 统计栏（总数/已看/已标/缺陷/杆塔）与线路、杆塔、照片徽章 | 徽章为文本形式，视觉样式未复刻 |
| `getImage` / `evictLRU` / `preload` | `ImageCache` | 距离淘汰（CACHE_LIMIT=4、>2 张丢弃）、单路预加载、解码不入 UI 阻塞 | 与浏览器解码细节不等价 |
| `applyTheme` / `loadPersisted` / `initResizers` / `initNotice` | `MainWindow.Settings` | 深色模式、自定义快捷键、手势开关、线宽与侧栏宽度持久化、首次使用提示（不再提示） | 设置按项目数据库保存，与 localStorage 语义不同 |
| `performRenameLineFolder` / `performRenameTowerFolder` / `performRenamePhoto` | `MainWindow.Tree` | 磁盘重命名 + 相对路径改写 + 重扫保持照片 ID；根目录线路仅提示 | 磁盘失败时不做仅显示名的降级（原生以相对路径为业务键，避免脱同步） |
| `saveCriticalOnly` / `cancelCriticalOnly` / `deleteExistingDefectOutputs` | `OutputService.SaveCriticalOnlyAsync` + `OutputRepository.DeleteCritical` | 独立覆盖保存危急成果：无框确认、裸导线区段拦截、保存后清空红框、危急独立统计不计入已标 | 人工验收待执行 |
| `scanOutputDirectory` / `manifestSet` / `manifestLookup` / `findMatchingInputFile` | `OutputRepository.Sync` + `OutputManifestService` | 「输出清单.json」格式与原版一致（version/savedAt/entries，'/' 相对键），保存/取消/危急/同步/批处理后重建；导入优先 origName/relPath 精确映射，回退 stem 前缀匹配（原版兜底语义） | 旧清单键含大小写差异时按 OrdinalIgnoreCase 解析 |
| `hideDefect` / `restoreHidden` / `loadHidden` | `MainWindow.Rules`（AppSetting hidden_tags） | 候选列表隐藏/恢复，持久化到项目设置 | 隐藏为整表恢复，与原版 Object 键集一致 |
| `moveOrReorderTag` / `reorderCategory` | `RuleEditor`（上移/下移/移动到目标分类） | 标签排序与跨分类移动 | 原版为拖拽交互，原生为按钮等价操作 |
| `getDefectTagsForFile` | `BackfillSavedTags` | 无草稿时按已知标签目录把已保存标签串拆分回填，tagsCleared 语义由草稿存在性承载 | — |
| `autoFitLeftPanelWidth` | `AutoFitLeftWidth` | 打开项目与“自适应”按钮按最长名称估算列宽（中文字宽近似） | 无 canvas 精确测量，宽度为近似值 |
| `discoveredDirs` / `refreshTreeStats` 空杆塔 | `PhotoScanner.ScanWithDirectories` + `PathRules.ParseDirectory` | 空杆塔文件夹显示在目录树（杆塔数 100% 匹配实际文件夹） | 统计计数仍以照片为单位 |
| `updateHud` 位置计数 | `UpdateCounter` | 显示第 X / 共 Y 张；筛选时显示 [已标记/未标记/未看] 集合内位置 | — |

Windows 原生扫描额外跳过 reparse point，避免遍历所选目录之外的路径及链接循环。

## 基础设施验证

- 重扫时按相对路径复用数据库照片 ID，测试包含新增照片、扫描顺序改变和重启。
- 取消成果只删除数据库登记在该照片 ID 下的精确路径，测试验证另一杆塔同名照片成果保留。
- 新增：标记计数、重置已看、单照片重命名、杆塔前缀改写（保持 ID 与标注）集成测试通过。
- 当前尚不支持从旧成果 manifest 导入映射；不能据此声称与原版输出同步功能一致。

## 本轮构建

- 领域测试 57 项、基础设施测试 16 项全部通过；self-contained 发布验证 0 警告。
- 完整解决方案 Release 编译：0 警告、0 错误。
- GitHub Actions 使用仓库解决方案，包含两个测试工程；本轮未执行远程工作流。

## 本轮完成的原生功能

- 画布：左键拖拽画框、点框选中、移动、八向手柄调整、右上角圆钮删除、悬停光标、
  Delete 删选中框、Ctrl+Z 撤回（先撤标签后撤框）、滚轮光标缩放、双击适应、右键/中键平移。
- 成果底图：已标记照片默认显示已保存的缺陷圈示图，可切换纯净原图继续叠加标注；
  保存始终从纯净原图合成，符合“原图成果来自纯净输入”的约束。
- 缓存与预加载：相邻照片单路预加载、按距离淘汰、过期任务丢弃。
- 快捷键：A/D、方向键翻图，空格或 Alt+S 保存（可在设置中另设保存键），
  C 返回最后已看，Delete/Backspace 删除选中框，Ctrl+Z 撤回，鼠标侧键翻图。
- 统计：左侧统计栏（照片/已看/已标/缺陷/杆塔全部已看），线路、杆塔、照片徽章，重置已看。
- 重命名：双击树节点重命名线路/杆塔/照片，磁盘与数据库同步，重扫保持 ID 与标注。
- 设置：深色模式、自定义快捷键、图片区域左右键翻图开关、线宽与侧栏宽度持久化、首次使用提示。
- 批处理：一键分类、补全原图、规范命名均提供进度、成功/失败计数和失败文件列表；
  规范命名执行前提供重命名预览与确认。
- 会话：启动自动恢复上次项目（会话文件），关闭重启后标注、结论、已看、已标状态一致。
- 崩溃日志写入 `%LOCALAPPDATA%\PatrolDefect\crash.log`，操作日志延续 SQLite OperationLog。

## 与原版的等价实现说明（非缺陷）

- `startHoldScrub` 长按连切：原生依赖系统按键自动重复 + 相邻预加载，用户可见行为等价。
- 侧栏标签条目的“危急切换/编辑”按钮：由规则编辑器（分类与推荐规则）承载同一能力。
- `flashSaved`/徽章动效：原生以状态文本与对话框呈现，信息等价、视觉样式不同。
- `copyAndRemoveDirectoryContents`：属原版磁盘重命名的备用方案，原生 `Directory.Move` 已覆盖。

## 启动与分发验证（2026-09-13）

- 首次人工启动发现致命缺陷：App.xaml 缺少 WinUI 控件库必需的
  `<muxc:XamlControlsResources/>` 资源字典，任何含 TreeView 等 WinUI 库控件的窗口
  启动即抛 "Cannot find a Resource with the Name/Key TabViewButtonBackground"。
  该缺陷自首个版本即存在，此前仅靠自动化测试从未人工运行而未暴露；已在最小复现应用
  上定位并修复，本机实测窗口可正常启动并持续运行。
- WindowsAppSDKSelfContained 打包默认携带 84 个语言资源文件夹；
  发布流水线现在裁剪为仅保留 zh-CN/zh-TW（中文界面所需），裁剪后实测启动正常。
- 崩溃日志（%LOCALAPPDATA%\PatrolDefect\crash.log）在本次定位中发挥了实际作用。

## 尚不能宣称完成

- 原生界面人工验收刚起步：应用已可启动，但真实巡检目录与 HTML 输出对比、高 DPI、
  深色模式、异常文件、数百至上千张照片下的性能验证仍需按 `阶段6-发布与最终验收.md` 逐项进行。
- 排序已扩大到 22 组样例（前导零、杆塔数字、T/Pole 混合、多层嵌套），仍可继续扩充字符边界。
- 编译通过与测试通过不代表端到端验收完成；总目标继续保持完整原生复刻。
