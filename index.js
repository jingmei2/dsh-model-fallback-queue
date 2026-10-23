/**
 * dsh-model-fallback-queue — Host half.
 *
 * 模型故障转移队列：
 * - agent/request (waterfall): 当 P1 熔断/粘滞切换生效时，用队列中下一个可用路由覆盖
 *   本次请求的 provider/model（返回 {...next值, provider, model}）。
 * - agent/request-error (waterfall): 请求失败时判定熔断码；命中即时码或软阈值则熔断
 *   当前路由，并返回 { kind: 'retry' } 让 agent-loop 用新配置重试同一步。
 * - agent/assistant-stream (emit): end/committed 判定成功，重置熔断计数。
 *
 * 设计要点（docs/design-plan.md）：
 * - 熔断器三态 Closed/Open/HalfOpen，纯内存，进程重启归零。
 * - failbackMode: sticky(粘滞,默认) / probe(探测回切) / manual(手动回切)。
 * - 非致命码走 next() 让路给 dsh-llm-retry 同路由重试。
 * - 插件任何异常不得拦截请求：全部 try/catch 兜底 next()。
 */

/**
 * 运行态变更通知事件名。
 * 宿主（dsh-api-remotes）只转发白名单里的事件，这个不在白名单上，到不了浏览器 ——
 * 客户端靠轮询 snapshot 的 revision 感知变化。emit 保留：将来宿主支持转发时会自动生效。
 */
const CHANGE_EVENT = 'dsh-model-fallback-queue/changed';

/** 配置级健康：路由的 provider/model 是否真实存在。INVALID = 重试无意义，直接跳过 */
const HEALTH = { OK: 'ok', INVALID: 'invalid' };

const DEFAULT_IMMEDIATE_CODES = [
  'QUOTA',
  'ACCOUNT_QUOTA',
  'RATE_LIMIT',
  'AUTH',
  'INVALID_CREDENTIAL',
  'NO_ADAPTER',
  // PI_AI_ERROR / UNKNOWN 刻意不在这里：它们是适配层的"分类失败"兜底（dsh-llm-pi-ai
  // 的 classifyPiAiError 兜底是 PI_AI_ERROR，dsh-agent-loop 的失败兜底是 UNKNOWN），
  // 本身不携带"是谁的问题"的信息。把它们当即时码 = 任何不认识的失败都换一次路由，
  // 会把 Runtime 自伤（TypeError、`is not a function`）和请求侧问题误判成 provider 故障。
  // 现在改由 classifyFailureSource() 按来源分层判定。
];

const DEFAULT_CONFIG = {
  enabled: false,
  queue: [], // [{ provider, model }]，索引 0 = P1。来源是 state 文件，不是 settings
  p1Follow: true, // P1 跟随当前模型（用户在 UI 手动换模型时 P1 自动跟随）
  immediateCodes: DEFAULT_IMMEDIATE_CODES,
  failureThreshold: 2,
  cooldownMs: 60_000,
  failbackMode: 'sticky', // 'sticky' | 'probe' | 'manual'
  failbackDelayMs: 5 * 60_000, // probe 模式防抖
  // 周期全员 ping 间隔（ms）；0 = 关闭。
  // 默认 60s 打开：没有周期探测时，UI 里的"健康"只能反映上一次真实请求的结果，
  // 而空闲路由可能早就死了（key 失效/模型下架）却一直显示正常——没有前瞻性。
  // 探测发的是 maxTokens=1 的微型请求，且默认跳过付费条目（pingSkipPaid），成本可控。
  pingIntervalMs: 60_000,
  // 周期扫描是否跳过付费条目。默认 false：后备队列常常整条都是付费模型，
  // 跳过付费 = 一行有颜色的状态都看不到（全是「未测」），「提前检测」就成了一句空话。
  // 探测是 maxTokens=1 的微型请求，成本可忽略；真不想花配额可在设置页关掉。
  pingSkipPaid: false,
  // 一次性迁移：旧默认 true（跳过付费）会让全付费队列永远停在「未验证」，
  // 升级时翻一次；用户之后自己改回去就永久尊重。
  pingSkipPaidMigrated: false,
  // 一次性迁移标记：老版本默认 0（关闭），而 settings 会把默认值也落盘，
  // 所以「0」既可能是"用户故意关掉"也可能是"从没设置过"。升级时用这个键把关一次，
  // 之后用户把间隔改回 0 就永久尊重，不再自动改。
  pingDefaultsMigrated: false,
};

/** settings 里不允许出现的键：queue 已迁到 state 文件 */
const SETTINGS_EXCLUDED_KEYS = ['queue'];

const CIRCUIT = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

/**
 * 客户端错误码：请求本身有问题（参数不合法、内容被策略拒绝），换模型也救不了。
 * 这类失败不能算路由不健康，也不能触发跨路由切换。
 *
 * UNKNOWN / PI_AI_ERROR 不在这里：它们可能是 "connection error." 也可能是 provider
 * 把内部异常当文案回传，无法区分，按即时熔断处理（宁可切一次，别让坏路由一直被选中）。
 */
const CLIENT_FAULT_CODES = new Set([
  'INVALID_ARGS',
  'INVALID_REQUEST',
  'BAD_REQUEST',
  'CONTEXT_WINDOW_EXCEEDED',
  'IMAGE_OFFLOAD_REQUIRED',
  'ABORTED',
]);

function isClientFaultCode(code) {
  return typeof code === 'string' && CLIENT_FAULT_CODES.has(code);
}

/** 失败来源分类（见 classifyFailureSource） */
const FAILURE_SOURCE = { PROVIDER: 'provider', TRANSPORT: 'transport', UNKNOWN: 'unknown', CALLER: 'caller' };

/** 适配层的"分类失败"兜底码：本身不携带"是谁的问题"的信息 */
const FALLBACK_CODES = new Set(['PI_AI_ERROR', 'UNKNOWN']);

/** 传输层码：链路瞬时故障，重试常能自愈 */
const TRANSPORT_CODES = new Set(['TIMEOUT', 'TRANSPORT', 'SERVER', 'EMPTY_RESPONSE']);

/** 调用侧自伤特征：这些文本只能出自 Runtime 内部（插件/宿主 bug），不会是 provider 文案 */
const SELF_FAULT_TEXT = /is not a function|cannot read propert|is not a constructor|undefined is not an object|TypeError|ReferenceError/i;

/** HTTP 状态码里明确指向"密钥/额度/模型不可用"的：上游自己承认问题源 */
const PROVIDER_STATUS = new Set([401, 402, 403, 404, 429]);

/** 请求体类状态码：换模型救不了，属调用侧 */
const CALLER_STATUS = new Set([400, 413, 415, 422]);

/** provider 侧的配额类措辞：适配层没认出错误码时靠它补判 */
const QUOTA_TEXT = /quota|额度|限额|余额|insufficient|exceeded (?:your )?(?:current )?quota|usage limit|billing/i;

/**
 * 文本层配额判定。适配层认不出的文本会落成 PI_AI_ERROR / UNKNOWN，错误码分类就失效了；
 * 这时只要报文里有配额/超限措辞，仍按即时熔断处理。
 */
function looksLikeQuota(message) {
  return typeof message === 'string' && QUOTA_TEXT.test(message);
}

/**
 * 失败来源分层：把"这条失败该不该算在路由头上、要多快熔断"从单一错误码里解耦。
 *
 * - provider  上游明确承认自己是问题源（配额/限流/鉴权码、配额措辞、指向性 HTTP 状态）
 *             → 立即熔断，不必等阈值。
 * - transport 网络/超时/流中断/5xx：可能是瞬时抖动 → 按 failureThreshold 累积。
 * - unknown   兜底码（PI_AI_ERROR/UNKNOWN）且拿不到任何来源证据 → 同样按阈值：
 *             既不秒切（避免把健康路由误杀），持续失败也终究会切走。
 * - caller    请求本身有问题，或 Runtime 自伤（插件/宿主 bug）→ 换模型救不了：
 *             不熔断、不切游标，只记原因让 UI 说清"为什么没切"。
 *
 * @param {string} code 适配层给出的错误码
 * @param {unknown} message 上游错误原文
 * @param {number|undefined} status HTTP 状态码（LlmFailure.status / LlmError.status）
 * @param {string[]} immediateCodes 配置里的即时熔断码
 * @returns {string} FAILURE_SOURCE 之一
 */
function classifyFailureSource(code, message, status, immediateCodes) {
  // 1) 请求本身不合法（宿主已明确分类），或请求体类状态码
  if (isClientFaultCode(code)) return FAILURE_SOURCE.CALLER;
  if (typeof status === 'number' && CALLER_STATUS.has(status)) return FAILURE_SOURCE.CALLER;
  // 2) 兜底码 + Runtime 自伤特征：这是插件/宿主的问题，不是 provider 的
  if (FALLBACK_CODES.has(code) && SELF_FAULT_TEXT.test(typeof message === 'string' ? message : '')) {
    return FAILURE_SOURCE.CALLER;
  }
  // 3) 上游明确的问题源。刻意用 !FALLBACK_CODES.has(code) 挡一道：历史配置里若还留着
  //    PI_AI_ERROR/UNKNOWN，分层判定优先于旧配置，不会被拉回无条件熔断。
  if (!FALLBACK_CODES.has(code) && Array.isArray(immediateCodes) && immediateCodes.includes(code)) {
    return FAILURE_SOURCE.PROVIDER;
  }
  if (looksLikeQuota(message)) return FAILURE_SOURCE.PROVIDER;
  if (typeof status === 'number' && PROVIDER_STATUS.has(status)) return FAILURE_SOURCE.PROVIDER;
  // 4) 链路瞬时故障
  if (TRANSPORT_CODES.has(code)) return FAILURE_SOURCE.TRANSPORT;
  // 5) 不认识、也没证据
  return FAILURE_SOURCE.UNKNOWN;
}

