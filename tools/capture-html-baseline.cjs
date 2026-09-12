const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sourceName = "巡检缺陷命名分类工具_怀旧版.html";
const source = fs.readFileSync(path.join(root, sourceName), "utf8");
const start = source.indexOf("  function cleanDefectFileName(name)");
const end = source.indexOf("  async function safeRenameFileHandle", start);
if (start < 0 || end < start) throw new Error("HTML baseline function boundaries changed");
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context, { timeout: 1000 });
const inputs = [
  "", "无扩展名_变压器1", "变压器1.jpg", "绝缘子 (2).jpg",
  "变压器-1.JPG", "变压器_1.jpg", "变压器【二】.png",
  "线路10_#001_变压器1_导线断股.jpg",
  "线路10_#001_变压器 (2)_1_导线断股.jpg",
  "线路10_#001_变压器_（三）_导线断股.jpg",
  "线路10_#001_变压器_导线断股2.jpg",
  "线路10_#001_变压器_1_2_导线断股.jpg",
  "部件_绝缘子 (2).png", "线路__部件1.jpg",
  "线路10_#001_部件１２_缺陷.jpg", "部件.细节1.jpeg"
];
const result = {
  source: sourceName,
  sha256: crypto.createHash("sha256").update(source).digest("hex"),
  function: "cleanDefectFileName",
  cases: inputs.map(input => ({ input, expected: context.cleanDefectFileName(input) }))
};
const target = path.join(root, "tests/PatrolDefect.Domain.Tests/Fixtures");
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "html-clean-names.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Captured ${result.cases.length} cases directly from ${sourceName}`);

const parserStart = source.indexOf("  var towerRegex =");
const parserEnd = source.indexOf("  /* ================= 打开文件夹", parserStart);
if (parserStart < 0 || parserEnd < parserStart) throw new Error("HTML parser boundaries changed");
context.savedInputName = "巡检";
context.lastInputHandle = null;
vm.runInContext(source.slice(parserStart, parserEnd), context, { timeout: 1000 });
const paths = [
  "线路一/杆塔001/照片.jpg", "线路一/#001/照片.jpg",
  "线路一/#001/DCIM/100MEDIA/DJI_0001.jpg",
  "#001/可见光/照片.jpg", "10kV东山支线/照片.jpg",
  "项目/东山支线/Tower12/细部/绝缘子.jpg",
  "IMG_20260101_001.jpg", "照片.jpg", "线路_#012_绝缘子.jpg",
  "线路/001/变压器.jpg", "线路/12号杆/红外/照片.jpg",
  "线路/Pole-003/DCIM/照片.jpg", "线路/12#支线/照片.jpg",
  "项目/线路/第12号杆/绝缘子.jpg"
];
const pathCases = paths.map(input => {
  const parsed = context._rawParseFilePrefixAndLocation(input.split("/").at(-1), input);
  return { input, line: parsed.prefix, tower: parsed.tower };
});
fs.writeFileSync(path.join(target, "html-paths.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, root: "巡检", cases: pathCases
}, null, 2) + "\n");
console.log(`Captured ${pathCases.length} path cases directly from HTML`);

const sortStart = source.indexOf("  function dirOf(p)");
const sortEnd = source.indexOf("  function setupFiles(", sortStart);
if (sortStart < 0 || sortEnd < sortStart) throw new Error("HTML sorting boundaries changed");
context.parseFilePrefixAndLocation = context._rawParseFilePrefixAndLocation;
vm.runInContext(source.slice(sortStart, sortEnd), context, { timeout: 1000 });
const sortInputs = [
  "线路10/#1/照片1.jpg", "线路2/#10/照片2.jpg", "线路2/#2/照片10.jpg",
  "线路2/#2/照片2.jpg", "线路2/#1/照片1.jpg", "线路2/#2-1/照片1.jpg",
  "线路2/#2-2/照片1.jpg", "线路2/#2/DCIM/照片1.jpg",
  "东山支线/#1/照片1.jpg", "南山支线/#1/照片1.jpg",
  "线路2/#001/照片1.jpg", "线路2/#2/照片01.jpg",
  "线路2/#02/照片1.jpg", "线路2/#002/照片1.jpg",
  "线路2/#2号/照片1.jpg", "线路2/第12号杆/照片1.jpg",
  "线路2/T2/照片1.jpg", "线路2/T10/照片1.jpg",
  "线路2/Pole-003/照片1.jpg", "线路2/#100/照片1.jpg",
  "线路2/#20/照片A.jpg", "线路2/#2/#3/照片1.jpg"
];
const expectedOrder = sortInputs.map(relPath => ({ name: relPath.split("/").at(-1), relPath }))
  .sort(context.comparePhotos).map(photo => photo.relPath);
