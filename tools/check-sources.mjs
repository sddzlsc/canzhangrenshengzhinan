// 来源可达检查：把 book/*.md 里每条「- 来源：」行里的 http(s) 链接挨个请求一遍，
// 看它现在还打不打得开。
//
//   node tools/check-sources.mjs          # 列出打不开的，有真失败则退出码 1
//   node tools/check-sources.mjs --all    # 连通的也列出来
//   node tools/check-sources.mjs --timeout 40000
//
// 分三类：
//   可达    2xx / 3xx（跟着跳转之后）
//   被拦    401 403 406 429 —— 出版社和部分政府站点对脚本一律 403，这不是失效。
//           这些来源在 docs/核实记录 里注明了「403 但已用 Crossref / PubMed 元数据核对」。
//   失败    404 410、5xx、网络错误、超时 —— 这些要人工看一眼，可能是链接写错或者官方页面搬家。
// CI 里这一步挂的是 continue-on-error，挡不住发布，只做提示。
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALL = process.argv.includes('--all');
const tIdx = process.argv.indexOf('--timeout');
const TIMEOUT = tIdx > -1 ? Number(process.argv[tIdx + 1]) : 25000;

// 链接尾巴可能带中文标点和括号：Lancet 的 DOI 本身就含括号
// （10.1016/S0140-6736(15)01225-8），所以只裁「落单的右括号」和句读。
function trimUrl(u) {
  let t = '';
  for (;;) {
    const ch = u.slice(-1);
    const unbalanced = ch === ')' && (u.split('(').length < u.split(')').length);
    if (!/[）。,，；;、】」』]/.test(ch) && !unbalanced) break;
    t = ch + t; u = u.slice(0, -1);
  }
  return u;
}

const files = readdirSync(resolve(ROOT, 'book')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
const found = new Map();   // url -> [「节文件 条目标题」...]
let current = '';
const add = url => {
  url = trimUrl(url);
  if (!found.has(url)) found.set(url, []);
  found.get(url).push(current);
};
for (const f of files) {
  for (const line of readFileSync(resolve(ROOT, 'book', f), 'utf8').split(/\r?\n/)) {
    const h = /^### (\d+)\. (.*)$/.exec(line);
    if (h) current = `${f.slice(0, 2)}-${h[1]}`;
    if (!/^- 来源：/.test(line)) continue;
    const wrapped = [...line.matchAll(/<(https?:\/\/[^>\s]+)>/g)].map(m => m[1]);
    for (const u of wrapped) add(u);
    for (const m of line.matchAll(/https?:\/\/[^\s<>「」『』，、；;]+/g)) {
      if (wrapped.includes(m[0])) continue;
      add(m[0]);
    }
  }
}
const urls = [...found.keys()];
console.log(`来源链接 ${urls.length} 条，去重后逐个请求，超时 ${TIMEOUT / 1000} 秒。`);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const results = new Map();

async function check(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/json,*/*' }, signal: AbortSignal.timeout(TIMEOUT) });
    const s = res.status;
    if (s >= 200 && s < 400) return { kind: 'ok', note: String(s) };
    if ([401, 403, 406, 429].includes(s)) return { kind: 'blocked', note: String(s) };
    return { kind: 'fail', note: String(s) };
  } catch (err) {
    return { kind: 'fail', note: (err && err.name === 'TimeoutError') ? '超时' : String(err && err.message || err) };
  }
}

let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < urls.length) {
    const url = urls[i++];
    results.set(url, await check(url));
  }
}));

const byKind = { ok: [], blocked: [], fail: [] };
for (const url of urls) byKind[results.get(url).kind].push(url);

const where = url => found.get(url).slice(0, 3).join('、') + (found.get(url).length > 3 ? ' 等' : '');
if (ALL) {
  console.log('');
  for (const url of byKind.ok) console.log(`  可达  ${results.get(url).note}  ${url}`);
}
console.log('');
console.log(`可达 ${byKind.ok.length} ｜ 被反爬拦住 ${byKind.blocked.length} ｜ 打不开 ${byKind.fail.length}`);
if (byKind.blocked.length) {
  console.log('');
  console.log('被拦住的（不算失败，核实记录里注明用 Crossref / PubMed 元数据核对过）：');
  for (const url of byKind.blocked) console.log(`  ${results.get(url).note}  ${url}（${where(url)}）`);
}
if (byKind.fail.length) {
  console.log('');
  console.log('打不开的，逐条人工看一眼：');
  for (const url of byKind.fail) console.log(`  ${results.get(url).note}  ${url}（${where(url)}）`);
  console.log('');
  console.log('判据：官方页面搬家就换成新地址；链接写错就改对；来源真没了就换一条来源并把核实记录一起改。');
  process.exit(1);
}
console.log('');
console.log('没有打不开的链接。');