/** 熔断原因正文的上限：上游偶尔把整页 HTML / 长堆栈当 message 回传，不能整段塞进快照 */
const MAX_REASON_LENGTH = 300;

/**
 * 收敛上游报错原文成一行可展示的短文案（保留原文措辞，只压空白 + 截断）。
 * @param {unknown} message 上游错误信息
 * @returns {string} 空字符串表示没有可展示的原因
 */
function normalizeReason(message) {
  if (typeof message !== 'string') return '';
  const oneLine = message.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= MAX_REASON_LENGTH) return oneLine;
  return `${oneLine.slice(0, MAX_REASON_LENGTH)}…`;
}

function createRouter(config, log) {
  // log = 宿主 ctx：touch() 需要它来 emit 变更通知（无 emit 能力时静默降级）
  // 每个路由 key 的熔断状态，纯内存
  const circuits = new Map(); // key -> { state, failures, openedAt, lastAttemptAt }
  // 配置级健康表：provider/model 是否真实存在（适配器注册表 + 模型目录）。
  // 区别于熔断：熔断是"暂时不可用会恢复"，这里是"配置死了永远不可用"。
  const health = new Map(); // key -> HEALTH.OK | HEALTH.INVALID
  // 会话模型快照：P1 应指的用户手选模型。apply 层仅在 P1 真实放行时写它，
  // 熔断覆盖（cfg 被改成后备模型）不碰——否则 P1 的 key 被后备模型永久污染。
  let sessionModel = null; // { provider, model } | null（全局最近一次；按会话的见下）
  // 按会话记「用户手选的会话模型」：P1 行的名字、「会话模型」归属判定都按会话取。
  // 只存纯数据，snapshot 直接 JSON 序列化下发，客户端据此显示 P1 行。
  const sessionModelBySession = new Map(); // sessionId -> { provider, model }
  /** 记录某会话的会话模型（用户手选 / P1 真实放行采样） */
  function noteSessionModel(sessionId, provider, model) {
    if (!provider || !model) return;
    if (typeof sessionId === 'string' && sessionId) {
      const prev = sessionModelBySession.get(sessionId);
      if (!prev || prev.provider !== provider || prev.model !== model) {
        sessionModelBySession.set(sessionId, { provider, model });
      }
    }
    if (!sessionModel || sessionModel.provider !== provider || sessionModel.model !== model) {
      sessionModel = { provider, model };
    }
  }
  /** 取某会话的会话模型（无会话上下文/未记录 → 全局快照） */
  function sessionModelFor(sessionId) {
    if (typeof sessionId === 'string' && sessionId) {
      const v = sessionModelBySession.get(sessionId);
      if (v) return v;
    }
    return sessionModel;
  }
  /**
   * P1 槽的位置：
   * - p1Follow（P1 跟随当前会话模型）：-1 —— P1 不在 config.queue 里，队列索引 i 显示为 P(i+2)
   * - 静态模式：0 —— P1 就是 config.queue[0]
   * 这个区分是「P1 失败却把 P2 熔断掉」「切到后备后原地重试」两个老 bug 的根：
   * 旧实现 p1Follow 也用 0 表示 P1，而 0 同时是队列第一条（UI 的 P2），一个下标两种身份。
   */
  const p1Position = () => (config.p1Follow ? -1 : 0);
  // 运行态
  const runtime = {
    activeIndex: config.p1Follow ? -1 : 0, // 当前生效位置（p1Follow 下 -1 = P1 会话模型）
    // 全局手动切换目标（manualFailback 写入，null = 没有手动意图）。
    // 手动切换是明确的全局意图，必须压过"未记录会话回落到 P1"的默认规则，
    // 否则切换只改显示不改路由：resolveIndex 会照样返回 P1。
    manualIndex: null,
    inFlightIndex: -1, // 最近一次实际发出去的请求所走的路由；-1 = 未覆盖（放行原配置）
    lastProposal: null, // { key, idx, overridden } 最近一次 agent/request 的提案
    lastSwitch: null, // { from, to, code, at }
    revision: 0, // 状态版本号，客户端据此判断是否需要重新拉 snapshot
    probeInFlight: false,
    // 手动切换后等待「下一条真实请求」确认：{ index, at }。
    // 切换只决定"下一个请求用哪条"，本身不产生任何可用性证据——旧实现切换后立刻
    // 发一条探测，拿不到会话模型就写 NO_SESSION_MODEL 的红色失败，于是「P1 验证失败」
    // 和「P1 正常」同屏出现。现在不探测、不下结论，只记一个等待位。
    pendingConfirm: null,
    // 真实请求证据：{ index, provider, model, at, state:'sent'|'ok'|'fail', code, settledAt }。
    // 「切换到底生效没有」唯一的可信答案：不是游标、不是探测，是宿主真的把请求发过去了。
    lastRequest: null,
    // 旧的探测验证回执：恒为 null，仅保留字段名给老客户端读。
    lastVerify: null,
    // 宿主的"实际使用"回执：{ index, provider, model, at }。
    // 来源是宿主把我们的覆盖投影回 session/event model/selection —— 这是唯一
    // 不依赖我们自己记账的确认信号。有它才能说"这次真的走的是 P3"。
    hostConfirmed: null,
  };
  // ---- 会话隔离的实际路由（inFlight）----
  // inFlightIndex 与游标同理是会话体验：会话1在 P3、会话2在 P2 时，全局单值会让
  // 两者互相覆盖，UI 的"当前"标记和外面的芯片显示都会指错对象。按 sessionId 记。
  const sessionInFlight = new Map(); // sessionId -> index
  function setInFlight(sessionId, idx) {
    if (typeof sessionId !== 'string' || !sessionId) {
      runtime.inFlightIndex = idx; // 无会话上下文 → 全局回退（探测/旧调用）
      return;
    }
    sessionInFlight.set(sessionId, idx);
    runtime.inFlightIndex = idx; // 全局值跟最近一次请求走（UI 主显示，多数场景只有一个活动会话）
  }
  function inFlightFor(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return runtime.inFlightIndex;
    const v = sessionInFlight.get(sessionId);
    return v !== undefined ? v : runtime.inFlightIndex;
  }
  // ---- 会话隔离的切换游标 ----
  // 熔断状态（circuits）和配置判死（health）按 provider/model 记账，天然跨会话共享
  // ——同一个模型在哪都坏，这合理。但"切到第几级"是会话体验：会话1熔断切到 P2，
  // 不该把会话2（还没请求过）也拖到 P2。游标按 sessionId 记，activeIndex 只作
  // 无会话上下文时的回退（旧调用/探测/手动回切）。
  const sessionCursor = new Map(); // sessionId -> index
  function cursorFor(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return runtime; // 无会话上下文 → 全局回退
    const cur = sessionCursor.get(sessionId);
    // 未记录的会话：有全局手动切换意图时跟随它（manualFailback 已清空所有会话游标，
    // 此时"没有记录"是手动切换的结果，不是新会话）；否则从 P1 槽起步——新会话不该
    // 继承别的会话因熔断产生的切换进度。
    // 全局 activeIndex 只反映"曾经有会话切过多深"，供探测/预检选起点，不污染新会话。
    if (cur === undefined) return {
      activeIndex: Number.isInteger(runtime.manualIndex) ? runtime.manualIndex : p1Position(),
    };
    return { activeIndex: cur }; // 只读视图，写经 setCursor
  }
  function setCursor(sessionId, idx) {
    if (typeof sessionId !== 'string' || !sessionId) {
      runtime.activeIndex = idx;
      return;
    }
    sessionCursor.set(sessionId, idx);
    // 全局游标记录历史最深切换（探测/预检等无会话路径用它选起点）
    if (idx > runtime.activeIndex) runtime.activeIndex = idx;
  }

  /** 任何会改变运行态/电路的操作都应调用它：bump 版本号 → 通知客户端拉新快照 */
  function touch() {
    runtime.revision += 1;
    try {
      // cordis 的 emit(name, ...args)：name 是第一个参数，不是 this
      log?.emit?.(CHANGE_EVENT);
    } catch {
      /* 通知失败不影响主流程 */
    }
  }

  const keyOf = (route) => `${route.provider}\u0000${route.model}`;

  function circuitOf(key) {
    let c = circuits.get(key);
    if (!c) {
      c = {
        state: CIRCUIT.CLOSED, failures: 0, openedAt: 0, lastAttemptAt: 0,
        // 最近一次失败的原因：熔断后 UI 的 ⓘ 悬浮提示要直接展示上游原文
        lastCode: null, lastMessage: '', retryAfterMs: 0, lastSource: null,
        // 健康证据（前瞻性）：最近一次"真的能回话"的时刻与探测耗时。
        // lastOkAt 同时被真实请求成功与探测成功刷新；lastProbeAt/probeLatencyMs/probeOk
        // 只由主动探测写入。UI 靠它们区分「刚测过·820ms」「很久没测过」「上次探测失败」，
        // 而不是只凭熔断状态猜——熔断是事后记账，本身没有预测能力。
        lastOkAt: 0, lastProbeAt: 0, probeLatencyMs: 0, probeOk: null,
        // 探测自己的失败原因：探测不再写熔断器，所以原因要单独留一份给 UI 的悬浮提示
        lastProbeCode: null, lastProbeMessage: '',
      };
      circuits.set(key, c);
    }
    return c;
  }

  function isAvailable(route, now = Date.now()) {
    // 配置级失效（provider 没注册适配器 / 模型已不存在）优先于熔断状态：
    // 这类路由重试多少次都不会好，等冷却毫无意义，必须直接判死。
    if (health.get(keyOf(route)) === HEALTH.INVALID) return false;
    const c = circuitOf(keyOf(route));
    if (c.state === CIRCUIT.CLOSED || c.state === CIRCUIT.HALF_OPEN) return true;
    // OPEN 且冷却到期 → 进入半开，允许一次探测
    if (now - c.openedAt >= config.cooldownMs) {
      c.state = CIRCUIT.HALF_OPEN;
      c.halfOpenAt = now;
      touch();
      return true;
    }
    return false;
  }

  /** 半开超时（毫秒）：超过仍无请求路过落账，就主动探测一次。0 = 关闭主动探测 */
  const PROBE_TIMEOUT_MS = 90_000;
  /** 找出所有"卡在半开且超时"的熔断器（供主动探测扫描） */
  function staleHalfOpen(now = Date.now()) {
    const queue = config.queue || [];
    if (PROBE_TIMEOUT_MS <= 0) return [];
    const out = [];
    for (const [i, r] of queue.entries()) {
      const c = circuitOf(keyOf(r));
      if (c.state === CIRCUIT.HALF_OPEN && now - (c.halfOpenAt || 0) >= PROBE_TIMEOUT_MS) {
        out.push({ index: i, route: r });
      }
    }
    return out;
  }

  /** 记下最近一次失败的原因：UI 悬浮提示直接展示它们。每次都覆盖，最后一次失败才是当前病根。 */
  function stampFailure(c, code, message, retryAfterMs, source) {
    c.lastCode = typeof code === 'string' && code ? code : 'UNKNOWN';
    c.lastMessage = normalizeReason(message);
    c.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : 0;
    c.lastSource = source;
  }

  /**
   * 记一次失败并判定是否熔断。分层规则见 classifyFailureSource：
   * provider 立即熔断；transport/unknown 按 failureThreshold 累积；caller 不计失败。
   * @returns {string} 本次失败的来源分类（调用方可据此决定要不要切路由）
   */
  function recordFailure(route, code, message, retryAfterMs, status) {
    const c = circuitOf(keyOf(route));
    c.lastAttemptAt = Date.now();
    const source = classifyFailureSource(code, message, status, config.immediateCodes);
    stampFailure(c, code, message, retryAfterMs, source);
    if (source === FAILURE_SOURCE.CALLER) {
      // 调用侧问题：不计失败、不熔断，但把原因记进电路，UI 才能解释"为什么没切"
      touch();
      return source;
    }
    c.failures += 1;
    const immediate = source === FAILURE_SOURCE.PROVIDER;
    if (immediate || c.failures >= config.failureThreshold) {
      c.state = CIRCUIT.OPEN;
      c.openedAt = Date.now();
      c.halfOpenAt = 0;
      c.failures = 0;
    }
    touch();
    return source;
  }

  function recordSuccess(route) {
    const c = circuitOf(keyOf(route));
    c.state = CIRCUIT.CLOSED;
    c.failures = 0;
    c.halfOpenAt = 0;
    // 真实请求成功也是一条健康证据：UI 的"上次可用"要把它算进去，
    // 否则一条一直在正常服务、只是没被探测的路由会显示"未测过"。
    c.lastOkAt = Date.now();
    c.lastAttemptAt = Date.now();
    // 恢复正常后清掉旧账：否则下次熔断前若没拿到新原因，悬浮提示会展示早已过期的报错
    c.lastCode = null;
    c.lastMessage = '';
    c.retryAfterMs = 0;
    c.lastSource = null;
    touch();
  }

  /**
   * UI 指示器要显示的"实际生效路由"索引。
   * 优先级：最近一次真的发出去的请求 > 已挂起等待替换的路由。
   * -1 表示本次请求没被本插件覆盖（放行原配置）——此时 P1 才真的是"当前"。
   */
  function effectiveIndex() {
    if (runtime.inFlightIndex >= 0) return runtime.inFlightIndex;
    return runtime.activeIndex;
  }

  /** P1 槽（p1Follow 下 = 会话模型，不在队列里）是否可用：看它自己的电路 */
  function p1Available(now = Date.now()) {
    if (!sessionModel) return true; // 还没采样到会话模型：不能凭空判它坏
    return isAvailable(sessionModel, now);
  }
  /** 某个位置是否可用：-1 = P1 槽，>=0 = config.queue 下标 */
  function positionAvailable(pos, now = Date.now()) {
    if (pos === -1) return p1Available(now);
    const r = (config.queue || [])[pos];
    return r ? isAvailable(r, now) : false;
  }
  /** 从 startIndex 出发的候选位置顺序（不含自身，绕一圈）。pinned 条目恒排最后（大保底）。 */
  function nextPositions(startIndex) {
    const queue = config.queue || [];
    const n = queue.length;
    let out = [];
    if (!config.p1Follow) {
      for (let step = 1; step <= n; step += 1) out.push((startIndex + step) % n);
    } else {
      // p1Follow：环 = [P1(-1), 队列0=P2, 队列1=P3, ...]
      const ring = [-1];
      for (let i = 0; i < n; i += 1) ring.push(i);
      const at = ring.indexOf(startIndex);
      const base = at >= 0 ? at : 0;
      for (let step = 1; step <= ring.length - 1; step += 1) out.push(ring[(base + step) % ring.length]);
    }
    return reorderPinnedLast(out, queue);
  }

  /**
   * 把候选序里属于 pinned 条目的位置统一抽出来追加到序列末尾（大保底 = 最后兜底）。
   * - 非 pinned 位置保持原相对顺序（仍是"健康状况相近时按物理序顺延"）；
   * - pinned 位置保持它们之间的相对物理序（多个大保底按队列序顺延）；
   * - -1 = P1 槽，无队列条目可查 → 恒视为非 pinned，留在最前（P1 是当前会话模型，本就该最先试）。
   * 全 pin 时等效于没 pin（没 pin 的在前，全部 pin 就是原物理序），退化安全。
   * @param {number[]} positions
   * @param {Array<{pinned?: boolean}>} queue
   * @returns {number[]}
   */
  function reorderPinnedLast(positions, queue) {
    const pinned = [];
    const rest = [];
    for (const p of positions) {
      const r = p >= 0 ? queue[p] : null;
      (r && r.pinned === true ? pinned : rest).push(p);
    }
    return [...rest, ...pinned];
  }
  /**
   * 邻近可用：从 startIndex 起找第一个可用位置；粘滞模式绕回 P1 槽仅当其余全不可用。
   * @returns {number|null} 位置（-1 = P1 槽）；null = 一个可用的都没有（null 不等于 -1）
   */
  function pickFrom(startIndex, { allowP1 = true, now = Date.now() } = {}) {
    const p1Pos = p1Position();
    for (const pos of nextPositions(startIndex)) {
      if (pos === p1Pos && !allowP1) continue; // 粘滞模式跳过 P1，除非绕满一圈
      if (positionAvailable(pos, now)) return pos;
    }
    return null;
  }

  return {
    runtime,
    circuits,
    keyOf,
    isAvailable,
    recordFailure,
    recordSuccess,
    touch,
    pickFrom,
    positionAvailable,
    p1Position,
    sessionModelFor,
    noteSessionModel,
    staleHalfOpen,
    PROBE_TIMEOUT_MS,
    sessionCursor,
    /**
     * 记录「某会话最近一次实际发出去的路由」（-1 = 本次未覆盖，放行原配置）。
     * 必须经 router 暴露：setInFlight 是 createRouter 的闭包，apply 半区看不到它
     * —— 直接裸调用会 ReferenceError（agent/request 钩子整轮抛错，表现为
     * 每次发消息都「本轮运行失败 setInFlight is not defined」）。
     */
    setInFlight,
    /** 读某会话的实际路由（无会话上下文回退全局值） */
    inFlightFor,
    /** 清空所有会话游标（手动回切/会话清理用）；返回清除的条数 */
    resetSessionCursors() {
      const n = sessionCursor.size;
      sessionCursor.clear();
      if (n) touch();
      return n;
    },
    /**
     * 用户手选模型之后：把该会话拨回 P1 槽（p1Follow 下 = 用户刚选的那条）。
     * 用户的换模型是明确的"我要用这条"意图，必须让它立刻生效；否则上一次熔断把
     * 游标钉在后备路由上时，换模型后下一个请求照样发往旧的后备，用户看到的现象
     * 就是"换了模型但没生效"（P1 行名字也不跟着变）。
     */
    retryFromP1(sessionId) {
      // 用户手选模型 = 明确要回 P1：清掉之前的手动切换意图，否则下次没记录的会话
      // 仍会按旧的手动目标走。
      runtime.manualIndex = null;
      setCursor(sessionId, p1Position());
      setInFlight(sessionId, p1Position());
      runtime.lastProposal = null;
      touch();
    },
    /** 会话结束（session/disposed）后清掉它的游标，防 Map 无限增长 */
    dropSession(sessionId) {
      let touched = sessionCursor.delete(sessionId);
      touched = sessionInFlight.delete(sessionId) || touched;
      touched = sessionModelBySession.delete(sessionId) || touched;
      if (touched) touch();
    },
    /** 手动回切：清掉所有会话的 inFlight，回到指定索引（全局意图） */
    resetSessionInFlight(idx) {
      sessionInFlight.clear();
      runtime.inFlightIndex = idx;
      touch();
    },
    health,
    HEALTH,
    /**
     * 预检队列：逐条核对 provider 是否有已注册适配器（llm.listProviders）。
     * 适配器缺失 = 配置级死亡（NO_ADAPTER 必然发生），当场判 INVALID 并触发一次
     * 重选——不等请求撞上去才发现。返回变更摘要供日志/诊断用。
     */
    async preflight(llm) {
      const queue = config.queue || [];
      if (!llm?.listProviders) return { checked: 0, invalid: [] };
      let registered;
      try {
        registered = new Set(llm.listProviders().map((p) => p.id));
      } catch {
        return { checked: 0, invalid: [] }; // 适配器表不可读：不误杀，保持原状
      }
      const invalid = [];
      let changed = false;
      for (const r of queue) {
        const key = keyOf(r);
        const dead = !registered.has(r.provider);
        if (dead && health.get(key) !== HEALTH.INVALID) {
          health.set(key, HEALTH.INVALID);
          invalid.push({ provider: r.provider, model: r.model });
          changed = true;
        } else if (!dead && health.get(key) === HEALTH.INVALID) {
          health.delete(key); // 适配器回来了（插件装回/配置修复）→ 自动复活
          changed = true;
        }
      }
      // 游标检查每次都做：即使本轮无新判死，游标也可能因队列改动/手动切换
      // 停在早已判死的路由上，同样要立即切走。
      let cur = runtime.activeIndex;
      if (cur < 0) cur = p1Position();
      if (cur >= queue.length) cur = queue.length - 1;
      // P1 槽（p1Follow 下 = 会话模型）的适配器也可能没注册：同样要当场切走
      const curDead = cur === -1
        ? Boolean(sessionModel && health.get(keyOf(sessionModel)) === HEALTH.INVALID)
        : Boolean(queue[cur] && health.get(keyOf(queue[cur])) === HEALTH.INVALID);
      if (curDead) {
        const next = pickFrom(cur, { allowP1: true });
        if (next !== null && next !== cur) {
          runtime.lastSwitch = { from: cur, to: next, code: 'NO_ADAPTER', at: Date.now() };
          runtime.activeIndex = next;
          changed = true;
        }
      }
      if (changed) touch();
      return { checked: queue.length, invalid, changed };
    },
    /** 选出本次请求应使用的队列索引；返回 -1 表示队列不可用（放行原配置） */
    resolveIndex(now = Date.now(), sessionId = null) {
      const queue = config.queue || [];
      if (!config.enabled || queue.length === 0) return -1;
      const p1Pos = p1Position();
      let cur = cursorFor(sessionId).activeIndex;
      if (!Number.isInteger(cur)) cur = p1Pos;
      if (cur < 0 && !config.p1Follow) cur = 0;
      if (cur >= queue.length) cur = queue.length - 1;
      if (positionAvailable(cur, now)) return cur;
      // 当前位置不可用 → 找下一个可用位置（可能是 P1 槽，也可能是队列里的后备）
      const sticky = config.failbackMode === 'sticky';
      // 粘滞模式：只有绕一圈找不到任何非 P1 可用位置时才允许回 P1
      let chosen = pickFrom(cur, { allowP1: !sticky || cur === p1Pos, now });
      if (chosen === null && sticky) chosen = pickFrom(cur, { allowP1: true, now });
      if (chosen === null) return -1; // 全熔断：放行原配置（降级）
      if (chosen !== cur) {
        runtime.lastSwitch = {
          from: cur,
          to: chosen,
          at: Date.now(),
        };
        setCursor(sessionId, chosen);
        touch();
      }
      return chosen;
    },
    /**
     * 失败后决定是否要求重试（切换路由）。
     * p1OwnsFailure：失败确实发生在 P1 上（或本次请求未覆盖路由，P1 就是实际使用的
     * 路由）时才允许把"找不到匹配"的失败归到 idx 0；否则 P2 的 AUTH/NO_ADAPTER 之类
     * 失败会被误记到 P1 电路上，把健康的 P1 熔断掉。
     * failure：宿主给的失败事实（LlmFailure），带上它才能把上游原文与建议等待时长
     * 一起记进电路，供 UI 的熔断原因悬浮提示展示。
     */
    onFailedAttempt(provider, model, code, p1OwnsFailure = true, failure = null, sessionId = null) {
      const queue = config.queue || [];
      if (!config.enabled || queue.length === 0) return false;
      const p1Pos = p1Position();
      // 失败路由在队列里就记在那一条上；不在队列里、又确属 P1 的失败才记到 P1 槽（-1）。
      // 老实现把 P1 也写成 0，而 0 同时是队列第一条（UI 的 P2）——P1 失败会把 P2
      // 无端熔断，切换直接跳过 P2 跳到 P3。
      // 注意：p1Follow 下 P1 槽本身就用 -1 表示，所以"没找到"不能直接等于 -1 就返回，
      // 否则 P1 的失败永远走不到下面（老代码正因如此把 P1 写成 0，才引出 P2 被误熔断）。
      let pos = queue.findIndex((r) => r.provider === provider && r.model === model);
      if (pos === -1) {
        if (!config.p1Follow || !p1OwnsFailure) return false; // 不是队列里的路由，不接管
        pos = p1Pos; // -1 = P1 槽（会话模型，队列外）
      }
      // P1 槽的路由对象就是会话模型本身（不在队列里，按失败现场构造）
      const failedRoute = pos < 0 ? { provider, model } : queue[pos];
      // 调用侧问题（请求体不合法、内容被拒、Runtime 自伤）不是路由健康问题：既不能
      // 熔断，也不能把游标钉过去，否则一条坏请求会让健康路由整段冷却 60s。
      // 这个判定必须在 setCursor 之前——游标被钉到别的下标后，resolveIndex() 会推出
      // 下一条可用路由，等于对调用侧错误也做了一次切换。
      if (classifyFailureSource(code, failure?.message, failure?.status, config.immediateCodes)
        === FAILURE_SOURCE.CALLER) {
        recordFailure(failedRoute, code, failure?.message, failure?.providerRetryAfterMs, failure?.status);
        return false;
      }
      // 游标钉到实际失败的这条路由上，再算下一个。否则："P1 跟随当前模型"模式下
      // 用户手动选了 P3、P3 挂了，游标还停在 P2，resolveIndex() 会认为 P2 正常并
      // 直接返回，切换根本不发生；或者 resolveIndex() 从旧游标推出来的下一站是刚
      // 挂掉的这条，同样切不出去。
      setCursor(sessionId, pos);
      recordFailure(failedRoute, code, failure?.message, failure?.providerRetryAfterMs, failure?.status);
      // 手动意图随失败失效：用户手选的那条挂了，manualIndex 必须清掉，否则新会话
      // （或游标被清空之后）会继续回落到这条已经判死的路由，表现成"切走了又自己跳回去"。
      if (runtime.manualIndex === pos) runtime.manualIndex = null;
      // 真实请求失败是比探测更强的证据：最近的请求证据直接改判失败（由调用方在
      // request-error 钩子里写 lastRequest，这里不再维护第二条回执）。
      const nextIdx = this.resolveIndex(Date.now(), sessionId);
      if (nextIdx === -1) {
        // p1Follow 下 -1 有两种可能：绕回 P1 槽（会话模型，这也是一次真切换，UI 要跟着动），
        // 或者"一条可用的都没有"（全熔断降级）。只有前者值得重试——P1 槽自己也刚挂了
        // 还回去重试，只会变成对同一个坏模型的死循环。
        if (!config.p1Follow || !positionAvailable(p1Pos)) {
          touch(); // 熔断已记下，指标变了，通知一次
          return false;
        }
        setInFlight(sessionId, p1Pos);
        runtime.lastSwitch = { from: pos, to: p1Pos, code, at: Date.now() };
        touch();
        return true;
      }
      if (nextIdx === pos) {
        touch(); // 熔断已记下，指标变了，通知一次
        return false; // 仍在原路由：不重试
      }
      // 切换决定已作出：retry 后下一个请求会发往 nextIdx。若此处不同步 inFlight，
      // effectiveIndex() 会一直返回旧的值（上一条路由），UI 的指示器与
      // "当前"标记在下一轮 agent/request 瀑布跑过之前都指错对象（P3 在跑却显示 P2）。
      setInFlight(sessionId, nextIdx);
      // lastSwitch 由 resolveIndex 写入（可能为 null：起点本来就不可用时它直接返回，
      // 没有记录）——直接 .code = 会 TypeError 把整个失败处理吞掉。
      if (runtime.lastSwitch) runtime.lastSwitch = { ...runtime.lastSwitch, code };
      touch();
      return true;
    },
    snapshot() {
      const queue = config.queue || [];
      /** 一条路由的电路视图：entries（队列条目）与 p1（P1 槽）共用，字段完全一致 */
      const view = (route) => {
        const key = keyOf(route);
        const c = circuitOf(key);
        return {
          state: c.state,
          failures: c.failures,
          // 配置级死亡（无适配器）：UI 据此直接标"配置失效"而不是"熔断中"
          invalid: health.get(key) === HEALTH.INVALID,
          // 熔断原因（ⓘ 悬浮提示）：只在电路非正常态时给出，健康路由不背历史失败的账
          // caller 类失败不进熔断，但同样要能解释"为什么没切"：所以它的原因
          // 在 closed 状态下也下发（其余状态仍只在非正常态给，健康路由不背旧账）。
          lastError: c.lastCode && (c.state !== CIRCUIT.CLOSED || c.lastSource === FAILURE_SOURCE.CALLER)
            ? { code: c.lastCode, message: c.lastMessage, source: c.lastSource || null }
            : null,
          // 失败来源分层（provider/transport/unknown/caller）：caller = 请求或 Runtime
          // 自身的问题，换模型救不了所以不熔断。UI 用它解释"为什么没切"。
          source: c.lastSource || null,
          openedAt: c.openedAt || null,
          // 预计恢复 = 熔断时刻 + 冷却时长；half_open 之后就不再是"等冷却"了
          recoverAt: c.state === CIRCUIT.OPEN ? c.openedAt + config.cooldownMs : null,
          retryAfterMs: c.retryAfterMs || null,
          // 健康证据（前端据此画"绿/黄/灰"与"x 秒前可用"）：熔断状态是事后结果，
          // 这三个时间戳才是"多久以前确认过它还能回话"。
          lastOkAt: c.lastOkAt || null,
          lastProbeAt: c.lastProbeAt || null,
          probeLatencyMs: c.probeLatencyMs || null,
          probeOk: c.probeOk === null || c.probeOk === undefined ? null : c.probeOk === true,
          // 上次探测的失败原因（探测不写熔断器，所以单独下发）
          probeError: c.lastProbeCode ? { code: c.lastProbeCode, message: c.lastProbeMessage || null } : null,
        };
      };
      return {
        enabled: config.enabled,
        p1Follow: config.p1Follow,
        activeIndex: runtime.activeIndex,
        // 手动切换目标：客户端在"本会话还没有请求记录"时用它显示生效路由，
        // 修「切到 P4 了但芯片仍写 P1、P4 行不高亮」。
        manualIndex: runtime.manualIndex,
        inFlightIndex: runtime.inFlightIndex,
        // per-session inFlight 映射随快照下发：客户端按当前会话取自己的显示值，
        // 修「会话1在 P3、会话2在 P2 时芯片互相覆盖」的问题。
        sessionInFlight: Object.fromEntries(sessionInFlight),
        effectiveIndex: effectiveIndex(),
        lastProposal: runtime.lastProposal ? { ...runtime.lastProposal } : null,
        // 会话模型快照：P1 应该指的用户手选模型（不受熔断回写污染）。
        // UI 用它显示 P1 行名称，并在"会话模型 ≠ effective 路由"时判断是否已切走。
        sessionModel: sessionModel ? { ...sessionModel } : null, // 闭包内 let，见上方声明
        // 按会话的会话模型：客户端按自己会话取，多会话下 P1 行名不会互相串
        sessionModelBySession: Object.fromEntries(sessionModelBySession),
        // P1 槽自己的电路视图（p1Follow 下 P1 = 会话模型，不在 config.queue 里）。
        // 老客户端读不到它会退回 entries[0]，保持向后兼容。
        p1: config.p1Follow && sessionModel
          ? { provider: sessionModel.provider, model: sessionModel.model, ...view(sessionModel) }
          : null,
        lastSwitch: runtime.lastSwitch,
        // 手动切换后的等待位：UI 用它显示「已切到 P3，等下次请求确认」。
        pendingConfirm: runtime.pendingConfirm ? { ...runtime.pendingConfirm } : null,
        // 真实请求证据：最近一条真的发出去的请求走了哪条、结果如何。
        // 这是「切换到底生效没有」唯一可信的答案（游标只是意图，探测只是旁证）。
        lastRequest: runtime.lastRequest ? { ...runtime.lastRequest } : null,
        // 旧字段：恒为 null，保留给老客户端，避免读不到就当成"验证失败"。
        lastVerify: null,
        // 宿主确认的"最近一轮实际使用的路由"（来自宿主回写的 model/selection），
        // 与 lastVerify（探测能否回话）是两条独立证据：一条证明"真的发到了这条"，
        // 一条证明"这条当时能回话"。
        hostConfirmed: runtime.hostConfirmed ? { ...runtime.hostConfirmed } : null,
        revision: runtime.revision,
        // 冷却时长给 UI：悬浮提示要用它把 openedAt 换算成"预计恢复"的时刻
        cooldownMs: config.cooldownMs,
        // 探测节奏给 UI：前端据此判断"这条多久没被确认过"是否已经超过一个周期，
        // 超了就降级成灰色（未验证），不再冒充绿色可用。
        pingIntervalMs: Number(config.pingIntervalMs) || 0,
        pingSkipPaid: config.pingSkipPaid !== false,
        entries: queue.map((r, i) => ({
          index: i,
          provider: r.provider,
          model: r.model,
          // F2/F3/F1 前端需要的新字段：pinned（大保底）、paid（免费/付费）、tier（厂商分组）
          pinned: r.pinned === true,
          paid: r.paid === 'free' || r.paid === 'paid' ? r.paid : 'unknown',
          tier: typeof r.tier === 'string' && r.tier ? r.tier : null,
          ...view(r),
        })),
        // F4 全员 ping 进度指示：探测中为 true 时前端按钮置灰并显示 n/N 进度
        probingAll: runtime.probeInFlight === true,
      };
    },
  };
}