fs.writeFileSync(path.join(target, "html-sort.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, root: "巡检", input: sortInputs, expected: expectedOrder
}, null, 2) + "\n");
console.log(`Captured sorting of ${sortInputs.length} photos directly from HTML`);

const criticalStart = source.indexOf("  var CRITICAL_DEFECTS =");
const criticalEnd = source.indexOf("  var CRITICAL_DEFECT_SET", criticalStart);
const defaultsStart = source.indexOf("  var DEFAULT_DEFECT_DICT =");
const defaultsEnd = source.indexOf("  var ICONS =", defaultsStart);
if ([criticalStart, criticalEnd, defaultsStart, defaultsEnd].some(index => index < 0))
  throw new Error("HTML default data boundaries changed");
vm.runInContext(source.slice(criticalStart, criticalEnd), context, { timeout: 1000 });
vm.runInContext(source.slice(defaultsStart, defaultsEnd), context, { timeout: 1000 });
const defaults = {
  SourceSha256: result.sha256,
  Categories: context.DEFAULT_DEFECT_DICT,
  Recommendations: context.DEFAULT_LOCATION_ADJACENCY,
  CriticalTags: context.CRITICAL_DEFECTS,
  KnownPositions: context.KNOWN_POSITIONS
};
const resourceDirectory = path.join(root, "src/PatrolDefect.Domain/Data");
fs.mkdirSync(resourceDirectory, { recursive: true });
fs.writeFileSync(path.join(resourceDirectory, "default-rules.json"), JSON.stringify(defaults, null, 2) + "\n");
console.log(`Captured ${Object.keys(defaults.Categories).length} categories, ` +
  `${Object.values(defaults.Categories).flat().length} tags, ${defaults.CriticalTags.length} critical tags, ` +
  `${Object.keys(defaults.Recommendations).length} recommendation sources`);

const sectionStart = source.indexOf("  function isSectionRange(str)");
const sectionEnd = source.indexOf("  async function promptBareWireSection", sectionStart);
if (sectionStart < 0 || sectionEnd < sectionStart) throw new Error("Section function boundaries changed");
vm.runInContext(source.slice(sectionStart, sectionEnd), context, { timeout: 1000 });
const sectionInputs = [
  ["", ""], ["默认杆塔", ""], ["#001", ""], ["009A", ""],
  ["#63-1", ""], ["#63-01", ""], ["001-002", ""], ["#001-#100", ""],
  ["#001", "#005"], ["#001", "#001"], ["12号杆", ""], ["#9", ""]
];
const sectionCases = sectionInputs.map(([tower, next]) => ({
  tower, next, expected: context.suggestSection(tower, next), isRange: context.isSectionRange(tower)
}));
const customCases = [
  ["线路_#001_导线.jpg", "#001-#100", "线路/#001/线路_#001_导线.jpg"],
  ["线路_#001-#002_导线.jpg", "#010-#020", "线路/#001/线路_#001-#002_导线.jpg"],
  ["大号侧通道.jpg", "#001-#010", "线路/#001/大号侧通道.jpg"],
  ["线路_001_导线.jpg", "#010-#020", "线路/#001/线路_001_导线.jpg"],
  ["照片.jpg", "", "照片.jpg"],
  ["变压器.jpg", " #63-1-#63-2 ", "线路/#63-1/变压器.jpg"]
].map(([name, section, relative]) => {
  context.state = { files: [{ relPath: relative }], index: 0 };
  return { name, section, relative, expected: context.getCustomBaseName(name, { sectionRange: section }) };
});
fs.writeFileSync(path.join(target, "html-sections.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, suggestions: sectionCases, custom: customCases
}, null, 2) + "\n");
console.log(`Captured ${sectionCases.length} section suggestions and ${customCases.length} custom names`);

