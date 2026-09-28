// 统计对齐脚本（原仓库的 sync-stats.ps1 改写成 Node，macOS 和 CI 都能跑）：
// 重算全书的统计数字，回写 README.md、index.html、tools/og.html，再用 Chrome 无头截图
// 重出 og.png，末尾自动跑一遍交叉引用与说人话检查。
//
//   node tools/sync-stats.mjs                  # 改数字 + 重出 og.png + 跑检查
//   node tools/sync-stats.mjs --no-screenshot  # 只改数字，不动 og.png（CI 用）
//
// 只替换数字本身，不动任何其他文字；跑完逐项打印 旧 -> 新，没变化的标（未变）。
// 数字口径：条目数 = book/*.md 里的 ### 标题数；A/B/C = 证据等级行的首字母（带（争议）后缀的照样算）；
// 争议 = 备注以「争议」开头的条数；TODO = 正文里含「待核实」或「TODO」的行数；
// 链接 = 「- 来源：」和「- 备注：」行里的 http(s) 总数；性价比三档的规则抄自 index.html。
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_SHOT = process.argv.includes('--no-screenshot');
const read = p => readFileSync(resolve(ROOT, p), 'utf8');
const write = (p, s) => writeFileSync(resolve(ROOT, p), s);

// ---------- 先确认 index.html 的两行没有被人改过，改了这里的算法就得跟着改 ----------
const indexHtml = read('index.html');
const COST_W_LINE = "const COST_W = { money:{'0':0,'少':1,'多':2}, time:{'少':0,'中':1,'多':2}, will:{'否':0,'些':1,'是':2} };";
const RATIO_LINE = "e.ratio = e.level === '大' ? (e.cs === 0 ? '极高' : (e.cs <= 2 ? '高' : '一般'))";
if (!indexHtml.includes(COST_W_LINE)) throw new Error('index.html 的 COST_W 行变了，请同步本脚本里的成本权重');
if (!indexHtml.includes(RATIO_LINE)) throw new Error('index.html 的 e.ratio 行变了，请同步本脚本里的档位规则');

const W = { money: { 0: 0, 少: 1, 多: 2 }, time: { 少: 0, 中: 1, 多: 2 }, will: { 否: 0, 些: 1, 是: 2 } };
const ratioOf = (cost, level) => {
  if (level === '大') return cost === 0 ? '极高' : (cost <= 2 ? '高' : '一般');
  if (level === '中' && cost === 0) return '高';
  return '一般';
};