// 依赖写法：必须用裸包名 + package.json 声明 peerDependencies。
// dsh 启动时会给「profile 内的包」和「link 到工作区的包」装一层运行时解析拦截
// （dsh-app-boot 的 ResolutionRouter）：祖先 node_modules 里声明了该 peer 名字时，
// 请求会被路由到安装域（dsh 主包 node_modules）里的同一份副本。
// 因此这里既不需要绝对路径，也能保证与宿主拿到同一个模块实例（类标记/符号一致）。
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
// schemastery：Config 必须是它（toJSON 信封供 dsh-settings 派生 settings namespace，
// ~standard 供 cordis 校验），同样走 peerDependencies 解析。
import s from '@deepseek-ai/schemastery';
// 队列顺序的独立持久化（不放 settings，避免每次写盘触发整页主题重算）。
import { readQueueState, writeQueueState, normalizeQueue, statePath } from './state.js';

// 与 @deepseek-ai/dsh-typert-protocol 内部常量同值（该包 0.2.1-rc.2 起不再导出
// ./remote-methods 子路径，但协议本身仍是这个字符串键 + {version:1, methods:[...]} 结构，
// 宿主自己的 dsh-repeat-tool-reminder / dsh-tmux-context 也直接硬编码同一常量）。
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

/** 给原型打 Remote 方法标记（等价于 TS 装饰器编译产物） */
function markRemoteMethods(prototype, methods) {
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((m) => Object.freeze({ method: m, invocation: Object.freeze({ kind: 'direct' }) })),
      ),
    }),
  });
}

