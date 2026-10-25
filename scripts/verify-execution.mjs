/**
 * 执行验证（execution test）：真的 import 插件、真的调 apply()、真的发探测。
 *
 * 与另外两个脚本的分工：
 *  - verify-health-colors.mjs : 读源码做正则断言（快，能钉住"某段代码还在"）
 *  - test-queue-order.mjs     : 截出纯函数直接跑（能钉住"算法算得对"）
 *  - verify-execution.mjs     : 装配整套插件跑起来（能钉住"它在真实流程里真的能用"）
 *
 * 为什么必须有这一层：PR 里那两条必修 bug（pingAll 参数声明不匹配、周期探测
 * 启动时序）**都不会让源码断言失败**——代码看起来完全正常，只是运行时被网关
 * 拒绝、或永远排不上定时器。只有真跑一遍才抓得到。
 *
 * 前置：node scripts/prepare-test-deps.mjs
 * 用法：node scripts/verify-execution.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const results = [];
function ok(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
}

// ---- 假 llm：按模型名返回不同的终态，复现四种真实上游行为 ----
const BEHAVIOURS = {
  good: { kind: 'content' },
  auth: { kind: 'error', code: 'AUTH', message: 'invalid api key' },
  empty: { kind: 'empty' },
  rej400: { kind: 'error', code: 'INVALID_REQUEST', message: 'unsupported parameter', status: 400 },
  slow: { kind: 'error', code: 'TIMEOUT', message: 'upstream timeout' },
};
function makeStream({ provider, model, signal }, calls) {
  if (calls) calls.push(`${provider}/${model}`);
  const b = BEHAVIOURS[model] || { kind: 'content' };
  const ac = new AbortController();
  if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
  const chunks = [];
  if (b.kind === 'content') {
    chunks.push({ type: 'text-delta', text: 'p' });
    chunks.push({ type: 'finish', reason: { kind: 'stop' } });
  } else if (b.kind === 'empty') {
    /* 一个帧都不给 → EMPTY_RESPONSE */
  } else {
    chunks.push({ type: 'finish', reason: { kind: 'error', failure: { code: b.code, message: b.message, status: b.status } } });
  }
  return {
    async *[Symbol.asyncIterator]() {
      // 25ms 延迟模拟网络往返：瞬时返回会让"探测进度"窗口窄到任何轮询都抓不到，
      // 那样测出来的"进度不可观测"是测试假象，不是实现缺陷。
      await new Promise((r) => setTimeout(r, 25));
      for (const c of chunks) { if (ac.signal.aborted) return; yield c; }
    },
    async interrupt() { ac.abort(); return true; },
  };
}
/**
 * 每个场景一份独立的假 llm：它自带 calls 数组。
 * 这样"手动探测探了几条"与"后台周期探测探了几条"天然隔离——
 * 用同一个全局计数器会让周期 timer 的调用混进手动断言里（假阳性）。
 */
function makeLlm() {
  const calls = [];
  return {
    calls,
    stream: (req) => makeStream(req, calls),
    listProviders: () => [{ id: 'prov' }],
  };
}

// ---- 假宿主 ----
function makeCtx(settingsValue, injectedLlm) {
  const doc = { ns: 'dsh-model-fallback-queue', revision: 1, value: { ...settingsValue } };
  const events = [];
  // 钩子表：agent/request 与 agent/request-error 的瀑布必须能被真实调用，
  // 否则"覆盖路由时剥档位"这种逻辑只能靠读源码断言——那测不到真实流程。
  const hooks = {};
  const ctx = {
    settings: {
      describe: () => [doc],
      update: async (ns, patch) => { Object.assign(doc.value, patch); doc.revision += 1; return { ok: true, value: doc }; },
    },
    logger: {
      info: (...a) => events.push(['info', ...a]),
      warn: (...a) => events.push(['warn', ...a]),
      debug: () => {},
    },
    on: (name, fn) => { hooks[name] = fn; return () => {}; },
    effect: (fn) => { fn(); return () => {}; },
    plugin: (p) => {
      const Ctor = p && (p.default || p);
      if (typeof Ctor === 'function') {
        try { ctx.__service = new Ctor(ctx, {}); } catch (e) { events.push(['warn', 'svc ctor failed', e.message]); }
      }
      return () => {};
    },
    get: (name) => (name === 'llm' ? injectedLlm : undefined),
    llm: injectedLlm,
    emit: () => {},
  };
  return { ctx, doc, events, hooks };
}

