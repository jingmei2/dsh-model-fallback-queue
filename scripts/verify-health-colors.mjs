/**
 * 颜色语义回归：健康色只表示"多久前确认过可用"。
 *
 * 这次修的三个问题，都会在这里变成断言：
 *  1. 免费/付费不得再用绿/琥珀着色（价格和健康抢同一个颜色通道）；
 *  2. 芯片颜色必须来自生效路由的健康，不再是 `p1Active ? ok : warn`（"离开 P1 就黄"）；
 *  3. 熔断状态 closed 但没有新鲜证据时不能给绿色（否则"没测过"冒充"健康"）。
 *
 * 用法：node scripts/verify-health-colors.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const client = readFileSync(join(root, 'client.js'), 'utf8');
const index = readFileSync(join(root, 'index.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass += 1; return; }
  failures.push(`${name}${extra ? ` — ${extra}` : ''}`);
}
function mustMatch(name, src, re) {
  check(name, re.test(src), re.toString());
}
function mustNotMatch(name, src, re) {
  check(name, !re.test(src), re.toString());
}

/** 从源码里按大括号配平截出一个函数声明（用于在 node 里直接跑纯函数）。 */
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
function extractConst(src, name) {
  const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
  if (!m) throw new Error(`const ${name} not found`);
  return m[1];
}