const previewStart = source.indexOf("  function newNamePreview()");
const previewEnd = source.indexOf("  function updateTreeCurrentDefectTag", previewStart);
if (previewStart < 0 || previewEnd < previewStart) throw new Error("Preview boundaries changed");
vm.runInContext(source.slice(previewStart, previewEnd), context, { timeout: 1000 });
const previews = [
  { name: "照片.jpg", appended: ["_杆塔-倾斜", "_杆塔-破损"], section: "" },
  { name: "照片.PNG", appended: [], section: "" },
  { name: "照片.jpg", appended: ["自定义标签"], section: "" },
  { name: "照片.jpg", appended: ["_标签", "_标签"], section: "" },
  { name: "线路_#001_导线.jpg", appended: ["_导线-裸导线"], section: "#001-#100" }
].map(input => {
  context.curName = () => input.name;
  context.getMeta = () => ({ appended: input.appended, sectionRange: input.section, tagsCleared: true });
  context.state = { files: [{ relPath: input.name }], index: 0 };
  return { ...input, expected: context.newNamePreview().full };
});
fs.writeFileSync(path.join(target, "html-preview.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, cases: previews
}, null, 2) + "\n");

const categoryStart = source.indexOf("  function extractDefectTag(");
const categoryEnd = source.indexOf("  function getDefectTagsForFile(", categoryStart);
if (categoryStart < 0 || categoryEnd < categoryStart) throw new Error("Category boundaries changed");
vm.runInContext(source.slice(categoryStart, categoryEnd), context, { timeout: 1000 });
const categories = [
  ["绝缘破损", ["螺栓松动"], "", ""],
  ["绝缘破损", [""], "", ""],
  ["", [], "绝缘子.jpg", "绝缘子.jpg"],
  ["", [], "照片.jpg", "照片_导线-裸导线.jpg"],
  ["", [], "照片.jpg", "前缀照片_绝缘破损.jpg"],
  ["", [], "旧照片.jpg", "线路__新照片_绝缘破损.jpg"],
  ["", null, "", "其他_裸导线.jpg"],
  ["螺栓松动", [], "", "绝缘破损.jpg"]
].map(([tag, appended, original, output]) => ({
  tag, appended, original, output,
  expected: context.getDefectCategory(tag, appended, original, output),
  extracted: context.extractDefectTag(original, output)
}));
fs.writeFileSync(path.join(target, "html-categories.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, cases: categories
}, null, 2) + "\n");

const renameStart = source.indexOf("  function computeNewFileName(oldFileName, oldLoc, newLocInput)");
const renameEnd = source.indexOf("  async function performRenamePhoto", renameStart);
if (renameStart < 0 || renameEnd < renameStart) throw new Error("Rename boundaries changed");
vm.runInContext(source.slice(renameStart, renameEnd), context, { timeout: 1000 });
const renameInputs = [
  ["巡检", "线路10_#001_变压器.jpg", "绝缘子"],
  ["巡检", "线路10_#001_变压器.jpg", ""],
  ["巡检", "线路10_#001_变压器.jpg", "线路10_#001_绝缘子"],
  ["巡检", "线路10_#001_变压器.jpg", "线路10_#001_变压器.jpg"],
  ["巡检", "线路__变压器.jpg", "绝缘子"],
  ["巡检", "线路10_#001_变压器_绝缘子.jpg", "金具"],
  ["巡检", "DJI_001.JPG", "变压器"],
  ["巡检", "变压器.jpg", "绝缘子.jpg"],
  ["巡检", "线路10_#001_变压器.jpg", "变压器.jpg"],
  ["线路", "线路__变压器.jpg", "绝缘子"]
];
const renameCases = renameInputs.map(([root, name, input]) => {
  context.savedInputName = root;
  const parsed = context.parseFilePrefixAndLocation
    ? context.parseFilePrefixAndLocation(name, name)
    : context._rawParseFilePrefixAndLocation(name, name);
  return {
    root, name, input, loc: parsed.loc,
    expected: context.computeNewFileName(name, parsed.loc, input)
  };
});
fs.writeFileSync(path.join(target, "html-rename.json"), JSON.stringify({
  source: sourceName, sha256: result.sha256, cases: renameCases
}, null, 2) + "\n");
console.log(`Captured ${renameCases.length} photo rename cases directly from HTML`);