/**
 * 运行态 RPC 服务：浏览器半区经 ctx.remote['dsh-model-fallback-queue'].snapshot() 调用。
 * cordis 类插件实例化只传 (ctx, config)，故 router 经模块级桥接获取。
 */
let serviceBridge = null; // { router, config, saveSettings, saveQueue } 由 apply 设置

class FallbackQueueService extends TypertRemoteService {
  static inject = [];

  constructor(ctx) {
    super(ctx, 'FallbackQueueService', { namespace: 'dsh-model-fallback-queue' });
    if (!serviceBridge) throw new Error('fallback-queue: service bridge missing');
    this.router = serviceBridge.router;
    this.config = serviceBridge.config;
  }

  /** 运行态快照 */
  snapshot() {
    return this.router.snapshot();
  }

  /** 手动探测：强制指定索引的熔断器进半开 */
  probe(index) {
    const route = this.config.queue?.[index];
    if (!route) return { ok: false };
    const c = this.router.circuits.get(this.router.keyOf(route));
    if (c) {
      c.state = CIRCUIT.HALF_OPEN;
      c.openedAt = 0;
    }
    return { ok: true };
  }

  /**
   * 手动回切：把所有会话游标与全局游标拉回目标位置。
   * index 省略或 -1 = P1 槽（p1Follow 下就是"当前会话模型"）。
   * 注意 p1Follow 下 queue[0] 是 UI 的 P2，不是 P1——老实现固定 i=0 会让"切回 P1"
   * 实际切到 P2，并把 from===to 的空操作也记进历史（UI 显示成 P2 → P2）。
   */
  manualFailback(index) {
    const p1Pos = this.config.p1Follow ? -1 : 0;
    const i = Number.isFinite(index) ? Number(index) : p1Pos;
    if (i === -1) {
      if (!this.config.p1Follow) return { ok: false }; // 静态模式没有"队列外的 P1"
    } else if (!this.config.queue?.[i]) {
      return { ok: false };
    }
    // 切换前的位置：优先"最近实际在跑的那条"，没有就用挂起游标
    const r = this.router.runtime;
    const from = r.inFlightIndex >= 0 ? r.inFlightIndex : r.activeIndex;
    // 手动回切是明确的全局意图：清掉所有会话游标，全部回到目标位置
    this.router.resetSessionCursors();
    this.router.runtime.activeIndex = i;
    // 记下全局手动意图：cursorFor() 对"没有会话记录"的会话据此回落，
    // 否则清空游标后下一个请求又回到 P1，切换只在 UI 上生效。
    this.router.runtime.manualIndex = i;
    // 手动回切后 UI 立刻应显示目标位置，而不是继续显示上次失败的路由。
    this.router.resetSessionInFlight(i);
    // from === i 是空操作（已经在 P1 又点了一次）：不记历史，否则出现"P1 → P1"
    if (from !== i) this.router.runtime.lastSwitch = { from, to: i, code: 'MANUAL', at: Date.now() };
    // 旧实现这里立刻发一条 maxTokens=1 的探测，并在拿不到会话模型时写一条
    // NO_SESSION_MODEL 的红色失败——于是面板上「P1 验证失败」和「P1 正常」同时出现。
    // 切换的真实性只能由**下一条真实请求**证明：记一个等待位，请求发出去后由
    // lastRequest 记录它到底走了哪条、成没成。不探测、不伪造结论。
    r.lastVerify = null;
    r.pendingConfirm = { index: i, at: Date.now() };
    this.router.touch();
    return { ok: true, pending: { ...this.router.runtime.pendingConfirm } };
  }