const mod = await import(join(root, 'index.js'));
ok('index.js 可被真实 import', typeof mod.apply === 'function');

// ================= 场景 A：插件能装配 =================
{
  const { ctx } = makeCtx({ enabled: true }, makeLlm());
  let threw = null;
  let plug = null;
  try { plug = mod.apply(ctx, { enabled: true }); } catch (e) { threw = e; }
  ok('apply(ctx, config) 不抛', threw === null, threw?.message || '');
  ok('apply 返回 router 句柄', !!plug?.router);
  // 必须能从 ctx 拿到 llm（旧实现把第二参当 llm，拿到的是 Config 对象）
  ok('llm 从 ctx 取到（不是第二参）', typeof ctx.llm?.stream === 'function');
}

// ================= 场景 B：必修 2 —— 配置预置的周期间隔必须真的排上 =================
// 复现维护者的实测：配置文件写着 pingIntervalMs=60000、从未在 UI 保存过、重启。
// 旧实现里 schedulePing() 跑在 loadSettings() 之前，读到默认值 0 直接 return；
// settings/document-updated 又只在 UI 保存时触发 → 周期探测永远排不上。
//
// ⚠️ 判据不能是"存在活跃 timer"：插件本来就有 15s 的 probeTimer 和 60s 的
// 预检定时器，timer 数恒为正——那样断言在 bug 还原后照样通过（测不出问题）。
// 唯一有区分力的判据：**周期探测是否真的发生了**（假 llm 被调用）。
// 把间隔设成极小值，等一小会儿，看 llm.stream 有没有被周期探针调起来。
{
  const slog = makeLlm();
  const { ctx } = makeCtx({
    enabled: true,
    pingIntervalMs: 40,        // 40ms 一轮 → 几百毫秒内必然触发，且不依赖 UI 保存
    pingSkipPaid: false,
    pingDefaultsMigrated: true, // 已迁移过 → migratePingDefaults 立即 return，
    pingSkipPaidMigrated: true, // 不能指望它兜底调 schedulePing
  }, slog);
  mod.apply(ctx, { enabled: true });
  // 先放一条队列，否则周期探测没东西可探
  await new Promise((r) => setTimeout(r, 120));
  if (ctx.__service) {
    await ctx.__service.setQueue([{ provider: 'p', model: 'good', pinned: false, paid: 'free' }]);
  }
  const before = slog.calls.length;
  await new Promise((r) => setTimeout(r, 400)); // 等至少一整轮周期探测
  const after = slog.calls.length;
  ok('必修2：settings 预置的间隔真的驱动了周期探测',
    after > before, `probe calls before=${before} after=${after}`);
}