// ---------- 1. 价格不再占用颜色通道 ----------
const paidTagSrc = extractFunction(client, 'paidTag');
mustNotMatch('paidTag 不再用绿色', paidTagSrc, /#3a9e5f/);
mustNotMatch('paidTag 不再用琥珀色', paidTagSrc, /#c98a1b/);
mustMatch('paidTag 使用中性 secondary 色', paidTagSrc, /label-secondary/);

// ---------- 2. 芯片颜色来自健康，而不是"在不在 P1" ----------
mustNotMatch('芯片 tone 不再由 p1Active 决定', client, /tone = p1Active \? 'ok' : 'warn'/);
mustMatch('芯片取生效路由条目', client, /const effEntry = effective < 0 \? p1Entry : entries\.find/);
mustMatch('芯片颜色来自 healthOf', client, /tone = effHealth\.tone/);
mustMatch('标题徽章颜色也来自 health', client, /h\(Badge, \{ tone: effHealth\.tone \}, t\('badgeCurrent'/);
mustMatch('面板底部有颜色图例', client, /t\('legendHealth'\)/);

// ---------- 3. 服务端下发前瞻证据 ----------
mustMatch('探测成功记账', index, /stampProbe\(true\)/);
mustMatch('探测失败记账', index, /stampProbe\(false\)/);
mustMatch('探测记录耗时', index, /c\.probeLatencyMs = Date\.now\(\) - startedAt/);
mustMatch('真实成功也刷新 lastOkAt', index, /c\.lastOkAt = Date\.now\(\)/);
for (const f of ['lastOkAt', 'lastProbeAt', 'probeLatencyMs', 'probeOk']) {
  mustMatch(`snapshot 暴露 ${f}`, index, new RegExp(`${f}: c\\.${f}`));
}
mustMatch('snapshot 暴露 pingIntervalMs', index, /pingIntervalMs: Number\(config\.pingIntervalMs\) \|\| 0/);
mustMatch('snapshot 暴露 pingSkipPaid', index, /pingSkipPaid: config\.pingSkipPaid !== false/);
mustMatch('默认周期探测为 60s', index, /pingIntervalMs: 60_000/);
mustMatch('一次性迁移已接线', index, /await migratePingDefaults\(\)/);
mustMatch('切换后立刻探测目标路由', index, /serviceBridge\?\.probeRoute\?\.\(route\)/);
mustMatch('probeRoute 已进 bridge', index, /probeAllRoutes, probeRoute \}/);

// ---------- 4. 双语键齐全 ----------
const keys = [
  'healthOk', 'healthSlow', 'healthProbeFailed', 'healthUnprobed', 'healthUnprobedHint',
  'healthSkipPaidHint', 'healthStale', 'healthAgo', 'healthProbeMs', 'healthVerifying',
  'healthRecoverIn', 'healthUnknown', 'legendHealth',
];
const zhStart = client.indexOf('      zh: {');
const enStart = client.indexOf('      en: {');
const zhBlock = client.slice(zhStart, enStart);
const enBlock = client.slice(enStart, client.indexOf('    function t(key, params)'));
for (const k of keys) {
  check(`中文键 ${k}`, new RegExp(`\\b${k}:`).test(zhBlock));
  check(`英文键 ${k}`, new RegExp(`\\b${k}:`).test(enBlock));
}

// ---------- 5. 真跑 healthOf：状态矩阵 ----------
const fmtAgeSrc = extractFunction(client, 'fmtAge');
const staleSrc = extractConst(client, 'HEALTH_STALE_MS');
const slowSrc = extractConst(client, 'HEALTH_SLOW_MS');
const healthSrc = extractFunction(client, 'healthOf');
const stubT = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
const makeHealth = new Function(
  't',
  `${fmtAgeSrc}\nconst HEALTH_STALE_MS = ${staleSrc};\nconst HEALTH_SLOW_MS = ${slowSrc};\n${healthSrc}\nreturn healthOf;`,
);
const healthOf = makeHealth(stubT);
const now = 1_000_000_000;
const snap = { pingIntervalMs: 60_000, pingSkipPaid: true };

const cases = [
  ['null 条目 → 灰', healthOf(null, snap, now), 'muted'],
  ['配置失效 → 红', healthOf({ invalid: true }, snap, now), 'error'],
  ['熔断中 → 红', healthOf({ state: 'open', recoverAt: now + 30_000 }, snap, now), 'error'],
  ['半开 → 黄', healthOf({ state: 'half_open' }, snap, now), 'warn'],
  ['closed 且从未测过 → 灰', healthOf({ state: 'closed', lastOkAt: null, lastProbeAt: null }, snap, now), 'muted'],
  ['closed 且刚探测成功 → 绿', healthOf({ state: 'closed', lastProbeAt: now - 5_000, lastOkAt: now - 5_000, probeOk: true, probeLatencyMs: 800 }, snap, now), 'ok'],
  ['closed 且探测失败 → 黄', healthOf({ state: 'closed', lastProbeAt: now - 5_000, probeOk: false }, snap, now), 'warn'],
  ['closed 且证据过期 → 灰', healthOf({ state: 'closed', lastProbeAt: now - 60 * 60_000, lastOkAt: now - 60 * 60_000, probeOk: true }, snap, now), 'muted'],
  ['closed 但响应很慢 → 黄', healthOf({ state: 'closed', lastProbeAt: now - 5_000, lastOkAt: now - 5_000, probeOk: true, probeLatencyMs: 9_000 }, snap, now), 'warn'],
  ['真实请求成功也算证据', healthOf({ state: 'closed', lastOkAt: now - 5_000 }, snap, now), 'ok'],
  ['付费且未测过 → 灰并解释跳过', healthOf({ state: 'closed', paid: 'paid', lastOkAt: null, lastProbeAt: null }, snap, now), 'muted'],
  ['老宿主快照（无证据字段）→ 退回旧语义绿', healthOf({ state: 'closed' }, snap, now), 'ok'],
];
for (const [name, got, want] of cases) {
  check(name, got && got.tone === want, `got ${got && got.tone} want ${want}`);
}
const skipPaidDetail = healthOf({ state: 'closed', paid: 'paid', lastOkAt: null, lastProbeAt: null }, snap, now).detail;
check('未验证的付费条目解释"跳过付费"', skipPaidDetail === 'healthSkipPaidHint', skipPaidDetail);
const unverifiedFree = healthOf({ state: 'closed', paid: 'free', lastOkAt: null, lastProbeAt: null }, snap, now).detail;
check('未验证的免费条目解释"没有结果"', unverifiedFree === 'healthUnprobedHint', unverifiedFree);
// 周期探测关掉时，过期阈值回落到固定 15 分钟
const offSnap = { pingIntervalMs: 0, pingSkipPaid: true };
check('探测关闭时 16 分钟前的证据算过期',
  healthOf({ state: 'closed', lastOkAt: now - 16 * 60_000 }, offSnap, now).tone === 'muted');
check('探测关闭时 10 分钟前的证据仍算可用',
  healthOf({ state: 'closed', lastOkAt: now - 10 * 60_000 }, offSnap, now).tone === 'ok');

if (failures.length) {
  console.error(`✗ ${failures.length} 项失败 / ${pass + failures.length} 项`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 全部 ${pass} 项通过`);