  /** 读当前队列顺序（来自 state 文件，非 settings） */
  getQueue() {
    return { queue: this.config.queue || [] };
  }

  /** 写队列顺序：只落 state 文件，不碰 settings → 不触发主题重算 */
  async setQueue(queue) {
    const ok = await serviceBridge.saveQueue(queue);
    return { ok, queue: this.config.queue || [] };
  }

  /**
   * 全员快速 ping（F4）：对队列每条路由串行发一次微型探测。
   * 手动触发（设置页 / 芯片面板按钮），全探（不跳过 paid，用户明确点了就探）。
   * 结果逐条写进电路（recordSuccess/recordFailure），UI 徽章立即反映真实健康。
   * @returns {Promise<{ok: boolean, results?: Array<{index:number,provider:string,model:string,ok:boolean|null,skipped?:boolean}>, reason?: string}>}
   */
  async pingAll() {
    if (!serviceBridge?.probeAllRoutes) return { ok: false, reason: 'unavailable' };
    try {
      return await serviceBridge.probeAllRoutes({ skipPaid: false, source: 'manual' });
    } catch (e) {
      return { ok: false, reason: 'error', error: e?.message };
    }
  }
}
markRemoteMethods(FallbackQueueService.prototype, ['snapshot', 'probe', 'manualFailback', 'getQueue', 'setQueue', 'pingAll']);

export const inject = ['settings', 'llm'];