// ================= 场景 C/D：必修 1 —— pingAll 真的能跑 =================
{
  const cllm = makeLlm();
  const { ctx } = makeCtx({ enabled: true, pingIntervalMs: 0, pingSkipPaid: false }, cllm);
  mod.apply(ctx, { enabled: true });
  await new Promise((r) => setTimeout(r, 200));

  const svc = ctx.__service;
  ok('RPC 服务已实例化', !!svc);
  if (svc) {
    // 声明与实现同为 0 参：声明错了会让网关拒绝调用（维护者实测的
    // "expected 1 argument(s), got 0"），而实现本身从来不需要参数。
    ok('pingAll 实现声明 0 个形参（与 RPC 声明一致）', svc.pingAll.length === 0, `length=${svc.pingAll.length}`);

    const queue = [
      { provider: 'p', model: 'good', pinned: false, paid: 'free' },
      { provider: 'p', model: 'auth', pinned: false, paid: 'free' },
      { provider: 'p', model: 'empty', pinned: false, paid: 'free' },
      { provider: 'p', model: 'rej400', pinned: false, paid: 'paid' },
      { provider: 'p', model: 'slow', pinned: false, paid: 'paid' },
    ];
    const setRes = await svc.setQueue(queue);
    ok('setQueue 接受队列', setRes?.ok !== false);
    cllm.calls.length = 0; // 只数这次手动探测

    // 探测进行中必须能观测到真实进度（不是恒 0）
    let sawProgress = null;
    const poll = setInterval(async () => {
      try {
        const snap = await svc.snapshot();
        if (snap?.probingAll) sawProgress = { done: snap.probingDone, total: snap.probingTotal };
      } catch { /* 忽略轮询抖动 */ }
    }, 3);

    const pingRes = await svc.pingAll();
    clearInterval(poll);
    const manualCalls = cllm.calls;

    ok('pingAll 返回 ok:true', pingRes?.ok === true, pingRes?.reason || '');
    // 手动探测必须全探：旧默认 pingSkipPaid=true 会让整条付费队列永远"未测"
    ok('手动探测不跳过付费（5 条全探）', manualCalls.length === 5,
      `calls=${manualCalls.length}`);
    ok('探测进度出现真实 done/total', sawProgress !== null && sawProgress.total === 5, JSON.stringify(sawProgress));

    const byModel = Object.fromEntries((pingRes?.results || []).map((r) => [r.model, r.ok]));
    ok('正常路由 → 可用', byModel.good === true, JSON.stringify(byModel));
    ok('AUTH 失效 → 不可用（旧实现会判成健康，比不探更危险）', byModel.auth === false);
    ok('空响应 → 不可用（不冒充可用）', byModel.empty === false);
    ok('上游超时 → 不可用', byModel.slow === false);
    ok('探测体被 400 拒 → 不可用', byModel.rej400 === false);

    const snapAfter = await svc.snapshot();
    const opened = (snapAfter?.entries || []).filter((e) => e.state === 'open').length;
    // 监控不能把自己监控死：探测失败只记证据，不许累计熔断
    ok('探测失败不会自己熔断路由', opened === 0, `open=${opened}`);
    ok('探测结束后进度已清空', snapAfter?.probingAll === false);
  }
}