const files = readdirSync(resolve(ROOT, 'book')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
let entries = 0, dispute = 0, todo = 0, links = 0;
const grade = { A: 0, B: 0, C: 0 };
const ratio = { 极高: 0, 高: 0, 一般: 0 };
for (const f of files) {
  for (const line of readFileSync(resolve(ROOT, 'book', f), 'utf8').split(/\r?\n/)) {
    if (/^### /.test(line)) entries++;
    const g = /^- 证据等级：([ABC])/.exec(line);
    if (g) grade[g[1]]++;
    if (/^- 备注：争议/.test(line)) dispute++;
    if (/待核实|TODO/.test(line)) todo++;
    if (/^- (来源|备注)：/.test(line)) links += (line.match(/https?:\/\//g) || []).length;
    const tag = /<!--\s*成本标签:\s*钱=(\S+)\s+时间=(\S+)\s+毅力=(\S+)\s+收益=(\S+)\s+口径=/.exec(line);
    if (tag) ratio[ratioOf((W.money[tag[1]] ?? 0) + (W.time[tag[2]] ?? 0) + (W.will[tag[3]] ?? 0), tag[4])]++;
  }
}
const sections = files.length;
const tagged = ratio.极高 + ratio.高 + ratio.一般;
if (tagged !== entries) console.warn(`警告：有 ${entries - tagged} 条缺成本标签，性价比三档对不上条目数`);
if (grade.A + grade.B + grade.C !== entries) console.warn('警告：证据等级行数和条目数对不上，检查有没有条目漏写证据等级');

// 三档百分比用最大余数法分配：先向下取整，剩下的百分点按小数部分从大到小补，保证加起来正好 100
const pct = {}, rem = {};
for (const k of ['极高', '高', '一般']) {
  const exact = entries ? ratio[k] * 100 / entries : 0;
  pct[k] = Math.floor(exact);
  rem[k] = exact - pct[k];
}
let short = 100 - (pct.极高 + pct.高 + pct.一般);
for (const k of ['极高', '高', '一般'].sort((a, b) => rem[b] - rem[a])) {
  if (short-- > 0) pct[k]++;
}

console.log(`条目 ${entries} ｜ A ${grade.A} B ${grade.B} C ${grade.C} ｜ 争议 ${dispute} ｜ TODO ${todo} ｜ 链接 ${links}`);
console.log(`性价比 极高 ${ratio.极高}（${pct.极高}%） 高 ${ratio.高}（${pct.高}%） 一般 ${ratio.一般}（${pct.一般}%）`);
console.log('');

const edits = [
  { file: 'README.md', label: '首屏条目数', re: /(\d+) 条建议/g, new: `${entries} 条建议` },
  { file: 'README.md', label: '条目徽章', re: /%E6%9D%A1%E7%9B%AE-(\d+)%20%E6%9D%A1/g, new: `%E6%9D%A1%E7%9B%AE-${entries}%20%E6%9D%A1` },
  { file: 'README.md', label: '证据分级徽章', re: /A%20\d+%20%C2%B7%20B%20\d+%20%C2%B7%20C%20\d+/g, new: `A%20${grade.A}%20%C2%B7%20B%20${grade.B}%20%C2%B7%20C%20${grade.C}` },
  { file: 'README.md', label: '文献链接徽章', re: /-\d+%20%E6%9D%A1%E9%93%BE%E6%8E%A5/g, new: `-${links}%20%E6%9D%A1%E9%93%BE%E6%8E%A5` },
  { file: 'README.md', label: '怎么读里的 A 级数', re: /大型试验的 (\d+) 条/g, new: `大型试验的 ${grade.A} 条` },
  { file: 'README.md', label: '怎么读里的极高条数', re: /勾选性价比「极高」，得到 (\d+) 条/g, new: `勾选性价比「极高」，得到 ${ratio.极高} 条` },
  { file: 'README.md', label: '证据分级段', re: /全书 \d+ 条中 A 级 \d+ 条、B 级 \d+ 条、C 级 \d+ 条，另有 \d+ 条标注了争议、\d+ 处/g, new: `全书 ${entries} 条中 A 级 ${grade.A} 条、B 级 ${grade.B} 条、C 级 ${grade.C} 条，另有 ${dispute} 条标注了争议、${todo} 处` },
  { file: 'README.md', label: '性价比段', re: /全书 \d+ 条中性价比极高 \d+ 条（\d+%）、高 \d+ 条（\d+%）、一般 \d+ 条（\d+%）/g, new: `全书 ${entries} 条中性价比极高 ${ratio.极高} 条（${pct.极高}%）、高 ${ratio.高} 条（${pct.高}%）、一般 ${ratio.一般} 条（${pct.一般}%）` },
  { file: 'index.html', label: '描述里的条目数', re: /(\d+) 条建议/g, new: `${entries} 条建议` },
  { file: 'index.html', label: 'numberOfPages', re: /numberOfPages":\d+/g, new: `numberOfPages":${entries}` },
  { file: 'index.html', label: '页头节数与条目数', re: /\d+ 节 (\d+) 条/g, new: `${sections} 节 ${entries} 条` },
  { file: 'tools/og.html', label: 'og 条目数', re: /<b>\d+<\/b> 条建议/g, new: `<b>${entries}</b> 条建议` },
  { file: 'tools/og.html', label: 'og A 级数', re: /A 级证据 <b>\d+<\/b> 条/g, new: `A 级证据 <b>${grade.A}</b> 条` },
  { file: 'tools/og.html', label: 'og 链接数', re: /<b>\d+<\/b> 条原始文献链接/g, new: `<b>${links}</b> 条原始文献链接` },
];

for (const edit of edits) {
  const text = read(edit.file);
  const hits = text.match(edit.re);
  if (!hits) throw new Error(`${edit.file} 里找不到「${edit.label}」，模式：${edit.re}`);
  const old = /(\d+)/.exec(hits[0])?.[1] ?? '?';
  const updated = text.replace(edit.re, edit.new);
  if (updated === text) {
    console.log(`  ${edit.file} ${edit.label}：${old}（未变）`);
    continue;
  }
  write(edit.file, updated);
  console.log(`  ${edit.file} ${edit.label}：${old} -> 已更新（${hits.length} 处）`);
}

// 重算交叉引用对照表：插入或删除条目会让后面的「第 X 条」集体错位，而错位后的条号
// 往往仍在范围内，只有把「引用 → 目标标题」摊开入库，diff 才看得见。
console.log('');
const refs = spawnSync(process.execPath, [resolve(ROOT, 'tools/check-refs.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (refs.status !== 0) throw new Error('check-refs.mjs 失败');
console.log('提交前扫一眼 docs/引用对照.md 的 diff：条号没动而「指向的条目」变了，就是被顺延撞歪的引用。');
console.log('');
const plain = spawnSync(process.execPath, [resolve(ROOT, 'tools/check-plain.mjs')], { cwd: ROOT, stdio: 'inherit' });
if (plain.status !== 0) console.log('上面列出的说人话不合格，提交前改掉（规则见 tools/check-plain.mjs 文件头）。');

if (NO_SHOT) process.exit(0);

// ---------- 重出 og.png：每次用全新的 user-data-dir，否则 Chrome 会拿缓存里的旧 og.html 渲染 ----------
const target = resolve(ROOT, 'og.png');
const source = pathToFileURL(resolve(ROOT, 'tools/og.html')).href;
const profile = resolve(tmpdir(), 'og-shot-' + Math.random().toString(36).slice(2));
const started = Date.now();
const chromePath = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean).find(p => existsSync(p) || !p.includes('/'));
if (!chromePath) throw new Error('找不到 Chrome。装一个，或用 CHROME=/path/to/chrome 指路；只改数字可以加 --no-screenshot');
mkdirSync(profile, { recursive: true });
// macOS 上无头 Chrome 截完图有时不退出，会一直挂着。给它 60 秒上限，超时不当失败——
// 图片写没写、大小对不对，下面的自检说了算。
const shot = spawnSync(chromePath, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', '--window-size=1200,630', '--virtual-time-budget=5000',
  `--user-data-dir=${profile}`, `--screenshot=${target}`, source,
], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
if (shot.error?.code === 'ETIMEDOUT') console.log('（Chrome 截图后没退出，按超时处理，继续看图片自检结果）');
rmSync(profile, { recursive: true, force: true });
if (shot.status !== 0 && shot.error?.code !== 'ETIMEDOUT') throw new Error(`Chrome 截图失败（退出码 ${shot.status}）：${String(shot.stderr).slice(0, 400)}`);

// 自检：文件是这次写的、大小在正常区间。过了这两关就不必再打开图看
const st = statSync(target);
if (st.mtimeMs < started - 2000) throw new Error('og.png 没有被这次运行写入，截图失败了');
if (st.size < 50000 || st.size > 800000) throw new Error(`og.png 大小异常（${st.size} 字节），打开看一眼是不是渲染坏了`);
console.log('');
console.log(`og.png 已重出：${st.size} 字节，自检通过。改过 tools/og.html 的版式才需要打开图确认。`);