export function apply(ctx, llm) {
  const config = { ...DEFAULT_CONFIG };

  // ---- 设置持久化：namespace = 插件行 id ----
  const NS = 'dsh-model-fallback-queue';
  let settingsView = null;

  async function loadSettings() {
    try {
      const desc = ctx.settings.describe().find((d) => d.ns === NS);
      if (desc) {
        settingsView = desc;
        const value = { ...(desc.value || {}) };
        // queue 不再由 settings 承载；老版本残留的 queue 值在迁移步骤里单独取用
        const legacyQueue = value.queue;
        for (const k of SETTINGS_EXCLUDED_KEYS) delete value[k];
        Object.assign(config, value);
        return legacyQueue;
      }
    } catch (e) {
      ctx.logger?.warn?.('[fallback-queue] settings read failed, using defaults: %s', e?.message);
    }
    return undefined;
  }

  async function saveSettings(patch) {
    try {
      const clean = { ...patch };
      for (const k of SETTINGS_EXCLUDED_KEYS) delete clean[k];
      Object.assign(config, clean);
      if (Object.keys(clean).length === 0) return; // 只有 queue 的 patch 不该写 settings
      await ctx.settings.update(NS, clean, settingsView?.revision);
      const desc = ctx.settings.describe().find((d) => d.ns === NS);
      if (desc) settingsView = desc;
    } catch (e) {
      ctx.logger?.warn?.('[fallback-queue] settings write failed: %s', e?.message);
    }
  }

  /**
   * 写队列顺序到 state 文件。只碰文件，不碰 settings，因此不会触发
   * ui-theme 的 adopt()/theme 重推，也就不会让整页主题重刷（白闪）。
   */
  async function saveQueue(queue) {
    const next = normalizeQueue(queue);
    config.queue = next;
    const ok = await writeQueueState(next);
    if (!ok) ctx.logger?.warn?.('[fallback-queue] queue write failed, keeping in-memory value');
    return ok;
  }

  /**
   * 启动时载入队列：state 文件优先；文件缺失（首次升级）时把 settings 里
   * 残留的旧 queue 一次性迁移过来。迁移后 settings 侧不再保留 queue
   * （也不主动去改文档 —— 改文档就是推 revision，正是要避开的动作）。
   */
  async function loadQueue(legacyQueue) {
    const fromState = await readQueueState();
    if (fromState) {
      config.queue = fromState;
      return;
    }
    const legacy = normalizeQueue(legacyQueue);
    if (legacy.length > 0) {
      config.queue = legacy;
      const ok = await writeQueueState(legacy);
      ctx.logger?.info?.(
        '[fallback-queue] migrated %d queue entr%s from settings to %s',
        legacy.length,
        legacy.length === 1 ? 'y' : 'ies',
        statePath(),
      );
      if (!ok) ctx.logger?.warn?.('[fallback-queue] migration write failed; will retry next boot');
      // 此处刻意不回写 settings：Config 已无 queue 字段，写它只会白白推一次
      // settings revision → 触发宿主主题全量重算（也就是白闪本身）。
      // 残留的 queue 值留在文档里也无害：loadSettings 每次都会丢弃它。
      return;
    }
    config.queue = [];
  }

  const router = createRouter(config, ctx);

  /**
   * 一次性迁移：把周期探测的默认值从 0（关闭）升到 60s。
   * 为什么需要迁移而不是只改 DEFAULT_CONFIG：settings 文档会把 schema 默认值一并落盘，
   * 存量用户文档里已经写着 `pingIntervalMs: 0`，只改默认值永远轮不到生效。
   * 用 pingDefaultsMigrated 把关一次：已经是正数的用户不动它；迁移后用户再改回 0 就永久尊重。
   */
  async function migratePingDefaults() {
    if (config.pingDefaultsMigrated === true) return;
    const patch = { pingDefaultsMigrated: true };
    if (!(Number(config.pingIntervalMs) > 0)) patch.pingIntervalMs = DEFAULT_CONFIG.pingIntervalMs;
    // 旧默认「跳过付费」会让整条付费队列永远显示未验证（用户报"面板全是未测，
    // 提前检测根本不存在"就是这个）。升级时翻成「全探」一次，之后尊重用户设置。
    if (config.pingSkipPaidMigrated !== true) {
      patch.pingSkipPaid = DEFAULT_CONFIG.pingSkipPaid;
      patch.pingSkipPaidMigrated = true;
    }
    Object.assign(config, patch);
    await saveSettings(patch);
    schedulePing();
    ctx.logger?.info?.(
      '[fallback-queue] ping defaults migrated → interval=%sms skipPaid=%s',
      config.pingIntervalMs,
      config.pingSkipPaid,
    );
  }

  // ---- 路由预检：启动时 + 适配器拓扑变化时，核对队列里的 provider 是否真的存在 ----
  // 没有这一步时，"provider 被卸载/改名/模型下架"只能等请求撞上 NO_ADAPTER、熔断
  // 计数走完才被发现；预检在装配期就判死并切走。llm 服务缺失（旧宿主/单测环境）
  // 时 preflight 内部直接返回，不报错。
  async function runPreflight(trigger) {
    const result = await router.preflight(llm);
    if (result.invalid?.length) {
      ctx.logger?.warn?.(
        '[fallback-queue] preflight(%s): %d entr%s dead (no adapter): %s',
        trigger,
        result.invalid.length,
        result.invalid.length === 1 ? 'y' : 'ies',
        result.invalid.map((r) => `${r.provider}/${r.model}`).join(', '),
      );
    }
  }
  ctx.effect(() => ctx.on('llm/adapters-updated', () => runPreflight('adapters-updated')));
  // 启动预检要等适配器注册完成，adapters-updated 事件天然覆盖（xdpool 等注册完会触发）。
  // 兜底：启动后 3s 再跑一次，防宿主不派发该事件。
  const preflightTimer = setTimeout(() => runPreflight('boot'), 3000);

  // ---- 会话模型实时跟随 ----
  // 用户手动切模型时宿主派发 session/event {type:'model/selection', data:{provider,model,...}}
  //（dsh-api-session-controller selectModel → agent.session.append）。
  // 原方案只靠 P1 放行采样（agent/request 瀑布），手动切换后没发消息就是旧值。
  // 这里监听 selection 事件直接更新 router.sessionModel，UI 3s 轮询即可跟上。
  ctx.effect(() =>
    ctx.on('session/event', (session, event) => {
      if (event?.type !== 'model/selection') return;
      const d = event.data || {};
      if (!d.provider || !d.model) return;
      // 忽略"我们自己的覆盖被投影回来"的 selection：那是后备路由在跑，不是用户手选。
      // 不忽略的话，每次熔断切到 P2/P3，宿主投影回写都会把 P1 的"本尊"改成后备模型。
      // 但这条投影本身是**宿主的确认**：宿主把我们返回的 provider/model 写进了会话，
      // 等于官方承认"本轮用的是它"。所以不拿它改 P1 身份，但要记成回执。
      const forced = router.runtime.lastProposal;
      if (forced?.overridden && forced.idx >= 0) {
        const q = (config.queue || [])[forced.idx];
        if (q && q.provider === d.provider && q.model === d.model) {
          router.runtime.hostConfirmed = {
            index: forced.idx,
            provider: d.provider,
            model: d.model,
            at: Date.now(),
          };
          router.touch();
          return;
        }
      }
      const sessionId = session?.id ?? null;
      router.noteSessionModel(sessionId, d.provider, d.model);
      // 用户手选模型 = "我要用这条"：把该会话拨回 P1 槽，下一个请求先试用户选的这条。
      // 否则熔断把游标钉在后备上时，换模型根本不生效（老 bug：换了模型 P1 行还是旧名）。
      lastProposal = null;
      router.retryFromP1(sessionId);
      ctx.logger?.info?.('[fallback-queue] session model changed: %s/%s', d.provider, d.model);
      router.touch();
    }),
  );

  // ---- 会话数据清理 ----
  // 会话销毁（session/disposed，宿主 dsh-session 派发）时清掉它的切换游标，
  // 防止 sessionCursor Map 随历史会话数无限增长。游标是我们唯一按会话记的运行态；
  // 熔断/判死按 provider/model 记账，与会话无关，不需要清理。
  ctx.effect(() =>
    ctx.on('session/disposed', (session) => {
      router.dropSession(session?.id);
    }),
  );

  // ---- 主动探测 ----
  // 半开路由超过 PROBE_TIMEOUT_MS 仍没有真实请求路过落账时，由插件直接经 llm.stream 发
  // 一条微型请求（maxTokens=1，'ping'），首个 chunk 到达即算成功（模型真的能回话）。
  // F4 的「快速 ping」复用同一套探测逻辑，对队列每条路由做全员扫描，更快发现
  // "还没熔断但已经死了"的模型（API key 失效 / 模型下架 / 网络不通）。
  let probing = false; // 串行锁：同一时刻至多一个探测请求在飞（半开扫描 + 全员 ping 共用）
  let probingAll = false; // 全员 ping 进行中（区别于半开扫描的 probing）
  async function probeOne(route) {
    // 单条路由的微型探测，无锁（调用方负责串行化）。返回是否可用，并写进电路。
    const key = router.keyOf(route);
    const startedAt = Date.now();
    // 探测结果无条件记账（无论成败）：UI 要能说"12 秒前测过、890ms、可用"，
    // 只留熔断状态的话，一条刚刚测活的路由仍然显示得跟从未探测过一样。
    const stampProbe = (ok) => {
      const c = circuitOf(key);
      c.lastProbeAt = Date.now();
      c.probeLatencyMs = Date.now() - startedAt;
      c.probeOk = ok;
      c.lastAttemptAt = Date.now();
      if (ok) c.lastOkAt = Date.now();
    };
    ctx.logger?.info?.('[fallback-queue] probing route %s/%s', route.provider, route.model);
    try {
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        // 探测体只用最小合法字段：带 name 之类的扩展字段时，一些厂商会直接
        // 400 拒绝，于是「能正常对话的模型」在面板上长期显示探测失败。
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      });
      // 首个 chunk 即视为可用，立即中断探测流省 token；15s 超时判死
      const iter = stream[Symbol.asyncIterator]();
      await Promise.race([
        iter.next(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), 15_000)),
      ]);
      router.recordSuccess(route);
      stampProbe(true);
      ctx.logger?.info?.('[fallback-queue] probe ok: %s', key);
      try { await stream.interrupt?.(); } catch { /* 流可能已结束 */ }
      return true;
    } catch (e) {
      // 探测失败**只记证据，不动熔断器**。
      // 为什么：探测是一条 maxTokens=1 的异形请求，某些厂商会以 400/429/超时拒绝它。
      // 如果让它累计失败，60s 一次的周期探测会亲手把每条路由"熔断"掉——
      // 监控把自己监控死，用户看到的就是"一片红、切过去也没用"。
      // 真死了的路由由真实请求记账；探测只负责说明"上次探测没成功"。
      const c = circuitOf(key);
      stampProbe(false);
      const code = typeof e?.code === 'string' && e.code ? e.code : 'UNKNOWN';
      // 探测体被拒（400/参数不合法）说明**这次探测不成立**，不能据此说模型不可用：
      // 标成「探测不支持」，UI 按灰色「未测」显示，不冒充黄色风险。
      // 但鉴权/额度/模型不存在这类报错即使包着 400 也是真问题，不能洗白。
      const msg = String(e?.message || '');
      const realFault = /api.?key|authenticat|unauthor|forbidden|quota|额度|余额|余额不足|rate.?limit|not found|does not exist|no such model/i.test(msg);
      const rejected = !realFault && (
        code === 'INVALID_REQUEST' || code === 'BAD_REQUEST'
        || code === 'INVALID_ARGS' || code === 'CONTEXT_WINDOW_EXCEEDED'
        || e?.status === 400 || e?.status === 422
        || /invalid (request|argument|parameter)|unsupported|not supported|max_tokens/i.test(msg)
      );
      if (rejected) {
        const cc = circuitOf(key);
        cc.probeOk = null;
        cc.lastProbeCode = 'PROBE_UNSUPPORTED';
        cc.lastProbeMessage = '该厂商拒绝了探测请求（不代表模型不可用）';
      } else {
        c.lastProbeCode = code;
        c.lastProbeMessage = normalizeReason(e?.message);
      }
      ctx.logger?.info?.('[fallback-queue] probe failed: %s code=%s (circuit untouched)', key, code);
      return false;
    }
  }
  // 半开扫描的入口：拿 probing 锁后探一条（一次探一条，串行推进）；
  // 全员 ping 进行中（probingAll）时不插队，避免与 pingAll 并发。
  async function probeRoute(route) {
    if (!llm?.stream || probing || probingAll) return;
    probing = true;
    try {
      return await probeOne(route);
    } finally {
      probing = false;
    }
  }
  // 全员快速 ping：对队列每条路由串行一次性探测。
  //  - skipPaid=true 时跳过 paid==='paid' 的条目（周期扫描省配额；手动按钮传 false 全探）
  //  - 复用 probing 锁（与半开扫描互斥）；期间置 router.runtime.probeInFlight → snapshot.probingAll
  //  - 结果逐条 recordSuccess/recordFailure，反映到 UI 徽章
  async function probeAllRoutes(opts = {}) {
    const skipPaid = opts.skipPaid !== false;
    if (probingAll || probing) return { ok: false, reason: 'busy', results: [] };
    if (!llm?.stream) return { ok: false, reason: 'no-stream', results: [] };
    probingAll = true;
    router.runtime.probeInFlight = true;
    router.touch();
    const queue = config.queue || [];
    const results = [];
    try {
      for (const [i, r] of queue.entries()) {
        if (skipPaid && r.paid === 'paid') {
          results.push({ index: i, provider: r.provider, model: r.model, ok: null, skipped: true });
          continue;
        }
        const ok = await probeOne(r); // 已持有 probingAll，无需再抢 probing 锁
        results.push({ index: i, provider: r.provider, model: r.model, ok, skipped: false });
      }
    } finally {
      probingAll = false;
      router.runtime.probeInFlight = false;
      router.touch();
    }
    ctx.logger?.info?.('[fallback-queue] pingAll(%s): %d probed', opts.source || 'manual', results.length);
    return { ok: true, results };
  }
  const probeTimer = setInterval(() => {
    const stale = router.staleHalfOpen();
    if (stale.length) void probeRoute(stale[0].route); // 一次探一条，串行推进
  }, 15_000);
  // 周期全员 ping（默认关 pingIntervalMs=0）。自排：每轮结束后依当前配置再排下一轮。
  let pingTimer = null;
  function schedulePing() {
    if (pingTimer) { clearTimeout(pingTimer); pingTimer = null; }
    const iv = Number(config.pingIntervalMs) || 0;
    if (!(iv > 0)) return;
    pingTimer = setTimeout(() => {
      pingTimer = null;
      void probeAllRoutes({ skipPaid: config.pingSkipPaid !== false, source: 'periodic' })
        .catch(() => {});
      schedulePing(); // 一轮结束后再排下一轮，不并发
    }, iv);
  }
  schedulePing(); // 启动时按当前配置排（默认 0 = 关闭）
  ctx.effect(() => () => {
    clearTimeout(preflightTimer);
    clearInterval(probeTimer);
    if (pingTimer) clearTimeout(pingTimer);
  });

  // 供 Client（经 remote RPC 或事件）读取运行态快照
  ctx.effect(() => {
    // settings/document-updated 时刷新本地 config + 依新配置重排周期 ping
    return ctx.on('settings/document-updated', (ns) => {
      if (ns !== NS) return;
      loadSettings();
      schedulePing(); // pingIntervalMs 变了就立即按新间隔重排（0=关闭）
    });
  });

  // ---- agent/request：覆盖冻结调用配置 ----
  // 记下"本次请求实际提案的路由"，供 request-error（P1 归属判定）与 assistant-stream
  // （精确复位）使用。键是 `${provider}\u0000${model}`：失败尝试与随后的重试是同一步的
  // 两次事件，用路由键而不是全局游标才能对上号。
  let lastProposal = null; // { key, idx, overridden }

  // ---- 会话模型快照（P1 的"本尊"）----
  // P1 跟随模式下 P1 = 当前会话模型。但"会话模型"必须指**用户手选的那个**，而不是
  // 熔断切走后宿主回写的后备模型——否则熔断到 P3 后 P1 的 key 也变成 P3，会话模型
  // 被永久污染，显示与归属判定全跟着错。
  // 更新规则：仅当本轮请求未被本插件覆盖（overridden=false，即 P1 真实放行）时才
  // 记录 cfg 的 provider/model；被覆盖的请求（overridden=true，发往后备）不碰它。
  // 手动切模型必然经过 P1 放行路径，所以这里能自然跟上用户的手选。
  // 存放在 router（router.sessionModel）上：snapshot 归 createRouter 所有，
  // 放 apply 闭包会在 snapshot 里 ReferenceError。

  /** 本次提案落在队列里的真实索引；-1 = 队列外 */
  const actualRouteOf = (provider, model) => {
    const queue = config.queue || [];
    if (provider && model) {
      const hit = queue.findIndex((r) => r.provider === provider && r.model === model);
      if (hit >= 0) return hit;
    }
    return lastProposal ? lastProposal.idx : -1;
  };

  /** 游标钉到实际在跑的路由；-1 = P1 槽（p1Follow 下 UI 手选的是队列外模型时就是它） */
  const runtimePin = (idx) => {
    if (Number.isInteger(idx)) router.runtime.activeIndex = idx;
  };

  /**
   * 记录「这一条请求真的发出去了」。
   * 这是「切换到底生效没有」唯一可信的证据：游标只是意图，探测只是旁证，
   * 只有宿主真的把请求交给这条 provider/model，才算切换生效。
   * 同时清掉等待位——已经有真实请求了，不再需要"等下次确认"。
   */
  const noteRequest = (index, provider, model, sessionId) => {
    router.runtime.lastRequest = {
      index,
      provider,
      model,
      session: typeof sessionId === 'string' ? sessionId : null,
      at: Date.now(),
      state: 'sent',
      code: null,
      settledAt: null,
    };
    router.runtime.pendingConfirm = null;
  };

  ctx.effect(() =>
    ctx.on('agent/request', async (payload, next) => {
      // 下游的 await next() 不能进 try：瀑布的 next() 只能消费一次，抛错之后再调一次
      // 拿到的是 undefined，会把整轮请求的 provider/model 变成空的。真出异常就让
      // prepareRequest 抛 —— agent-loop 会把它当成一个正常失败（UNKNOWN）吞掉。
      const cfg = await next();
      // 会话隔离：游标按会话记。payload.agent 由 agentEvents() fused 注入，session.id 可用
      const sessionId = payload?.agent?.session?.id ?? null;
      try {
        const idx = router.resolveIndex(undefined, sessionId);
        // p1Follow：-1 = P1 槽（会话模型，队列外）或"全熔断"降级 → 都放行原配置。
        if (idx === -1 && config.p1Follow) {
          lastProposal = { key: router.keyOf({ provider: cfg.provider, model: cfg.model }), idx: -1, overridden: false };
          // P1 真实放行 = 用户所选会话模型的可靠采样点：更新快照（也按会话记一份）。
          router.noteSessionModel(sessionId, cfg.provider, cfg.model);
          runtimePin(-1);
          noteRequest(-1, cfg.provider, cfg.model, sessionId);
          // UI 显示的是"实际在跑的这条"：P1 槽就是 -1
          router.setInFlight(sessionId, -1);
          router.runtime.lastProposal = { ...lastProposal };
          router.touch();
          return cfg;
        }
        if (idx === -1) {
          lastProposal = null; // 队列不生效：原配置即提案，交由下游
          noteRequest(-1, cfg.provider, cfg.model, sessionId);
          router.setInFlight(sessionId, -1);
          router.runtime.lastProposal = null;
          return cfg;
        }
        const route = config.queue[idx];
        if (!route) {
          lastProposal = null;
          noteRequest(-1, cfg.provider, cfg.model, sessionId);
          router.setInFlight(sessionId, -1);
          router.runtime.lastProposal = null;
          return cfg;
        }
        lastProposal = { key: router.keyOf(route), idx, overridden: true };
        noteRequest(idx, route.provider, route.model, sessionId);
        router.setInFlight(sessionId, idx);
        router.runtime.lastProposal = { ...lastProposal };
        router.touch();
        return { ...cfg, provider: route.provider, model: route.model };
      } catch (e) {
        ctx.logger?.warn?.('[fallback-queue] agent/request override skipped: %s', e?.message);
        lastProposal = null;
        router.setInFlight(sessionId, -1);
        router.runtime.lastProposal = null;
        return cfg;
      }
    }),
  );

  // ---- agent/request-error：熔断判定 + 请求重试 ----
  // ⚠️ cordis 的签名是 on(name, listener, options)：options 在**第三个**参数。
  // 曾经写成 on(name, { prepend: true }, fn)，于是 listener={prepend:true}、
  // options=真函数，钩子记录变成 { callback: {prepend:true} } —— dispatch 时
  // `hook.callback.bind` 必然抛 "is not a function"，而且熔断判定一次都没执行过。
  ctx.logger?.info?.(
    '[fallback-queue] attached: queue=%d p1Follow=%s enabled=%s',
    (config.queue || []).length,
    config.p1Follow,
    config.enabled,
  );

  ctx.effect(() =>
    ctx.on('agent/request-error', async (payload, next) => {
      const { provider, failure } = payload;
      // payload.agent 由 dsh-agent 的 agentEvents() fused 注入，运行时确实存在；
      // callConfig 不一定有（宿主没给），actualModel 是 agent/request 里记下的真实路由模型。
      const model = payload.agent?.callConfig?.model ?? lastProposal?.key?.split('\u0000')[1];
      // 诊断日志：确认监听器真的被调用了、拿到了什么。用户报"完全没切换"时，
      // 靠它区分"没执行到"和"执行了但判定不切"——这两种情况表现一样但修法完全不同。
      ctx.logger?.info?.(
        '[fallback-queue] request-error fired: provider=%s model=%s code=%s queue=%d lastProposal=%s',
        provider,
        model,
        failure?.code,
        (config.queue || []).length,
        JSON.stringify(lastProposal),
      );
      // 先把路由复原到"实际失败的那条"再判定归属：用户手动切到 P2/P3 后，队列里
      // 找不到匹配是常态，此时若按"未覆盖 = P1 的锅"处理，会把 P2/P3 的 429 记到
      // P1 头上，P1 无端熔断，P2/P3 反而永远健康、反复被选中。
      const p1Pos = config.p1Follow ? -1 : 0;
      const actual = lastProposal ? actualRouteOf(provider, model) : -1;
      let p1OwnsFailure = true;
      if (actual >= 0) {
        runtimePin(actual);
        p1OwnsFailure = actual === p1Pos;
      } else {
        // P1 动态跟随：只有"本次提案就是 P1 槽"时才允许把找不到匹配的失败归到 P1
        // p1Follow 下只有"本次提案就是 P1 槽"才算 P1 的锅；静态模式下 P1 = queue[0]
        p1OwnsFailure = config.p1Follow
          ? (lastProposal === null || !lastProposal.overridden || lastProposal.idx === p1Pos)
          : (lastProposal === null || lastProposal.idx === 0);
        // 额外防线：失败路由若等于熔断切走后的后备模型（会话模型快照之外的），
        // 说明这是后备路由自己的失败，不能算到 P1 头上。
        const sm = router.sessionModelFor(payload?.agent?.session?.id ?? null);
        if (p1OwnsFailure && sm && (sm.provider !== provider || sm.model !== model)) {
          p1OwnsFailure = false;
        }
      }
      try {
        // 会话隔离：切换游标按会话记（payload.agent 由 agentEvents() fused 注入）
        const sessionId = payload?.agent?.session?.id ?? null;
        // 先给「最近的请求证据」落一下结果：面板上那句「上一轮实际使用」说的就是它。
        // 这一条比任何探测都硬——真实对话请求失败了，就是这条路由当时不可用。
        const lr = router.runtime.lastRequest;
        if (lr && lr.state === 'sent') {
          router.runtime.lastRequest = {
            ...lr,
            state: 'fail',
            code: typeof failure?.code === 'string' && failure.code ? failure.code : 'UNKNOWN',
            settledAt: Date.now(),
          };
        }
        const switched = router.onFailedAttempt(provider, model, failure?.code, p1OwnsFailure, failure, sessionId);
        // 诊断日志：判定结果。switched=false 时同时打出熔断态，便于看清是"全熔断"
        // 还是"码不在立即列表"还是"路由不在队列里"。
        ctx.logger?.info?.(
          '[fallback-queue] decision: actual=%d p1Owns=%s switched=%s activeIndex=%d circuits=%s',
          actual,
          p1OwnsFailure,
          switched,
          router.runtime.activeIndex,
          JSON.stringify(router.snapshot().entries.map((e) => `${e.index}:${e.state}`)),
        );
        if (switched) return { kind: 'retry' };
      } catch (e) {
        ctx.logger?.warn?.('[fallback-queue] request-error handling failed: %s', e?.message);
      }
      // 非致命 / 未接管：必须 next()，否则 dsh-llm-retry 等下游永远接不到
      return next();
    }, { prepend: true }),
  );

  // ---- agent/assistant-stream：成功即复位熔断 ----
  ctx.effect(() =>
    ctx.on('agent/assistant-stream', (payload) => {
      try {
        const { frame } = payload;
        if (frame?.type !== 'end') return;
        // end 帧既可能是 committed 也可能是 abandoned（失败/中断），只有 committed 才算走通
        if (frame.outcome?.kind !== 'committed') return;
        // 复位"本次实际使用的那条路由"，而不是全局游标 activeIndex
        // （用户在 UI 手动换模型后 P1 会跟随，用游标会复位错对象）
        const proposal = lastProposal;
        const queue = config.queue || [];
        // idx === -1 = P1 槽：路由对象是会话模型本身，不在队列里，单独构造。
        let route = proposal && proposal.idx === -1
          ? router.sessionModelFor(payload?.agent?.session?.id ?? null)
          : (proposal && proposal.overridden ? queue[proposal.idx] : undefined);
        if (!route && proposal) {
          route = queue.find((r) => router.keyOf(r) === proposal.key);
        }
        if (route) router.recordSuccess(route);
        // 同一轮请求跑通了：把「最近的请求证据」标成 ok，面板据此显示
        // 「上一轮实际使用：P3 · 成功 · 12s 前」——这是切换生效的实证。
        const lr = router.runtime.lastRequest;
        if (lr && lr.state === 'sent') {
          router.runtime.lastRequest = { ...lr, state: 'ok', settledAt: Date.now() };
          router.touch();
        }
      } catch {
        /* 忽略 */
      }
    }),
  );

  // ---- 启动加载设置 ----
  ctx.effect(() => {
    void (async () => {
      const legacyQueue = await loadSettings();
      await loadQueue(legacyQueue);
      // 设置加载完之后再做一次性默认值迁移（依赖已落盘的配置值判断"是否从未设置过"）
      await migratePingDefaults();
    })().catch((e) => ctx.logger?.warn?.('[fallback-queue] boot load failed: %s', e?.message));
  });

  // ---- 运行态 RPC 服务 ----
  serviceBridge = { router, config, saveSettings, saveQueue, probeAllRoutes, probeRoute };
  ctx.effect(() => ctx.plugin(FallbackQueueService), 'fallback-queue rpc service');
  ctx.effect(() => () => {
    serviceBridge = null;
  }, 'fallback-queue bridge cleanup');

  return {
    router,
    saveSettings,
    saveQueue,
    loadSettings,
    loadQueue,
  };
}