// ================= 场景 F：推理档位 —— 覆盖路由必须剥掉，能力不匹配不算路由死亡 =======
// 复现真实报错：会话模型（支持 balanced）→ 插件覆盖到 qodercn/qfmodel（不支持）→
// 宿主 resolveCallWithInfo 本地抛 UNSUPPORTED_REASONING_EFFORT，请求一条都没发出去。
// 旧实现 `{ ...cfg, provider, model }` 会把 reasoningEffort 原样带过去，于是：
//   探测（不带档位）判健康 → 真实请求必挂 → 挂的还记在路由头上。
{
  const { ctx, hooks } = makeCtx({ enabled: true, pingIntervalMs: 0, p1Follow: false }, makeLlm());
  const plug = mod.apply(ctx, { enabled: true });
  await new Promise((r) => setTimeout(r, 150));
  const svc = ctx.__service;
  ok('捕获到 agent/request 钩子', typeof hooks['agent/request'] === 'function');
  ok('捕获到 agent/request-error 钩子', typeof hooks['agent/request-error'] === 'function');

  if (svc && hooks['agent/request']) {
    await svc.setQueue([
      { provider: 'p', model: 'good', pinned: false },
      { provider: 'p', model: 'auth', pinned: false },
    ]);
    const cfg = { provider: 'host', model: 'flagship', reasoningEffort: 'balanced', maxTokens: 100, temperature: 0.5 };
    const out = await hooks['agent/request'](
      { agent: { session: { id: 'sess-reasoning' } } },
      async () => cfg,
    );
    ok('覆盖到队列路由', out?.provider === 'p' && out?.model === 'good', `${out?.provider}/${out?.model}`);
    ok('覆盖路由时剥离 reasoningEffort（否则宿主本地拒绝，请求发不出去）',
      out?.reasoningEffort === undefined, `reasoningEffort=${JSON.stringify(out?.reasoningEffort)}`);
    ok('其余请求字段原样保留', out?.maxTokens === 100 && out?.temperature === 0.5);
    ok('不修改宿主传进来的原对象', cfg.reasoningEffort === 'balanced');

    // 能力不匹配：不能算路由死亡，但必须允许切走（换台支持档位的模型就能救）
    const errRes = await hooks['agent/request-error']({
      provider: 'p',
      agent: { session: { id: 'sess-reasoning' }, callConfig: { model: 'good' } },
      failure: {
        code: 'UNSUPPORTED_REASONING_EFFORT',
        message: 'provider "p" model "good" does not support reasoning effort "balanced"',
      },
    }, async () => undefined);
    const snap = await svc.snapshot();
    const failedEntry = (snap?.entries || []).find((e) => e.model === 'good');
    ok('能力不匹配不熔断失败路由（模型本身没坏）',
      failedEntry?.state !== 'open', `state=${failedEntry?.state}`);
    ok('能力不匹配被识别为 capability 而不是 unknown（否则会被当路由故障）',
      failedEntry?.lastError?.source === 'capability', `source=${failedEntry?.lastError?.source}`);
    ok('能力不匹配仍然切换（换路由能救这一轮请求）', errRes?.kind === 'retry', JSON.stringify(errRes));
  }
}

// ================= 场景 G：P1 放行时不动用户自己的档位 =================
{
  const { ctx, hooks } = makeCtx({ enabled: true, pingIntervalMs: 0, p1Follow: true }, makeLlm());
  const plug = mod.apply(ctx, { enabled: true });
  await new Promise((r) => setTimeout(r, 150));
  const svc = ctx.__service;
  if (svc && hooks['agent/request']) {
    await svc.setQueue([{ provider: 'p', model: 'auth', pinned: false }]);
    const out = await hooks['agent/request'](
      { agent: { session: { id: 'sess-p1' } } },
      async () => ({ provider: 'host', model: 'flagship', reasoningEffort: 'balanced' }),
    );
    ok('P1 放行时保留用户档位（没换模型就别动它）',
      out?.reasoningEffort === 'balanced' && out?.provider === 'host',
      `${out?.provider}/${out?.model} effort=${JSON.stringify(out?.reasoningEffort)}`);
  }
}

// ================= 场景 E：全部 pinned 时退化为原顺序 =================
{
  const { ctx } = makeCtx({ enabled: true, pingIntervalMs: 0 }, makeLlm());
  const plug = mod.apply(ctx, { enabled: true });
  await new Promise((r) => setTimeout(r, 200));
  const svc = ctx.__service;
  if (svc) {
    await svc.setQueue([
      { provider: 'p', model: 'good', pinned: true, paid: 'free' },
      { provider: 'p', model: 'auth', pinned: true, paid: 'free' },
    ]);
    const snap = await svc.snapshot();
    ok('全 pinned 时条目仍完整可见', (snap?.entries || []).length === 2);
    ok('snapshot 透出 pinned 字段', snap?.entries?.every((e) => e.pinned === true) === true);
  }
  ok('router 暴露 circuitOf（探测记账所需）', typeof plug?.router?.circuitOf === 'function');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
  console.error(`\n失败项：`);
  for (const f of failed) console.error(`  - ${f.name}${f.extra ? ` (${f.extra})` : ''}`);
}
// 插件自带 15s/60s 常驻 timer（宿主进程里本就常驻），验证脚本必须显式退出。
process.exit(failed.length ? 1 : 0);
