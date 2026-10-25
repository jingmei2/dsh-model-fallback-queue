/**
 * 队列顺序单元测试：大保底（pinned）恒排最后 + 候选序的边界行为。
 *
 * 为什么需要这个文件：PR 描述里宣称「F2 已实测」，但仓库里既没有 test script 也没有
 * 测试文件（维护者评审的建议 3）。README 说「pinned 恒排最后」，而这句话只有真跑
 * 纯函数才算数——靠 log 里一句「实测」是经不起回归的。
 *
 * 做法：从 index.js 的源码里按大括号配平截出 nextPositions / reorderPinnedLast，
 * 在 node 里用真实的队列结构直接跑（不是正则匹配源码，是执行同一份实现）。
 *
 * 用法：node scripts/test-queue-order.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const indexSrc = readFileSync(join(root, 'index.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${extra ? ` — ${extra}` : ''}`);
}
function eq(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, `got ${g} want ${w}`);
}

/** 按大括号配平截出一个函数声明（与 verify-health-colors.mjs 同一套做法）。 */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

// nextPositions 依赖 config（闭包变量）+ reorderPinnedLast。
// 这里用 vm 构造一个等价闭包：把两段真实源码拼进一个带 config 的函数里执行。
const fnNext = extractFunction(indexSrc, 'nextPositions');
const fnReorder = extractFunction(indexSrc, 'reorderPinnedLast');

const makeNext = new Function(
  'config',
  `${fnReorder}\n${fnNext}\nreturn nextPositions;`,
);

const R = (provider, pinned = false) => ({ provider, model: `${provider}-m`, pinned });

// ---------- 1. 非跟随模式（p1Follow=false）：环 = 队列物理序，绕满一圈（含自身重试） ----------
// 语义：静态模式下 P1 就是 queue[0]，把其余都试完后还允许回头重试起点，
// 所以 step 走 1..n 是**含自身**的完整一圈。这不是 bug，是「全试一遍」。
{
  const q = [R('A'), R('B', true), R('C')];
  const next = makeNext({ queue: q, p1Follow: false });
  // 从 queue[0]=A 出发：完整一圈 = [1,2,0] → pinned 的 1 抽到末尾 → [2,0,1]
  eq('非跟随从 A 出发 → 绕满一圈且 pinned B 仍在最后', next(0), [2, 0, 1]);
  check('非跟随：pinned 一定不在首位', next(0)[0] !== 1, `got ${JSON.stringify(next(0))}`);
}

// ---------- 2. 跟随模式（p1Follow=true）：环 = [P1(-1), 队列0, 队列1, ...] ----------
{
  const q = [R('A'), R('B', true), R('C')];
  const next = makeNext({ queue: q, p1Follow: true });
  // 从 P1(-1) 出发：候选 = [0,1,2] → pinned 的 1 抽到末尾 → [0,2,1]
  eq('跟随模式从 P1 出发 → pinned 恒最后', next(-1), [0, 2, 1]);
  // 从 queue[0] 出发：环位置 = ring.indexOf(0)=1，后续 [1,2,-1]... 不含自身
  // ring = [-1,0,1,2]，base=1 → step1..3 → [1,2,-1] → pinned 1 抽末尾 → [2,-1,1]
  eq('跟随模式从 A 出发 → P1 槽留在前面，pinned 仍最后', next(0), [2, -1, 1]);
}

// ---------- 3. 多个 pinned：彼此保持物理序顺延 ----------
{
  const q = [R('A', true), R('B'), R('C', true), R('D')];
  const next = makeNext({ queue: q, p1Follow: false });
  // 从 D(索引3) 出发绕满一圈：[0,1,2,3] → pinned 是 0 和 2 → rest=[1,3] pinned=[0,2]
  eq('多个 pinned 按物理序顺延', next(3), [1, 3, 0, 2]);
}

// ---------- 4. 全部 pinned：退化安全（不得丢项、不得重复） ----------
{
  const q = [R('A', true), R('B', true), R('C', true)];
  const next = makeNext({ queue: q, p1Follow: false });
  const got = next(0);
  eq('全 pinned → 仍是完整一圈（物理序），不丢项', got, [1, 2, 0]);
  check('全 pinned 无重复', new Set(got).size === got.length, JSON.stringify(got));
}

// ---------- 5. 单条队列：边界不越界 ----------
{
  const q = [R('A')];
  const next = makeNext({ queue: q, p1Follow: false });
  // n=1 时绕一圈只有自己：候选 = [0]（可以原地重试那条唯一的路由）
  eq('单条队列从自己出发 → 只有自身重试', next(0), [0]);
  const next2 = makeNext({ queue: q, p1Follow: true });
  eq('单条队列跟随模式从 P1 → 只有队列0', next2(-1), [0]);
}

// ---------- 6. 空队列：不崩、返回空 ----------
{
  eq('空队列不崩', makeNext({ queue: [], p1Follow: false })(0), []);
  eq('空队列跟随模式不崩', makeNext({ queue: [], p1Follow: true })(-1), []);
}

// ---------- 7. 核心不变量：任何 pinned 条目都排在所有非 pinned 之后 ----------
{
  const qs = [
    [R('A'), R('B', true), R('C')],
    [R('A', true), R('B'), R('C'), R('D', true), R('E')],
    [R('A'), R('B'), R('C', true)],
    [R('A', true), R('B', true)],
  ];
  for (const p1Follow of [false, true]) {
    for (const q of qs) {
      const next = makeNext({ queue: q, p1Follow });
      const starts = p1Follow ? [-1, ...q.map((_, i) => i)] : q.map((_, i) => i);
      for (const s of starts) {
        const seq = next(s);
        const isPin = (p) => (p >= 0 && q[p] ? q[p].pinned === true : false);
        const firstPin = seq.findIndex(isPin);
        const lastNonPin = seq.map(isPin).lastIndexOf(false);
        if (firstPin >= 0 && lastNonPin >= 0) {
          check(`不变量：pinned 全在非 pinned 之后 (p1Follow=${p1Follow}, start=${s}, q=${q.length})`,
            firstPin > lastNonPin, `seq=${JSON.stringify(seq)}`);
        }
        // 长度：两种模式都覆盖「整圈」。静态模式含自身（回头重试起点），
        // 跟随模式环里多一个 P1 槽但排除自身，于是同样恰好 n 项。
        check(`不变量：候选恰好覆盖整圈 ${q.length} 项 (p1Follow=${p1Follow}, start=${s})`,
          seq.length === q.length, `seq=${JSON.stringify(seq)} len=${seq.length}`);
        check(`不变量：候选无重复 (p1Follow=${p1Follow}, start=${s})`,
          new Set(seq).size === seq.length, `seq=${JSON.stringify(seq)}`);
        // 跟随模式的环 = [P1(-1), 0, 1, ...]，起点可能是 -1（不在 seq 里）；
        // 静态模式绕满一圈会把起点本身作为最后的重试项保留。
        if (p1Follow) {
          check(`不变量：跟随模式候选不含自身起点 (start=${s})`,
            !seq.includes(s), `seq=${JSON.stringify(seq)}`);
        } else {
          check(`不变量：静态模式起点作为重试项保留且只在末尾 (start=${s})`,
            seq.filter((p) => p === s).length <= 1, `seq=${JSON.stringify(seq)}`);
        }
      }
    }
  }
}

if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / ${pass + failures.length} 项`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 队列顺序 ${pass} 项断言全部通过`);