/**
 * 极简 Standard Schema (~/standard) 实现：零依赖，避免插件解析 zod 的路径问题。
 * 只做「透传 + 填默认值 + 类型宽校验」，验错抛 issues。
 */
export const Config = s.object({
  enabled: s.boolean().default(DEFAULT_CONFIG.enabled).description('启用故障转移').volatile(),
  // queue 不在这里：它存在 $DSH_HOME/fallback-queue-state.json，
  // 因为写 settings 会触发宿主主题全量重算（见 state.js 顶部注释）。
  p1Follow: s.boolean().default(DEFAULT_CONFIG.p1Follow).description('P1 跟随当前会话模型').volatile(),
  immediateCodes: s.array(s.string()).default(DEFAULT_IMMEDIATE_CODES).description('命中即熔断的错误码').volatile(),
  failureThreshold: s.number().default(DEFAULT_CONFIG.failureThreshold).description('连续失败次数阈值（软熔断）').volatile(),
  cooldownMs: s.number().default(DEFAULT_CONFIG.cooldownMs).description('熔断冷却毫秒').volatile(),
  failbackMode: s.union(['sticky', 'probe', 'manual']).default(DEFAULT_CONFIG.failbackMode).description('P1 恢复策略').volatile(),
  failbackDelayMs: s.number().default(DEFAULT_CONFIG.failbackDelayMs).description('探测回切防抖毫秒').volatile(),
  pingIntervalMs: s.number().default(DEFAULT_CONFIG.pingIntervalMs).description('周期全员 ping 间隔毫秒（0=关闭）').volatile(),
  pingSkipPaid: s.boolean().default(DEFAULT_CONFIG.pingSkipPaid).description('周期扫描跳过付费条目（省配额）').volatile(),
  pingDefaultsMigrated: s.boolean().default(DEFAULT_CONFIG.pingDefaultsMigrated).description('内部：周期探测默认值已完成一次性升级').volatile(),
});
