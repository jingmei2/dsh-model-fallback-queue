/**
 * dsh-model-fallback-queue — Client half (Web UI).
 *
 * 两个 slot：
 * - settings.section：故障转移设置页（开关 / 队列管理 / 参数 / 回切策略）
 * - conversation.input.right：输入框工具行的状态芯片
 *
 * 规范：只用 --dsw-alias-* 主题 token；不 require @deepseek-ai/dsh-client-ui-*；
 * 组件内样式用 React style/style 标签，卸载即清理。
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-fallback-queue',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ---------- 双语文案表（跟随宿主语言：<html lang> / navigator.language） ----------

    // 每次取词实时读语言，不在模块加载时缓存（切换语言后下一次渲染即跟随）
    function localeId() {
      const raw = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang)
        || (typeof navigator !== 'undefined' && navigator.language) || 'en';
      return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }

    const TEXT = {
      zh: {
        addFallbackModel: '添加后备模型',
        close: '关闭',
        catalogLoadFailed: '模型目录加载失败：{err}',
        catalogLoading: '加载模型目录…',
        catalogEmpty: '没有可用模型目录',
        added: ' · 已添加',
        // 熔断三态
        stateOk: '正常',
        stateProbing: '探测中',
        stateTripped: '熔断',
        stateInvalid: '配置失效',
        // 错误码释义：机器码是 key（不进表），这里只放释义文案
        hintQuota: '额度或频率受限',
        hintAccountQuota: '账号额度用尽',
        hintRateLimit: '请求频率超限',
        hintAuth: '鉴权失败（API Key 无效或过期）',
        hintInvalidCredential: '鉴权失败（凭据无效）',
        hintNoAdapter: '没有可用适配器（provider 未注册或模型不存在）',
        hintUpstream: '上游错误（适配层未能识别）',
        hintUnknown: '未知错误',
        hintInvalidArgs: '请求参数不合法',
        hintInvalidRequest: '请求不合法',
        hintBadRequest: '请求不合法',
        hintTimeout: '请求超时',
        hintTransport: '链路中断',
        unknown: '未知',
        // 时长
        durSeconds: '{n} 秒',
        durMinutes: '{n} 分钟',
        durMinSec: '{min} 分 {sec} 秒',
        // 熔断 / 配置失效提示
        infoInvalidConfig: '配置失效：这个 provider 没有注册适配器，或模型已不存在。\n重试不会恢复，请到设置页把这条换成可用的模型。',
        infoNotSwitched: '本次未切换：{code}{hint}',
        infoTrippedReason: '熔断原因：{code}{hint}',
        infoCallerSide: '来源判定：请求本身或插件自身的问题，换模型也不会好，所以没有切换路由。',
        infoRawError: '错误原文：{msg}',
        infoModelReturned: '模型返回：{msg}',
        infoHalfOpen: '当前状态：半开探测中，下一次请求会再试这条路由',
        infoRecoverAt: '预计恢复：{time}（冷却 {cooldown} 后转半开探测）',
        infoRecoverCooldown: '预计恢复：冷却 {cooldown} 后转半开探测',
        infoRetryAfter: '上游建议：等待 {wait} 再试',
        parenWrap: '（{text}）',
        // 设置页
        loading: '加载中…',
        modeSticky: '粘滞（推荐）',
        modeStickyDesc: '切到 P2 后 P2 可用就一直用，即使 P1 恢复也不切回；P2 也挂时才按邻近可用原则（含绕回 P1）',
        modeProbe: '探测回切',
        modeProbeDesc: 'P1 冷却到期后由下一个真实请求探测回 P1，成功留下失败回 P2（防抖 5 分钟）',
        modeManual: '手动回切',
        modeManualDesc: '切走后永不自动回 P1，需在芯片面板手动切回',
        enableFailover: '启用故障转移',
        saving: '保存中…',
        queueTitle: '队列（P1 → Pn）',
        queueEmpty: '队列为空：添加 P2/P3… 作为 P1（当前会话模型）的后备',
        failuresSuffix: ' · 失败{n}',
        alreadyTop: '已经是最高优先级',
        moveUp: '上移',
        alreadyBottom: '已经是最低优先级',
        moveDown: '下移',
        confirmRemove: '确认移除？',
        remove: '移除',
        cancel: '取消',
        addModel: '+ 添加模型',
        failbackStrategy: 'P1 恢复策略',
        lastSwitchLabel: '最近切换：{from} → {to}{code}',
        aboutDesc: '当队列中某个模型故障（限流、限额、不可用）时，自动切换到下一个可用模型继续会话。P1 始终是当前会话模型，队列中添加的是后备模型（P2、P3…）。',
        legend: '🟢 正常 · 🟡 半开探测恢复中 · 🔴 已熔断冷却中 · ⚪ 未启用',
        aboutInfoHint: 'ⓘ 悬浮可看到熔断原因（模型返回的原文）与预计恢复时间',
        // 输入框芯片
        currentTag: '当前',
        sessionModelUnknown: '当前会话模型',
        sessionModelSuffix: '{name}（会话模型）',
        failoverTitle: '模型故障转移',
        badgeDisabled: '已关闭',
        badgeAllTripped: '全部熔断',
        badgeCurrent: '当前 {label}',
        badgeSwitchedAway: '{label} 已失效，已切走',
        noteNotQueued: '本轮请求未经过队列（放行原配置）',
        noFallbacks: '暂无后备——到设置页添加 P2/P3…',
        recentSwitch: '最近切换 {from} → {to}',
        noSwitchRecord: '无切换记录',
        failbackTitle: '把生效路由切回 P1（p1Follow 下即当前会话模型）',
        failbackAction: '切回 P1',
        clickToSwitch: '点击切换到 {label}',
        flashSwitched: '已切换到 {label}',
        flashSwitchFailed: '切换失败：{label} 当前不可用',
        // 切换验证回执：切换成功 ≠ 这条模型能回话，必须分开说
        flashSwitching: '已切到 {label}，正在验证这条模型能否回话…',
        verifyOk: '验证通过 · {ms}ms 内回话',
        verifyFail: '验证失败 · {code}',
        verifyFailMsg: '验证失败 · {code}（{msg}）',
        verifyPending: '验证中…',
        verifyRequestFailed: '真实请求失败 · {code}',
        verifyBusy: '未获验证（探测锁被占用）',
        saveFailed: '保存失败：{err}',
        settingsDefault: '配置暂时读不到，下面显示的是默认值',
        hostConfirmed: '宿主确认本轮实际使用：{name} · {ago}前',
        hostNotConfirmed: '本轮还没有宿主确认（发一条消息后这里会变成实证）',
        p1PickModel: '点击更换当前会话模型（即 P1）',
        switchBtn: '切换',
        switchThisRow: '立即把生效路由切到这一条（不用等它故障）',
        switchCurrent: '已经在用这一条',
        settings: '设置…',
        slotLabel: '故障转移',
        // 仅用于识别宿主内置「选择模型」按钮（DOM 匹配，不参与渲染）
        selectModelAria: '选择模型',
        // F2 大保底 / F3 免费付费 / F4 探测 —— 双语键
        pinLast: '设为最后兜底（大保底）',
        unpin: '取消大保底',
        pinnedTag: '大保底',
        paidFree: '免费',
        paidPaid: '付费',
        paidUnknown: '未标注',
        setPaidFree: '标为免费',
        setPaidPaid: '标为付费',
        setPaidUnknown: '清除标记',
        probeAll: '探测全部',
        probingAll: '探测中… {done}/{total}',
        probeAllDone: '探测完成：{ok} 可用 / {fail} 不可用',
        pickerAddN: '添加 {n} 个到队列',
        pickerTierHeader: '厂商：{name}',
        pickerNoneSelected: '请先勾选至少一个模型',
        pingInterval: '周期健康探测间隔（毫秒，0=关闭；默认 60000=每 60 秒确认一次）',
        pingSkipPaid: '周期探测跳过付费模型（省配额）',
        pingCostWarn: '⚠ 周期探测会向模型发送真实请求，可能消耗配额/费用；付费模型默认跳过，可在下方关闭跳过',
        queueRowHint: '📌=最后兜底（大保底）· 颜色=健康状态，价格改用文字标注',
        // 健康证据（前瞻性）：颜色只表示"多久以前确认过它能回话"，不再表示价格、
        // 也不再表示"你在不在 P1"。免费/付费降级成灰色文字标签。
        healthOk: '可用',
        healthSlow: '偏慢',
        healthProbeFailed: '上次探测失败',
        healthUnprobed: '未验证',
        healthUnprobedHint: '还没有探测或真实请求的结果，不能假定它可用',
        healthSkipPaidHint: '周期探测跳过了付费模型；点「探测全部」可立刻测一次',
        healthStale: '证据过期',
        healthAgo: '{age}前',
        healthProbeMs: '探测{ms}ms',
        healthRealOk: '真实请求成功',
        healthVerifying: '已过冷却，等一次探测确认',
        healthRecoverIn: '{age}后恢复',
        healthUnknown: '未知',
        legendHealth: '颜色=健康：●绿 刚确认可用 · ●黄 风险/待确认 · ●红 熔断 · ●灰 未验证',
      },
      en: {
        addFallbackModel: 'Add fallback model',
        close: 'Close',
        catalogLoadFailed: 'Failed to load model catalog: {err}',
        catalogLoading: 'Loading model catalog…',
        catalogEmpty: 'No model catalog available',
        added: ' · Added',
        stateOk: 'OK',
        stateProbing: 'Probing',
        stateTripped: 'Tripped',
        stateInvalid: 'Invalid config',
        hintQuota: 'Rate or quota limited',
        hintAccountQuota: 'Quota exhausted',
        hintRateLimit: 'Rate limited',
        hintAuth: 'Auth failed (invalid or expired API key)',
        hintInvalidCredential: 'Auth failed (invalid credential)',
        hintNoAdapter: 'No adapter available (provider not registered or model missing)',
        hintUpstream: 'Upstream error (adapter could not classify)',
        hintUnknown: 'Unknown error',
        hintInvalidArgs: 'Invalid request arguments',
        hintInvalidRequest: 'Invalid request',
        hintBadRequest: 'Invalid request',
        hintTimeout: 'Request timed out',
        hintTransport: 'Connection interrupted',
        unknown: 'Unknown',
        durSeconds: '{n} s',
        durMinutes: '{n} min',
        durMinSec: '{min} min {sec} s',
        infoInvalidConfig: 'Invalid config: this provider has no registered adapter, or the model no longer exists.\nRetrying will not help — replace this entry with a working model in settings.',
        infoNotSwitched: 'Not switched: {code}{hint}',
        infoTrippedReason: 'Circuit tripped: {code}{hint}',
        infoCallerSide: 'Caller-side: the problem is in the request itself or in the plugin, so switching models would not help — the route was not changed.',
        infoRawError: 'Raw error: {msg}',
        infoModelReturned: 'Model returned: {msg}',
        infoHalfOpen: 'Status: half-open probe — the next request will retry this route',
        infoRecoverAt: 'Recovers at: {time} (half-open probe after {cooldown} cooldown)',
        infoRecoverCooldown: 'Recovers after {cooldown} cooldown, then a half-open probe',
        infoRetryAfter: 'Upstream advice: retry after {wait}',
        parenWrap: ' ({text})',
        loading: 'Loading…',
        modeSticky: 'Sticky (recommended)',
        modeStickyDesc: 'Once switched to P2, keep using P2 while it works — no failback even if P1 recovers; only when P2 also fails, fall back to the nearest available route (wrapping back to P1)',
        modeProbe: 'Probe failback',
        modeProbeDesc: 'After P1 cooldown expires, the next real request probes back to P1; stay on success, return to P2 on failure (5-minute debounce)',
        modeManual: 'Manual failback',
        modeManualDesc: 'Never fail back to P1 automatically; switch back manually from the chip panel',
        enableFailover: 'Enable failover',
        saving: 'Saving…',
        queueTitle: 'Queue (P1 → Pn)',
        queueEmpty: 'Queue is empty: add P2/P3… as fallbacks for P1 (the current session model)',
        failuresSuffix: ' · {n} failures',
        alreadyTop: 'Already the highest priority',
        moveUp: 'Move up',
        alreadyBottom: 'Already the lowest priority',
        moveDown: 'Move down',
        confirmRemove: 'Remove this route?',
        remove: 'Remove',
        cancel: 'Cancel',
        addModel: '+ Add model',
        failbackStrategy: 'P1 recovery strategy',
        lastSwitchLabel: 'Last switch: {from} → {to}{code}',
        aboutDesc: 'When a model in the queue fails (rate limited, quota exhausted, unavailable), the session automatically continues on the next available model. P1 is always the current session model; entries added to the queue are fallbacks (P2, P3…).',
        legend: '🟢 OK · 🟡 Half-open, probing · 🔴 Tripped, cooling down · ⚪ Disabled',
        aboutInfoHint: 'ⓘ Hover to see the circuit reason (the raw model output) and the estimated recovery time',
        currentTag: 'Current',
        sessionModelUnknown: 'Current session model',
        sessionModelSuffix: '{name} (session model)',
        failoverTitle: 'Model failover',
        badgeDisabled: 'Disabled',
        badgeAllTripped: 'All tripped',
        badgeCurrent: 'Current {label}',
        badgeSwitchedAway: '{label} failed, switched away',
        noteNotQueued: 'This request did not go through the queue (original config passed through)',
        noFallbacks: 'No fallbacks yet — add P2/P3… in settings',
        recentSwitch: 'Last switch {from} → {to}',
        noSwitchRecord: 'No switch history',
        failbackTitle: 'Switch the active route back to P1 (the current session model under p1Follow)',
        failbackAction: 'Switch back to P1',
        clickToSwitch: 'Click to switch to {label}',
        flashSwitched: 'Switched to {label}',
        flashSwitchFailed: 'Switch failed: {label} unavailable',
        flashSwitching: 'Switched to {label} — checking whether this model answers…',
        verifyOk: 'Verified · answered in {ms}ms',
        verifyFail: 'Not verified · {code}',
        verifyFailMsg: 'Not verified · {code} ({msg})',
        verifyPending: 'Checking…',
        verifyRequestFailed: 'Real request failed · {code}',
        verifyBusy: 'Not verified (probe lock busy)',
        saveFailed: 'Save failed: {err}',
        settingsDefault: 'Config not readable right now — defaults shown below',
        hostConfirmed: 'Host confirmed this turn ran on: {name} · {ago} ago',
        hostNotConfirmed: 'No host confirmation yet — send one message and this turns into evidence',
        p1PickModel: 'Click to change the session model (P1)',
        switchBtn: 'Switch',
        switchThisRow: 'Make this route active right now (no need to wait for a failure)',
        switchCurrent: 'Already in use',
        settings: 'Settings…',
        slotLabel: 'Failover',
        selectModelAria: 'Select model',
        // F2 大保底 / F3 免费付费 / F4 探测 —— 双语键
        pinLast: 'Pin as last-resort (safety net)',
        unpin: 'Unpin (not last-resort)',
        pinnedTag: 'Safety net',
        paidFree: 'Free',
        paidPaid: 'Paid',
        paidUnknown: 'Unmarked',
        setPaidFree: 'Mark as free',
        setPaidPaid: 'Mark as paid',
        setPaidUnknown: 'Clear mark',
        probeAll: 'Probe all',
        probingAll: 'Probing… {done}/{total}',
        probeAllDone: 'Probe done: {ok} ok / {fail} unavailable',
        pickerAddN: 'Add {n} to queue',
        pickerTierHeader: 'Vendor: {name}',
        pickerNoneSelected: 'Check at least one model first',
        pingInterval: 'Periodic health probe interval (ms, 0 = off; default 60000 = confirm every 60s)',
        pingSkipPaid: 'Skip paid models in periodic probes (saves quota)',
        pingCostWarn: '⚠ Periodic probing sends real requests to models and may use quota/charges; paid models are skipped by default, disable the skip below to include them',
        queueRowHint: '📌 = last-resort · colour = health (price is text only)',
        healthOk: 'Healthy',
        healthSlow: 'Slow',
        healthProbeFailed: 'Last probe failed',
        healthUnprobed: 'Unverified',
        healthUnprobedHint: 'No probe or real request result yet — cannot assume it works',
        healthSkipPaidHint: 'periodic probe skips paid models; press "probe all" to test it now',
        healthStale: 'Stale evidence',
        healthAgo: '{age} ago',
        healthProbeMs: 'probe {ms}ms',
        healthRealOk: 'real request ok',
        healthVerifying: 'cooled down, waiting for a probe',
        healthRecoverIn: 'recovers in {age}',
        healthUnknown: 'unknown',
        legendHealth: 'Colour = health: ●green just confirmed · ●amber risk/pending · ●red tripped · ●grey unverified',
      },
    };

    function t(key, params) {
      const table = TEXT[localeId()] || TEXT.en;
      const template = table[key] ?? TEXT.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
    }

    // DOM 匹配专用：一次拿到两种语言的写法（宿主语言未必等于当前渲染语言）
    function tAll(key) {
      return [TEXT.zh[key], TEXT.en[key]].filter((s) => typeof s === 'string' && s !== '');
    }

    // 把文案当字面量拼进正则时用
    function escRe(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const STICKY = 'sticky';
    const PROBE = 'probe';
    const MANUAL = 'manual';

    // ---------- 共享小部件 ----------

    function Badge({ tone, children }) {
      const colors = {
        ok: 'var(--dsw-alias-state-success-primary, #3a9e5f)',
        warn: 'var(--dsw-alias-state-warn-primary, #c98a1b)',
        error: 'var(--dsw-alias-state-error-primary, #c94141)',
        muted: 'var(--dsw-alias-label-secondary, #888)',
      };
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '1px 8px',
            borderRadius: 999,
            fontSize: 11,
            lineHeight: '18px',
            color: colors[tone] || colors.muted,
            border: `1px solid ${colors[tone] || colors.muted}44`,
            background: `${colors[tone] || colors.muted}14`,
          },
        },
        children,
      );
    }

    function Switch({ checked, onChange, label }) {
      return h(
        'button',
        {
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          onClick: () => onChange(!checked),
          style: {
            position: 'relative',
            width: 36,
            height: 20,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: checked
              ? 'var(--dsw-alias-brand-primary, #4f7cf7)'
              : 'var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ccc))',
            transition: 'background .15s',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
          },
        }),
      );
    }

    // ---------- 模型选择器（数据来自 remote.session.modelCatalog，同内置模型选择器） ----------

    function ModelPicker({ onClose, onConfirm, existing = [] }) {
      const [groups, setGroups] = React.useState(null);
      const [err, setErr] = React.useState(null);
      const [openProvider, setOpenProvider] = React.useState(null);
      // F1 勾选集合：key = `${group.id}/${model.id}` → true/false（批量提交）
      const [checked, setChecked] = React.useState({});
      const [submitErr, setSubmitErr] = React.useState(null);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const r = await window.__fallbackQueueSession?.modelCatalog?.();
            if (!alive) return;
            if (!r?.ok) throw new Error(r?.error?.message || 'modelCatalog failed');
            setGroups(r.value?.groups || []);
          } catch (e) {
            if (alive) setErr(e.message || String(e));
          }
        })();
        return () => { alive = false; };
      }, []);

      // 点外部 / Esc 关闭
      React.useEffect(() => {
        const onDown = (e) => {
          if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
        };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey, true);
        };
      }, [onClose]);

      // 勾选/取消勾选一个模型行（已入队的不可取消）
      const toggle = (gid, mid) => {
        setChecked((prev) => {
          const key = `${gid}/${mid}`;
          const next = { ...prev };
          if (next[key]) delete next[key];
          else next[key] = true;
          return next;
        });
      };

      // 提交勾选集合：按「先厂商、后组内序」展开成 entries 交给父级追加进队列
      const confirm = () => {
        const selected = [];
        for (const g of groups || []) {
          for (const m of g.models || []) {
            if (!m) continue;
            if (checked[`${g.id}/${m.id}`]) selected.push({ provider: g.id, model: m.id, tier: g.id });
          }
        }
        if (selected.length === 0) {
          setSubmitErr(t('pickerNoneSelected'));
          return;
        }
        onConfirm(selected);
      };

      const selectedCount = Object.keys(checked).length;

      return h(
        'div',
        {
          ref: rootRef,
          style: {
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,.35)',
          },
        },
        h(
          'div',
          {
            style: {
              width: 460, maxHeight: '70vh', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              borderRadius: 12,
              background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #fff))',
              border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
              boxShadow: '0 8px 32px rgba(0,0,0,.18)',
              color: 'var(--dsw-alias-label-primary, inherit)',
            },
          },
          h(
            'div',
            {
              style: {
                padding: '12px 16px', fontWeight: 600, fontSize: 14,
                borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              },
            },
            t('addFallbackModel'),
            h('button', { onClick: onClose, style: btnSmall }, t('close')),
          ),
          h(
            'div',
            { style: { overflowY: 'auto', padding: '6px 8px' } },
            err
              ? h('div', { style: { padding: 12, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, t('catalogLoadFailed', { err }))
              : !groups
                ? h('div', { style: { padding: 12, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('catalogLoading'))
                : groups.length === 0
                  ? h('div', { style: { padding: 12, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('catalogEmpty'))
                  : groups.map((g) =>
                      h(
                        'div',
                        { key: g.id },
                        h(
                          'button',
                          {
                            onClick: () => setOpenProvider(openProvider === g.id ? null : g.id),
                            style: {
                              width: '100%', textAlign: 'left', padding: '8px 10px',
                              background: 'transparent', border: 'none', color: 'inherit',
                              cursor: 'pointer', fontSize: 13, fontWeight: 600,
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              borderRadius: 8,
                            },
                          },
                          t('pickerTierHeader', { name: g.name || g.id }),
                          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, openProvider === g.id ? '▾' : '▸'),
                        ),
                        openProvider === g.id
                          ? h(
                              'div',
                              { style: { paddingBottom: 6 } },
                              (g.models || []).map((m) => {
                                const key = `${g.id}/${m.id}`;
                                const inQueue = existing.includes(key);
                                const isChecked = !inQueue && checked[key] === true;
                                return h(
                                  'label',
                                  {
                                    key: m.id,
                                    style: {
                                      // 已入队的行整行禁用（防重复），勾选态置灰不可取消
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      width: '100%', textAlign: 'left', padding: '7px 14px 7px 14px',
                                      cursor: inQueue ? 'not-allowed' : 'pointer', fontSize: 13, borderRadius: 6,
                                      opacity: inQueue ? 0.45 : 1,
                                    },
                                    onMouseEnter: (e) => { if (!inQueue) e.currentTarget.style.background = 'var(--dsw-alias-brand-primary, #4f7cf7)' + '14'; },
                                    onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; },
                                  },
                                  h('input', {
                                    type: 'checkbox',
                                    checked: isChecked,
                                    disabled: inQueue,
                                    onChange: () => { if (!inQueue) toggle(g.id, m.id); },
                                    style: { flex: 'none' },
                                  }),
                                  h('span', { style: { flex: 1 } }, (m.name || m.id) + (inQueue ? t('added') : '')),
                                );
                              }),
                            )
                          : null,
                      ),
                    ),
          ),
          // 底部：批量提交 / 取消
          h(
            'div',
            {
              style: {
                padding: '10px 14px',
                borderTop: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                display: 'flex', alignItems: 'center', gap: 8,
              },
            },
            h(
              'button',
              {
                onClick: confirm,
                disabled: selectedCount === 0,
                style: {
                  flex: 1,
                  fontSize: 13, padding: '8px 12px', borderRadius: 8,
                  border: '1px solid var(--dsw-alias-brand-primary, #4f7cf7)',
                  background: 'var(--dsw-alias-brand-primary, #4f7cf7)',
                  color: '#fff', cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
                  opacity: selectedCount === 0 ? 0.5 : 1,
                },
              },
              selectedCount ? t('pickerAddN', { n: selectedCount }) : t('close'),
            ),
            h('button', { onClick: onClose, style: btnSmall }, t('cancel')),
          ),
          submitErr
            ? h('div', { style: { padding: '0 14px 8px', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, submitErr)
            : null,
        ),
      );
    }

    // ---------- 设置页 ----------

    // 熔断三态 → 文案键（'closed'/'half_open'/'open' 是机器码，不翻译）。
    // 颜色不从这里取：颜色统一由 healthOf() 决定（熔断状态 + 证据新鲜度），
    // 否则"closed 但十分钟没测过"会被画成健康绿。
    const STATE_KEY = { closed: 'stateOk', half_open: 'stateProbing', open: 'stateTripped' };

    /** 熔断错误码 → 释义文案键（key 保持机器码，释义文案在 TEXT 表里） */
    const CODE_KEY = {
      QUOTA: 'hintQuota',
      ACCOUNT_QUOTA: 'hintAccountQuota',
      RATE_LIMIT: 'hintRateLimit',
      AUTH: 'hintAuth',
      INVALID_CREDENTIAL: 'hintInvalidCredential',
      NO_ADAPTER: 'hintNoAdapter',
      PI_AI_ERROR: 'hintUpstream',
      UNKNOWN: 'hintUnknown',
      INVALID_ARGS: 'hintInvalidArgs',
      INVALID_REQUEST: 'hintInvalidRequest',
      BAD_REQUEST: 'hintBadRequest',
      TIMEOUT: 'hintTimeout',
      TRANSPORT: 'hintTransport',
    };

    /**
     * 毫秒 → 本地化短时长（zh「45 秒」「2 分 30 秒」/ en「45 s」「2 min 30 s」）。
     * @param {number} ms 毫秒
     * @returns {string}
     */
    function shortDuration(ms) {
      const total = Math.max(0, Math.round(Number(ms) / 1000));
      if (total < 60) return t('durSeconds', { n: total });
      const min = Math.floor(total / 60);
      const sec = total % 60;
      return sec === 0 ? t('durMinutes', { n: min }) : t('durMinSec', { min, sec });
    }

    /**
     * 时间戳 → HH:mm:ss（本地时区）。
     * @param {number} ts 毫秒时间戳
     * @returns {string}
     */
    function clockText(ts) {
      const d = new Date(ts);
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    /**
     * 拼熔断行的 ⓘ 悬浮提示：直接展示上游报错原文 + 预计恢复时刻。
     * 没有可讲的就返回 null（不渲染 ⓘ）。
     * @param {object} entry snapshot 里的队列条目
     * @param {object} snap 运行时快照（取 cooldownMs）
     * @returns {string|null}
     */
    function circuitInfoText(entry, snap) {
      if (!entry) return null;
      if (entry.invalid) {
        return t('infoInvalidConfig');
      }
      const err = entry.lastError || {};
      // 调用侧失败不熔断，但用户需要知道"为什么没切"：closed 状态下也给它提示。
      const callerSide = err.source === 'caller';
      if (entry.state === 'closed' && !callerSide) return null;
      const hintKey = err.code ? CODE_KEY[err.code] : null;
      const hint = hintKey ? t(hintKey) : null;
      const hintSuffix = hint ? t('parenWrap', { text: hint }) : '';
      const code = err.code || t('unknown');
      const lines = callerSide
        ? [t('infoNotSwitched', { code, hint: hintSuffix })]
        : [t('infoTrippedReason', { code, hint: hintSuffix })];
      if (callerSide) {
        lines.push(t('infoCallerSide'));
      }
      if (err.message) {
        lines.push(callerSide ? t('infoRawError', { msg: err.message }) : t('infoModelReturned', { msg: err.message }));
      }
      if (callerSide && entry.state === 'closed') {
        // 没进熔断，没有恢复时间可谈
      } else if (entry.state === 'half_open') {
        lines.push(t('infoHalfOpen'));
      } else {
        const cooldown = Number(snap?.cooldownMs) > 0 ? Number(snap.cooldownMs) : 60000;
        lines.push(entry.recoverAt
          ? t('infoRecoverAt', { time: clockText(entry.recoverAt), cooldown: shortDuration(cooldown) })
          : t('infoRecoverCooldown', { cooldown: shortDuration(cooldown) }));
        if (Number(entry.retryAfterMs) > 0) {
          lines.push(t('infoRetryAfter', { wait: shortDuration(entry.retryAfterMs) }));
        }
      }
      return lines.join('\n');
    }

    /**
     * 熔断 / 配置失效行末尾的 ⓘ 图标（悬浮显示原因与恢复时间）。
     * @param {object} entry snapshot 里的队列条目
     * @param {object} snap 运行时快照
     * @returns {object|null} React 元素；无需提示时为 null
     */
    function circuitInfoIcon(entry, snap) {
      const text = circuitInfoText(entry, snap);
      if (!text) return null;
      return h('span', {
        title: text,
        'aria-label': text,
        style: { cursor: 'help', opacity: 0.65, fontSize: 11, lineHeight: 1, flex: 'none' },
      }, 'ⓘ');
    }

    /**
     * 免费/付费标记（价格，与健康无关）。
     * 原先用绿/琥珀着色，结果和健康色撞车：一条付费路由永远显示琥珀色，
     * 用户看到的"黄"其实只是"要花钱"，却被读成"这条模型有问题"。
     * 现在价格只做中性文字标签，颜色通道完全留给健康状态。
     */
    function paidTag(paid) {
      const neutral = {
        fontSize: 10,
        color: 'var(--dsw-alias-label-secondary, #888)',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-label-secondary, #888) 40%, transparent)',
        borderRadius: 4,
        padding: '0 4px',
        lineHeight: '14px',
        flex: 'none',
      };
      if (paid === 'free') return h('span', { style: neutral }, t('paidFree'));
      if (paid === 'paid') return h('span', { style: neutral }, t('paidPaid'));
      return null;
    }

    /** 把毫秒数折成 "12s" / "8m" / "3h" 这种短标签。 */
    function fmtAge(ms) {
      const s = Math.max(0, Math.round(ms / 1000));
      if (s < 60) return `${s}s`;
      if (s < 3600) return `${Math.round(s / 60)}m`;
      return `${Math.round(s / 3600)}h`;
    }

    /** 探测周期超过这个倍数没拿到任何证据，就不算"已确认"，降级成灰色。 */
    const HEALTH_STALE_MS = 15 * 60_000;
    /** 探测延迟超过这个值算"响应偏慢"（有风险但仍可用）。 */
    const HEALTH_SLOW_MS = 5_000;

    /**
     * 一条路由的健康判定：熔断三态 **加上证据新鲜度**。
     * 这是本插件唯一该用颜色的地方——绿=刚确认可用、黄=风险/待确认、红=熔断、灰=未验证。
     * 熔断状态本身是"事后记账"（失败之后才变），单凭它 UI 没有任何前瞻性：
     * 一条 20 分钟前就已经死了、但一直没被选中的路由会显示成"正常"。
     * @param {object|null} e snapshot 条目（或 p1 视图）
     * @param {object|null} snap 整个快照（取 pingIntervalMs 用）
     * @param {number} now 当前时刻
     * @returns {{tone:string,text:string,detail:string}}
     */
    function healthOf(e, snap, now) {
      if (!e) return { tone: 'muted', text: t('healthUnknown'), detail: '' };
      if (e.invalid) return { tone: 'error', text: t('stateInvalid'), detail: '' };
      if (e.state === 'open') {
        const left = e.recoverAt ? Math.max(0, e.recoverAt - now) : 0;
        return {
          tone: 'error',
          text: t('stateTripped'),
          detail: e.recoverAt ? t('healthRecoverIn', { age: fmtAge(left) }) : '',
        };
      }
      if (e.state === 'half_open') {
        return { tone: 'warn', text: t('stateProbing'), detail: t('healthVerifying') };
      }
      // closed：只有"确凿且新鲜"的证据才给绿色，否则宁可是灰的
      // 老宿主快照没有证据字段（undefined）：退回旧语义（closed = 正常），
      // 不能让新客户端配老宿主时整片变灰——那看起来像插件坏了。
      const hasEvidenceFields = e.lastOkAt !== undefined || e.lastProbeAt !== undefined;
      if (!hasEvidenceFields) return { tone: 'ok', text: t('stateOk'), detail: '' };
      const probedAt = e.lastProbeAt || 0;
      const okAt = e.lastOkAt || 0;
      const evidence = Math.max(probedAt, okAt);
      if (!evidence) {
        // 付费条目会被周期探测跳过（省配额），所以"未验证"是常态而不是异常——
        // 必须说清楚原因，否则用户会以为插件没在工作。
        const skipPaid = snap?.pingSkipPaid === true && e.paid === 'paid';
        return {
          tone: 'muted',
          text: t('healthUnprobed'),
          detail: skipPaid ? t('healthSkipPaidHint') : t('healthUnprobedHint'),
        };
      }
      const age = Math.max(0, now - evidence);
      // 最近一次证据是"探测失败"（还没到熔断阈值）→ 黄：有风险，但还没被判死
      if (e.probeOk === false && probedAt >= okAt) {
        return { tone: 'warn', text: t('healthProbeFailed'), detail: t('healthAgo', { age: fmtAge(age) }) };
      }
      // 探测周期开着时，超过 3 个周期（至少 3 分钟）没有新证据就降级成灰色：
      // 60s 周期下绿色最多"保鲜"3 分钟，探测停摆不会被永远当成健康。
      const interval = Number(snap?.pingIntervalMs) || 0;
      const staleAfter = interval > 0 ? Math.max(interval * 3, 180_000) : HEALTH_STALE_MS;
      if (age > staleAfter) {
        return { tone: 'muted', text: t('healthStale'), detail: t('healthAgo', { age: fmtAge(age) }) };
      }
      const parts = [];
      if (probedAt && e.probeLatencyMs) parts.push(t('healthProbeMs', { ms: e.probeLatencyMs }));
      parts.push(t('healthAgo', { age: fmtAge(age) }));
      const slow = Number(e.probeLatencyMs) > HEALTH_SLOW_MS;
      return {
        tone: slow ? 'warn' : 'ok',
        text: slow ? t('healthSlow') : t('healthOk'),
        detail: parts.join(' · '),
      };
    }

    /** 健康徽章：健康色只出现在这里，队列行与面板行共用。 */
    function healthBadge(e, snap, now) {
      if (!e) return null;
      const hs = healthOf(e, snap, now);
      if (!hs.text) return null;
      // 软熔断计数（连续失败 n/阈值）不上主标签，但别丢：进悬浮提示，
      // 否则"为什么还没熔断"只能去翻日志。
      const failures = Number(e.failures) > 0 ? t('failuresSuffix', { n: e.failures }) : '';
      return h('span', { title: `${hs.detail || hs.text}${failures}`, style: { flex: 'none' } },
        h(Badge, { tone: hs.tone }, `${hs.text}${hs.detail ? ` · ${hs.detail}` : ''}`));
    }

    /**
     * 手动切换的验证回执 → 一行人类可读的结论。
     * 这是「切换到底成不成」的唯一权威答案：切换本身只动游标，验证才证明能回话。
     * @returns {{tone:string,text:string}|null}
     */
    function verifyText(v) {
      if (!v) return null;
      if (v.state === 'pending') return { tone: 'warn', text: t('verifyPending') };
      if (v.code === 'BUSY') return { tone: 'warn', text: t('verifyBusy') };
      if (v.state === 'ok') {
        const ms = Number.isFinite(v.latencyMs) ? v.latencyMs : null;
        return { tone: 'ok', text: ms === null ? t('healthOk') : t('verifyOk', { ms }) };
      }
      const code = v.code || 'UNKNOWN';
      if (v.source === 'request') return { tone: 'error', text: t('verifyRequestFailed', { code }) };
      return {
        tone: 'error',
        text: v.message ? t('verifyFailMsg', { code, msg: v.message }) : t('verifyFail', { code }),
      };
    }

    /**
     * 大保底标记（F2）：📌 + 文案 tag；仅 pinned 渲染。
     * @param {boolean|undefined} pinned
     * @returns {object|null}
     */
    function pinnedTagEl(pinned) {
      if (pinned !== true) return null;
      return h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-brand-primary, #4f7cf7)', border: '1px solid #4f7cf755', borderRadius: 4, padding: '0 4px', lineHeight: '14px', flex: 'none' } }, `📌 ${t('pinnedTag')}`);
    }

    /** 队列行的 paid 值（缺省归 'unknown'）。 */
    function qValPaid(row) {
      return row && (row.paid === 'free' || row.paid === 'paid') ? row.paid : 'unknown';
    }

    function SettingsPage({ host }) {
      const [cfg, setCfg] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [snap, setSnap] = React.useState(null);
      // 保存/切换的动作结果：设置页以前把失败吞进 console，用户看到的只是"点了没反应"。
      const [err, setErr] = React.useState(null);
      const [pickerOpen, setPickerOpen] = React.useState(false);
      const [confirmRemove, setConfirmRemove] = React.useState(null); // 移除确认中的行索引
      // F4 探测全部：进行中 + 结果提示
      const [probing, setProbing] = React.useState(false);
      const [probeNote, setProbeNote] = React.useState(null);
      // 相对时间刷新器：设置页不轮询快照，不 tick 的话"12s前"会冻住不更新。
      const [, setClockTick] = React.useState(0);
      React.useEffect(() => {
        const id = setInterval(() => setClockTick((n) => n + 1), 10_000);
        return () => clearInterval(id);
      }, []);

      const refresh = React.useCallback(async () => {
        // settings 只出配置；队列来自 state 文件（host.getQueue），两个来源不重叠
        const [s, q] = await Promise.all([host.getSettings(), host.getQueue()]);
        // settings 命名空间还没有文档时 getSettings() 返回 null。旧实现在这里直接
        // 不 setCfg，页面就永久停在"加载中"——用户报的"设置页打不开/一片空白"。
        // 现在退回默认值渲染并把原因写在顶部，至少能操作。
        setCfg({ enabled: false, queue: [], failbackMode: STICKY, ...(s || {}), queue: q || s?.queue || [] });
        if (!s) setErr(t('settingsDefault'));
        const st = await host.getRuntimeSnapshot();
        if (st) setSnap(st);
      }, [host]);

      React.useEffect(() => {
        refresh();
      }, [refresh]);

      if (!cfg) return h('div', { style: { padding: 16 } }, t('loading'));

      const patch = async (p) => {
        setBusy(true);
        const r = await host.updateSettings(p);
        await refresh();
        // 错误必须在 refresh 之后设置：refresh 会重写 cfg（失败时回到磁盘上的真实值），
        // 顺带可能写入"配置读不到"的提示，动作失败的原因优先级更高。
        if (!r?.ok) setErr(t('saveFailed', { err: r?.error || 'unknown' }));
        else setErr(null);
        setBusy(false);
      };

      const setMode = (m) => patch({ failbackMode: m });

      // 队列写路径：只落 state 文件，不碰 settings，因此不会触发宿主主题全量重算
      const writeQueue = async (q) => {
        setBusy(true);
        const r = await host.setQueue(q);
        await refresh();
        if (!r?.ok) setErr(t('saveFailed', { err: r?.error || 'unknown' }));
        else setErr(null);
        setBusy(false);
      };

      const move = async (i, dir) => {
        const q = [...cfg.queue];
        const j = i + dir;
        if (j < 0 || j >= q.length) return;
        [q[i], q[j]] = [q[j], q[i]];
        await writeQueue(q);
      };

      const remove = async (i) => {
        await writeQueue(cfg.queue.filter((_, k) => k !== i));
      };

      const add = async () => {
        setPickerOpen(true);
      };

      // F2/F3 行内写回：改 pinned / paid 然后落 state 文件。
      // paid 在 unknown→free→paid→unknown 之间轮转，一遍就够（三态小循环）。
      const pinRow = async (i, pinned) => {
        const q = [...cfg.queue];
        q[i] = { ...q[i], pinned };
        await writeQueue(q);
      };
      // 点选切换：把生效路由立刻拉到这一条（队列下标 i；-1=P1 槽由芯片面板负责）
      // 结果必须可见：失败不能静默（"切了但不知道成不成"正是设置页的老问题）。
      const switchRow = async (i) => {
        setBusy(true);
        const r = await host.manualFailback(i);
        const ok = r ? (r.ok === undefined ? true : Boolean(r.ok)) : false;
        const st = await host.getRuntimeSnapshot();
        if (st) setSnap(st);
        const name = cfg.p1Follow ? `P${i + 2}` : `P${i + 1}`;
        if (!ok) setErr(t('flashSwitchFailed', { label: name }));
        else setErr(null);
        setBusy(false);
      };
      const cyclePaid = async (i) => {
        const order = ['unknown', 'free', 'paid'];
        const cur = qValPaid(cfg.queue[i]);
        const nextIdx = (order.indexOf(cur) + 1) % order.length;
        const q = [...cfg.queue];
        q[i] = { ...q[i], paid: order[nextIdx] };
        await writeQueue(q);
      };
      // 手动探测全部（不跳过 paid）
      const probeAll = async () => {
        setProbing(true);
        setProbeNote(null);
        const r = await host.pingAll();
        await refresh();
        setProbing(false);
        if (r?.ok && Array.isArray(r.results)) {
          const ok = r.results.filter((x) => x.ok === true).length;
          const fail = r.results.filter((x) => x.ok === false).length;
          setProbeNote(t('probeAllDone', { ok, fail }));
        }
      };

      const modes = [
        [STICKY, 'modeSticky', 'modeStickyDesc'],
        [PROBE, 'modeProbe', 'modeProbeDesc'],
        [MANUAL, 'modeManual', 'modeManualDesc'],
      ];

      return h(
        'div',
        { style: { padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 } },
        // 动作结果横幅：保存失败/切换失败/配置读不到都在这里说清楚。
        // 没有这条，设置页失败的表现就是"点了没反应"或"刷新后弹回去了"。
        err
          ? h(
              'div',
              {
                style: {
                  padding: '8px 10px',
                  fontSize: 12,
                  borderRadius: 8,
                  color: 'var(--dsw-alias-state-error-primary, #c94141)',
                  border: '1px solid var(--dsw-alias-state-error-primary, #c9414144)',
                  background: 'var(--dsw-alias-bg-layer-1, transparent)',
                },
              },
              err,
            )
          : null,
        // 总开关
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('strong', null, t('enableFailover')),
          h(Switch, { checked: !!cfg.enabled, onChange: (v) => patch({ enabled: v }), label: t('enableFailover') }),
          busy ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('saving')) : null,
        ),
        // 队列
        h(
          'div',
          null,
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, t('queueTitle')),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            cfg.queue.length === 0
              ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('queueEmpty'))
              : cfg.queue.map((r, i) => {
                  const entry = snap?.entries?.[i];
                  return h(
                    'div',
                    {
                      // key 不能带索引：上移/下移后 index 变化会让 React 卸载重建整行，
                      // 重建那一帧背景是空的，深色模式下就是一次白闪。用 provider/model 做稳定标识。
                      key: `${r.provider}/${r.model}`,
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
                      },
                    },
                    h('strong', { style: { width: 28 } }, cfg.p1Follow ? `P${i + 2}` : `P${i + 1}`),
                    h('span', { style: { flex: 1, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${r.provider} / ${r.model}`),
                      // F2 大保底标记
                      pinnedTagEl(r.pinned === true),
                      // F3 免费/付费标记
                      paidTag(r.paid),
                    ),
                    entry
                      ? healthBadge(entry, snap, Date.now())
                      : null,
                    circuitInfoIcon(entry, snap),
                    // 点选切换：立刻把生效路由拉到这一条（不用等它故障）。
                    // 芯片面板（输入框旁的 P 按钮）行点击走同一语义，这里给设置页一个显式入口，
                    // 免得用户以为设置页的队列只能配置、不能切换。
                    h(
                      'button',
                      {
                        onClick: () => { void switchRow(i); },
                        disabled: !cfg.enabled || (snap?.effectiveIndex ?? snap?.activeIndex) === i,
                        title: (snap?.effectiveIndex ?? snap?.activeIndex) === i ? t('switchCurrent') : t('switchThisRow'),
                        'aria-label': t('switchThisRow'),
                        style: !cfg.enabled || (snap?.effectiveIndex ?? snap?.activeIndex) === i ? btnSmallDisabled : btnSmall,
                      },
                      t('switchBtn'),
                    ),
                    // F2：大保底 PIN 开关
                    h(
                      'button',
                      {
                        onClick: () => pinRow(i, !(r.pinned === true)),
                        title: r.pinned === true ? t('unpin') : t('pinLast'),
                        'aria-label': r.pinned === true ? t('unpin') : t('pinLast'),
                        style: r.pinned === true ? { ...btnSmall, borderColor: 'var(--dsw-alias-brand-primary, #4f7cf7)', color: 'var(--dsw-alias-brand-primary, #4f7cf7)' } : btnSmall,
                      },
                      '📌',
                    ),
                    // F3：免费/付费轮转
                    h(
                      'button',
                      {
                        onClick: () => cyclePaid(i),
                        title: qValPaid(r) === 'free' ? t('setPaidFree') : qValPaid(r) === 'paid' ? t('setPaidPaid') : t('setPaidUnknown'),
                        'aria-label': t('queueRowHint'),
                        style: btnSmall,
                      },
                      r.paid === 'free' ? t('paidFree') : r.paid === 'paid' ? t('paidPaid') : t('paidUnknown'),
                    ),
                    h(
                      'button',
                      {
                        onClick: () => move(i, -1),
                        disabled: i === 0,
                        title: i === 0 ? t('alreadyTop') : t('moveUp'),
                        'aria-label': t('moveUp'),
                        style: i === 0 ? btnSmallDisabled : btnSmall,
                      },
                      '↑',
                    ),
                    h(
                      'button',
                      {
                        onClick: () => move(i, 1),
                        disabled: i === cfg.queue.length - 1,
                        title: i === cfg.queue.length - 1 ? t('alreadyBottom') : t('moveDown'),
                        'aria-label': t('moveDown'),
                        style: i === cfg.queue.length - 1 ? btnSmallDisabled : btnSmall,
                      },
                      '↓',
                    ),
                    confirmRemove === i
                      ? h('span', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
                          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #c94141)' } }, t('confirmRemove')),
                          h('button', { onClick: () => { setConfirmRemove(null); remove(i); }, style: { ...btnSmall, color: 'var(--dsw-alias-state-error-primary, #c94141)' } }, t('remove')),
                          h('button', { onClick: () => setConfirmRemove(null), style: btnSmall }, t('cancel')),
                        )
                      : h('button', { onClick: () => setConfirmRemove(i), style: btnSmall }, t('remove')),
                  );
                }),
          ),
          h('button', { onClick: add, style: { ...btnSmall, marginTop: 8 } }, t('addModel')),
          // F2/F3 行内标记说明 + F4 手动探测全部
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('queueRowHint')),
            h('button', {
              onClick: probeAll,
              disabled: probing || !cfg.enabled || !cfg.queue.length,
              title: t('probeAll'),
              style: probing || !cfg.enabled || !cfg.queue.length ? btnSmallDisabled : btnSmall,
            },
              probing ? t('probingAll', { done: 0, total: cfg.queue.length }) : t('probeAll')),
          ),
          (probeNote || snap?.probingAll)
            ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                snap?.probingAll ? t('probingAll', { done: 0, total: cfg.queue.length }) : probeNote)
            : null,
          // 切换验证回执：设置页的「切换」按钮同样要给出结论，否则切完仍是黑箱。
          (() => {
            const v = snap?.lastVerify;
            const vt = verifyText(v);
            if (!vt) return null;
            const name = v.index < 0 ? 'P1'
              : cfg.p1Follow ? `P${v.index + 2}` : `P${v.index + 1}`;
            const color = {
              ok: 'var(--dsw-alias-state-success-primary, #3a9e5f)',
              warn: 'var(--dsw-alias-state-warn-primary, #c98a1b)',
              error: 'var(--dsw-alias-state-error-primary, #c94141)',
              muted: 'var(--dsw-alias-label-secondary, #888)',
            }[vt.tone];
            const mark = v.state === 'pending' ? '⏳ ' : v.state === 'ok' ? '✓ ' : '✕ ';
            return h('div', { style: { fontSize: 11, fontWeight: 600, marginTop: 6, color } },
              `${mark}${name} · ${vt.text}`);
          })(),
        ),
        // 回切策略
        h(
          'div',
          null,
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, t('failbackStrategy')),
          h(
            'div',
            { role: 'radiogroup', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            modes.map(([value, titleKey, descKey]) =>
              h(
                'label',
                {
                  key: value,
                  style: {
                    display: 'flex',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: `1px solid ${cfg.failbackMode === value ? 'var(--dsw-alias-brand-primary, #4f7cf7)' : 'var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))'}`,
                    cursor: 'pointer',
                  },
                },
                h('input', {
                  type: 'radio',
                  name: 'failbackMode',
                  checked: cfg.failbackMode === value,
                  onChange: () => setMode(value),
                }),
                h(
                  'span',
                  null,
                  h('div', { style: { fontSize: 13, fontWeight: 600 } }, t(titleKey)),
                  h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t(descKey)),
                ),
              ),
            ),
          ),
        ),
        // F4 周期健康探测（默认关；打开会有真实请求，给出成本警告）
        h(
          'div',
          null,
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, t('probeAll')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
              h('input', {
                type: 'number',
                min: 0,
                step: 1000,
                value: Number(cfg.pingIntervalMs) || 0,
                onChange: (e) => { const v = Math.max(0, Number(e.target.value) || 0); patch({ pingIntervalMs: v }); },
                style: { width: 120, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))', background: 'transparent', color: 'inherit' },
              }),
              t('pingInterval'),
            ),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
              h(Switch, { checked: cfg.pingSkipPaid !== false, onChange: (v) => patch({ pingSkipPaid: v }), label: '' }),
              t('pingSkipPaid'),
            ),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-warn-primary, #c98a1b)' } }, t('pingCostWarn')),
          ),
        ),
        // 运行态
        snap?.lastSwitch && snap.lastSwitch.from !== snap.lastSwitch.to
          ? h(
              'div',
              { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              // 位置 → 显示名：p1Follow 下 -1 = P1、队列下标 i = P{i+2}；静态模式 i = P{i+1}
              t('lastSwitchLabel', {
                from: snap.lastSwitch.from < 0 ? 'P1' : `P${snap.lastSwitch.from + (snap.p1Follow ? 2 : 1)}`,
                to: snap.lastSwitch.to < 0 ? 'P1' : `P${snap.lastSwitch.to + (snap.p1Follow ? 2 : 1)}`,
                code: snap.lastSwitch.code ? t('parenWrap', { text: snap.lastSwitch.code }) : '',
              }),
            )
          : null,
        pickerOpen
          ? h(ModelPicker, {
              onClose: () => setPickerOpen(false),
              existing: cfg.queue.map((r) => `${r.provider}/${r.model}`),
              // F1 批量添加：勾选的条目按「先厂商、后组内序」追加; 已存在的防重复兜底
              onConfirm: async (selected) => {
                setPickerOpen(false);
                const clean = selected.filter((s) => !cfg.queue.some((r) => r.provider === s.provider && r.model === s.model));
                if (clean.length) await writeQueue([...cfg.queue, ...clean]);
              },
            })
          : null,
        // 功能说明（淡化、与上方内容拉开距离）
        h(
          'div',
          {
            style: {
              marginTop: 20,
              paddingTop: 12,
              borderTop: '1px solid var(--dsw-elevation-stroke-color, transparent)',
              fontSize: 12,
              lineHeight: 1.7,
              color: 'var(--dsw-alias-label-secondary)',
              opacity: 0.65,
            },
          },
          h('div', null, t('aboutDesc')),
          h('div', { style: { marginTop: 2 } }, t('legend')),
          h('div', { style: { marginTop: 2 } }, t('aboutInfoHint')),
        ),
      );
    }

    const btnSmall = {
      fontSize: 12,
      padding: '2px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
    };

    // 禁用态必须显式置灰：Chromium 只在 default 外观下把 disabled 按钮渲染成灰色，
    // 这里 background/color 都是显式值，不手动降权的话箭头看起来仍是可点的。
    const btnSmallDisabled = {
      ...btnSmall,
      opacity: 0.4,
      cursor: 'not-allowed',
    };

    // ---------- 输入框芯片 ----------

    function Chip(props) {
      const host = props.host;
      const onOpenSettings = props.onOpenSettings;
      const [snap, setSnap] = React.useState(null);
      const [open, setOpen] = React.useState(false);
      // 相对时间（"12s前"）的刷新器：快照内容不变时 setSnap 会跳过更新，
      // 相对时间就会永久冻在某一次渲染上（显示"12s前"十分钟）。只在弹层打开时 tick：
      // 关闭时芯片只显示颜色，不需要刷新，也避免无谓重渲染触发宿主侧栏重算。
      const [, setClockTick] = React.useState(0);
      React.useEffect(() => {
        if (!open) return undefined;
        const id = setInterval(() => setClockTick((n) => n + 1), 5000);
        return () => clearInterval(id);
      }, [open]);
      // 点击切换后的即时反馈：成功与失败都必须可见。旧实现里 manualFailback 失败
      // 会返回 null 被静默吞掉，用户点完完全不知道发生了什么。
      const [flash, setFlash] = React.useState(null);
      // DOM 解析到的"当前模型名"与冻结后的"会话模型名"分开：
      // DOM 名跟着宿主按钮走——故障转移后宿主按钮（request/header 投影）会显示
      // 实际路由的模型，盲目跟随会把 P1 行（会话模型）显示成 P3 的模型。
      // lastUncoveredName 只在本会话未被覆盖（未切走）时更新 = 用户真正手选的名字；
      // 切走期间显示冻结值，切回 P1 后恢复跟随。
      const [sessionModelLabel, setSessionModelLabel] = React.useState(null); // null = 尚未从 DOM 解析到，语言无关的哨兵（不拿文案当哨兵）
      const [lastUncoveredName, setLastUncoveredName] = React.useState(null);
      const rootRef = React.useRef(null);
      // 切换反馈的自动消失计时器（点完 2.6s 收掉提示条）
      const flashTimer = React.useRef(null);
      // DOM 取名函数存一份引用：点开弹层时要立刻重读一次，不能等 3s 轮询。
      const pullLabelRef = React.useRef(null);

      // 从内置模型选择按钮 title 解析当前会话模型名。识别要中英双兼容（大小写不敏感）：
      // 中文 title 形如「选择模型，当前 GLM-5.3-Flash · x0.06，推理等级 Default」，
      // 英文 aria-label 形如「Select model, current GLM-5.3-Flash」。
      React.useEffect(() => {
        const pull = () => {
          const pickNames = tAll('selectModelAria').map((s) => s.toLowerCase());
          const btn = Array.from(document.querySelectorAll('button')).find((x) => {
            // aria-label 是宿主稳定给出的「选择模型，当前 X」/「Select model, current X」，
            // 中英两套都认；title 只在有推理等级时才带「·」，不能只靠它，否则没有推理等级
            // 的模型（title 就是纯模型名）会被漏掉，DOM 兜底名一直取不到。
            const tip = String(x.title || '').toLowerCase();
            const aria = String(x.getAttribute('aria-label') || '').toLowerCase();
            return pickNames.some((s) => aria.includes(s) || tip.includes(s));
          });
          // aria-label 形如「选择模型，当前 X，推理等级 Y」/「Select model, current X」；title 形如「X · Y」
          const al = btn?.getAttribute('aria-label') || '';
          const ti = btn?.title || '';
          // 「当前/current」两种语言都试；中文分支的正则与原来逐字等价（全角逗号写成转义，避免表外中文）
          const curRe = new RegExp(`(?:${tAll('currentTag').map(escRe).join('|')}) ([^·,\uFF0C]+)`, 'i');
          const m = al.match(curRe) || ti.match(/^(.+?)\s*·/) || ti.match(/^([^·]+)/);
          if (!m) return;
          const next = m[1].trim();
          // 只在值真的变化时才写 state：无条件 setState 会让组件每 3 秒重渲染一次，
          // 而宿主侧栏（dsh-railist）订阅 DOM 变化后会把每次渲染当成一次新变更重算，导致重算不收敛刷屏。
          setSessionModelLabel((prev) => (prev === next ? prev : next));
        };
        pullLabelRef.current = pull;
        pull();
        const domTimer = setInterval(pull, 3000);
        return () => clearInterval(domTimer);
      }, []);

      const enabled = snap?.enabled;
      const entries = snap?.entries || [];
      // 位置口径（与宿主一致）：-1 = P1 槽（p1Follow 下 = 会话模型，不在队列里），
      // >=0 = config.queue 下标，UI 显示为 P{下标+2}。老宿主没有 -1 语义时按跟随兜底。
      const active = Number.isInteger(snap?.activeIndex)
        ? snap.activeIndex
        : ((snap?.p1Follow ?? true) ? -1 : 0);
      // 失效路由游标（activeIndex）表示"已经挂了、等下一级替换"，它会一直停在坏掉的那条；
      // 用户要看的却是"这一轮实际跑在哪条"。inFlightIndex 才是后者，缺省时退回旧字段。
      // 会话隔离：slot 组件由宿主按会话渲染（scope:'session'），props.sessionId 是当前
      // 会话。宿主下发了 per-session inFlight 映射时，就以它为准——映射里没有本会话
      // 意味着本会话尚未发过请求（未被覆盖），应显示 P1 跟随，绝不能退回全局
      // inFlightIndex：那是"最近任意会话"的值，别的会话切到过 P2 会污染这里的显示。
      // 只有旧宿主（没有 sessionInFlight 字段）才退回全局值。
      const hasSessionMap = props.sessionId !== undefined
        && snap?.sessionInFlight
        && typeof snap.sessionInFlight === 'object';
      const myInFlight = hasSessionMap
        && Number.isInteger(snap.sessionInFlight[props.sessionId])
        ? snap.sessionInFlight[props.sessionId]
        : undefined;
      // 全局手动切换目标：manualFailback 会清空所有会话的 inFlight 记录，此时
      // sessionInFlight 里没有本会话的条目——但那不是"没切换"，而是"切了、还没发请求"。
      // 不认这个字段，芯片就会一直写 P1、目标行也不高亮（用户报的「切到 P4 没反应」）。
      const manualTarget = Number.isInteger(snap?.manualIndex) ? snap.manualIndex : undefined;
      const inFlight = myInFlight !== undefined ? myInFlight
        : manualTarget !== undefined ? manualTarget
        : hasSessionMap ? -1
        : Number.isInteger(snap?.inFlightIndex) ? snap.inFlightIndex : active;
      const effective = myInFlight !== undefined ? myInFlight
        : manualTarget !== undefined ? manualTarget
        : hasSessionMap ? -1
        : Number.isInteger(snap?.effectiveIndex) ? snap.effectiveIndex : inFlight;

      // P1 会话模型名的冻结与恢复：未覆盖（myInFlight<=0）时记下 DOM 名作为
      // "用户真正手选的会话模型"；被覆盖（切到 P2/P3）期间停更——此时 DOM 名
      // 已被宿主改写成实际路由模型，不能让它污染 P1 行显示。
      // 注意：必须放在 myInFlight 声明之后（const 暂时性死区，放前面会 ReferenceError
      // 导致整个芯片被错误边界摘掉）。
      React.useEffect(() => {
        const covered = Number.isInteger(myInFlight) && myInFlight > 0;
        if (!covered && sessionModelLabel) {
          setLastUncoveredName((prev) => (prev === sessionModelLabel ? prev : sessionModelLabel));
        }
      }, [myInFlight, sessionModelLabel]);
      // 宿主下发的会话模型（权威来源）：用户手选模型时宿主立即派发 session/event 更新，
      // 不依赖"下一次请求经过 P1"或 DOM 轮询，所以手动切换后 P1 行名立刻变。
      const hostSessionModel = snap?.sessionModelBySession && props.sessionId
        ? (snap.sessionModelBySession[props.sessionId] || null)
        : (snap?.sessionModel || null);
      const hostSessionModelName = hostSessionModel
        ? `${hostSessionModel.provider} / ${hostSessionModel.model}`
        : null;
      // 展示用的会话模型名：优先宿主快照，其次冻结的 DOM 名（老宿主回退）。
      const p1DisplayName = hostSessionModelName
        || ((Number.isInteger(myInFlight) && myInFlight > 0 && lastUncoveredName)
          ? lastUncoveredName
          : sessionModelLabel)
        || t('sessionModelUnknown');

      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          // 顺手重读一次 DOM 模型名（老宿主回退路径也靠它）
          if (pullLabelRef.current) pullLabelRef.current();
          let st = null;
          try {
            st = await host.getRuntimeSnapshot();
          } catch (e) {
            console.warn('[fallback-queue] snapshot failed', e);
          }
          if (!alive) return;
          if (st) setSnap((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st));
          // 自适应轮询：稳定时 5s 一次；有请求在飞/刚发生过切换失败/验证回执还没落地、
          // 或者弹层正开着时 1s 一次。固定 5s 会让"切到 P2 了但指示器还显示 P1"最多僵 5 秒，
          // 也会让"验证中…"多挂 5 秒才给出结论。
          const live = st && (
            st.inFlightIndex >= 0
            || st.entries?.some((e) => e.state !== 'closed')
            || st.lastVerify?.state === 'pending'
          );
          timer = setTimeout(tick, live || open ? 1000 : 5000);
        };
        // open 进依赖 = 点开/收起弹层时立刻重跑一次 tick：
        // 用户手选模型后宿主早已更新状态，点开却要等下一次轮询才看到新名字（用户报"卡 3 秒以上"）。
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [host, open]);

      // 点击弹层外部自动关闭
      React.useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);
      const p1Follow = snap?.p1Follow ?? true;
      const allOpen = entries.length > 0 && entries.every((e) => e.state === 'open');
      const halfOpen = entries.some((e) => e.state === 'half_open');
      // P1 的电路视图：新宿主下发 snap.p1（P1 = 会话模型，不在队列里，没有下标）；
      // 老宿主（p1Follow=false 或没这个字段）退回队列第一条。
      const p1Entry = (snap?.p1 && typeof snap.p1 === 'object')
        ? snap.p1
        : (p1Follow ? null : entries.find((x) => x.index === 0));
      // P1 是否就是当前生效位置（P1 槽 = -1；静态模式下 P1 = queue[0]）
      const activeIsP1 = p1Follow ? active < 0 : active === 0;
      const p1Active = p1Follow ? effective < 0 : effective === 0;
      // P1 已被顶掉（超时/限流失效）但仍在兜底——以 P1 自己的电路状态判定，
      // 而不是拿队列第一条（那是 P2）当 P1。
      const p1Leaning = Boolean(p1Entry && p1Entry.state !== 'closed');
      // 位置 → 显示名：-1 = P1 槽（p1Follow 下 = 会话模型，不在队列里）；
      // 队列下标 i 在 p1Follow 下显示为 P{i+2}（P2 起），静态模式下为 P{i+1}（P1 起）。
      // 曾把 p1Follow 下的下标 0 也当成 P1（迁就宿主一个下标两种身份的老 bug），
      // 结果标题把 P2 喊成 P1、行内却标在 P2——用户截图里"当前 P2、P1 行也亮"的分裂。
      const lbl = (idx) => (idx < 0 ? 'P1' : p1Follow ? `P${idx + 2}` : `P${idx + 1}`);
      // 芯片颜色 = **当前生效路由自己的健康**，不再是"你在不在 P1"。
      // 旧逻辑 tone = p1Active ? ok : warn，导致"切到 P3"必然变黄——用户把黄读成
      // "P3 有问题"，其实黄只说明"你离开了 P1"。一个颜色只能表达一件事，而用户要的是
      // 健康与前瞻："这条模型现在还靠谱吗、多久前确认过"。
      const now = Date.now();
      const effEntry = effective < 0 ? p1Entry : entries.find((x) => x.index === effective);
      const effHealth = healthOf(effEntry, snap, now);
      let label;
      let tone;
      if (!enabled) {
        label = 'P';
        tone = 'muted';
      } else if (allOpen) {
        label = 'P!';
        tone = 'error';
      } else {
        label = lbl(effective);
        tone = effHealth.tone;
      }

      const routeOf = (idx) => {
        // P1 槽（p1Follow 下 = -1）就是会话模型；静态模式下 P1 = 队列第一条
        if (p1Follow ? idx < 0 : idx === 0) return t('sessionModelSuffix', { name: p1DisplayName });
        const e = entries.find((x) => x.index === idx);
        return e ? `${e.provider} / ${e.model}` : '—';
      };

      const toneColor = {
        ok: 'var(--dsw-alias-state-success-primary, #3a9e5f)',
        warn: 'var(--dsw-alias-state-warn-primary, #c98a1b)',
        error: 'var(--dsw-alias-state-error-primary, #c94141)',
        muted: 'var(--dsw-alias-label-secondary, #888)',
      }[tone];

      // 手动回切：把生效路由拉回 P1（p1Follow 下 = 当前会话模型）。
      // 「手动回切」模式下这是唯一的回去方式；其它模式也可用它提前结束粘滞。
      // 手动切换：把生效路由直接拉到指定位置（-1 = P1 槽，p1Follow 下即当前会话模型）。
      // 面板行点击走的就是这里；「手动回切」模式下这也是唯一的回去方式。
      const switchTo = async (idx) => {
        const r = await host.manualFailback(idx);
        const st = await host.getRuntimeSnapshot();
        if (st) setSnap(st);
        const name = lbl(idx);
        // manualFailback 的失败形态：返回 null（信封 ok:false）或裸值 {ok:false}
        const ok = r ? (r.ok === undefined ? true : Boolean(r.ok)) : false;
        // 切换成功只代表「游标动了」；能不能回话由 host 侧验证回执给出。
        // 所以成功不打勾：紧接着出现的验证行（验证中→结论）才是答案。
        // 失败要立刻说，因为它连游标都没动。
        setFlash(ok ? null : { tone: 'error', text: t('flashSwitchFailed', { label: name }) });
        if (flashTimer.current) clearTimeout(flashTimer.current);
        if (!ok) flashTimer.current = setTimeout(() => setFlash(null), 5000);
      };
      const failback = () => switchTo(-1);
      // P1 在 p1Follow 下就是「当前会话模型」——它的身份只能由宿主改。
      // 这里给一个捷径：定位宿主内置的「选择模型」按钮并替用户点开它。
      const openHostModelPicker = () => {
        const names = tAll('selectModelAria').map((x) => x.toLowerCase());
        const btn = Array.from(document.querySelectorAll('button')).find((x) => {
          const aria = String(x.getAttribute('aria-label') || '').toLowerCase();
          const tip = String(x.title || '').toLowerCase();
          return names.some((n) => aria.includes(n) || tip.includes(n));
        });
        btn?.click();
      };
      // 行内点击切换的通用 props（禁用 / 已在用时不响应；键盘可达）
      const rowSwitchProps = (active, idx, label) => {
        if (!enabled || active || typeof idx !== 'number') return {};
        return {
          role: 'button',
          tabIndex: 0,
          title: t('clickToSwitch', { label }),
          onClick: () => { void switchTo(idx); },
          onKeyDown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void switchTo(idx); }
          },
        };
      };

      return h(
        'div',
        { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
        h(
          'button',
          {
            onClick: () => setOpen((v) => !v),
            title: `${t('failoverTitle')} · ${lbl(effective)} ${effHealth.text}${effHealth.detail ? ` · ${effHealth.detail}` : ''}`,
            'aria-label': t('failoverTitle'),
            style: {
              position: 'relative',
              width: 26,
              height: 26,
              borderRadius: 8,
              border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
              background: 'var(--dsw-alias-bg-base, transparent)',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              lineHeight: '24px',
              padding: 0,
              transition: 'border-color .15s, box-shadow .15s',
              boxShadow: open ? `0 0 0 2px ${toneColor}33` : 'none',
            },
          },
          label,
          // 右上角健康状态小圆点（带呼吸闪烁）
          h('span', {
            className: allOpen ? 'fq-dot fq-dot-fast' : enabled === false ? 'fq-dot fq-dot-off' : 'fq-dot',
            style: { '--fq-dot-color': toneColor },
          }),
        ),
        open
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  bottom: 'calc(100% + 10px)',
                  right: 0,
                  minWidth: 300,
                  borderRadius: 12,
                  border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
                  // 不用 #fff 兜底：token 拿不到时透明，让宿主背景透出来，
                  // 硬编码白色在深色主题下会是一次整块白闪。
                  background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, transparent))',
                  boxShadow: '0 8px 32px rgba(0,0,0,.16), 0 2px 8px rgba(0,0,0,.08)',
                  zIndex: 30,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                },
              },
              // 标题行
              h(
                'div',
                {
                  style: {
                    padding: '10px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  },
                },
                t('failoverTitle'),
                !enabled
                  ? h(Badge, { tone: 'muted' }, t('badgeDisabled'))
                  : allOpen
                    ? h(Badge, { tone: 'error' }, t('badgeAllTripped'))
                    : h(Badge, { tone: effHealth.tone }, t('badgeCurrent', { label: lbl(effective) })),
              ),
              // 颜色图例：颜色曾被误读（琥珀=付费被当成"模型有问题"、离开 P1 也被画成黄），
              // 这里把颜色的唯一含义写死，省得再猜。
              h(
                'div',
                {
                  style: {
                    padding: '5px 14px',
                    fontSize: 10,
                    lineHeight: '15px',
                    color: 'var(--dsw-alias-label-secondary)',
                    borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                  },
                },
                t('legendHealth'),
              ),
              // 切换验证回执：这是「到底切成功没有」的唯一结论行。
              // 切换只动游标，验证才证明这条模型能回话；失败时带上宿主给的错误码，
              // 用户可以自己判断是额度、鉴权还是模型下架。
              (() => {
                const v = snap?.lastVerify;
                const vt = verifyText(v);
                if (!vt) return null;
                const vColor = {
                  ok: 'var(--dsw-alias-state-success-primary, #3a9e5f)',
                  warn: 'var(--dsw-alias-state-warn-primary, #c98a1b)',
                  error: 'var(--dsw-alias-state-error-primary, #c94141)',
                  muted: 'var(--dsw-alias-label-secondary, #888)',
                }[vt.tone];
                const mark = v.state === 'pending' ? '⏳ ' : v.state === 'ok' ? '✓ ' : '✕ ';
                return h(
                  'div',
                  {
                    style: {
                      padding: '6px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: '16px',
                      color: vColor,
                      borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                    },
                  },
                  `${mark}${lbl(v.index)} · ${vt.text}`,
                );
              })(),
              // 切换结果反馈条：只在切换本身失败（游标都没动）时出现
              flash
                ? h(
                    'div',
                    {
                      style: {
                        padding: '7px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: flash.tone === 'ok'
                          ? 'var(--dsw-alias-state-success-primary, #3a9e5f)'
                          : 'var(--dsw-alias-state-error-primary, #c94141)',
                        borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      },
                    },
                    (flash.tone === 'ok' ? '✓ ' : '✕ ') + flash.text,
                  )
                : null,
              // 宿主确认回执：这是「真的发到了这条模型」的唯一实证，来自宿主自己的回写，
              // 不依赖插件记账。用户问"怎么确定真切了"时，看这一行。
              (() => {
                const hc = snap?.hostConfirmed;
                if (!hc) {
                  return enabled
                    ? h('div', { style: { padding: '5px 14px', fontSize: 10, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))' } },
                        t('hostNotConfirmed'))
                    : null;
                }
                const name = `${hc.provider} / ${hc.model}`;
                return h(
                  'div',
                  { style: { padding: '5px 14px', fontSize: 10, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))' } },
                  t('hostConfirmed', { name, ago: fmtAge(Math.max(0, now - hc.at)) }),
                );
              })(),
              // 实际在跑的路由：这块是"看报错就知道是谁的锅"的关键——
              // 指示器显示的不是你手选的模型，而是这一轮真实请求发去了哪里。
              h(
                'div',
                {
                  style: {
                    padding: '8px 14px',
                    fontSize: 11,
                    lineHeight: '18px',
                    color: 'var(--dsw-alias-label-secondary)',
                    borderBottom: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                  },
                },
                // 「已失效，已切走」只在真实熔断时显示：当前已不在 P1（p1Follow 下 -1 才是 P1）
                // 且 P1 自己的熔断器非 closed。P1 健康时哪怕游标停在别处也不能喊"已失效"。
                !activeIsP1 && p1Leaning
                  ? h('div', { style: { opacity: 0.75 } }, t('badgeSwitchedAway', { label: lbl(active) }))
                  : null,
                // -1 在 p1Follow 下就是 P1（正常），不能说成"未经过队列"
                !p1Follow && inFlight < 0 && enabled
                  ? h('div', { style: { opacity: 0.75 } }, t('noteNotQueued'))
                  : null,
              ),
              // 队列条目
              h(
                'div',
                { style: { padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 } },
                h('div', {
                    key: 'p1-row',
                    ...(enabled && !p1Active
                      ? rowSwitchProps(false, p1Follow ? -1 : 0, 'P1')
                      : enabled && p1Follow
                        ? {
                            role: 'button',
                            tabIndex: 0,
                            title: t('p1PickModel'),
                            onClick: () => openHostModelPicker(),
                            onKeyDown: (ev) => {
                              if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openHostModelPicker(); }
                            },
                          }
                        : {}),
                    style: {
                      display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, fontSize: 12,
                      background: p1Active ? 'var(--dsw-alias-brand-primary, #4f7cf7)' + '14' : 'transparent',
                      cursor: enabled && (p1Follow || !p1Active) ? 'pointer' : 'default',
                    },
                  },
                  h('strong', { style: { width: 22, fontSize: 11, opacity: 0.85 } }, 'P1'),
                  h('span', { style: { flex: 1, opacity: p1Active ? 1 : 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    p1Follow ? t('sessionModelSuffix', { name: p1DisplayName }) : p1DisplayName),
                  p1Active
                    ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-brand-primary, #4f7cf7)', fontWeight: 600 } }, t('currentTag'))
                    : null,
                  healthBadge(p1Entry, snap, now) || h(Badge, { tone: 'muted' }, t('stateOk')),
                  circuitInfoIcon(p1Entry, snap),
                  ),
                ...(entries.length === 0
                  ? [h('div', { key: 'empty', style: { padding: '10px 6px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('noFallbacks'))]
                  : entries.map((e) => {
                      // 队列下标就是生效位置，直接比（p1Follow 下 e.index===0 是 P2，不再排除）
                      const isActive = effective === e.index;
                      return h(
                        'div',
                        {
                          key: e.index,
                          ...rowSwitchProps(isActive, e.index, lbl(e.index)),
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '7px 8px',
                            borderRadius: 8,
                            fontSize: 12,
                            background: isActive ? 'var(--dsw-alias-brand-primary, #4f7cf7)' + '14' : 'transparent',
                            cursor: enabled && !isActive ? 'pointer' : 'default',
                          },
                        },
                        h('strong', { style: { width: 22, fontSize: 11, opacity: 0.85 } }, `P${e.index + (p1Follow ? 1 : 0) + 1}`),
                        h('span', { style: { flex: 1, opacity: isActive ? 1 : 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 } },
                          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${e.provider} / ${e.model}`),
                          e.pinned === true ? h('span', { title: t('pinnedTag'), style: { flex: 'none' } }, '📌') : null,
                          paidTag(e.paid),
                        ),
                        isActive
                          ? h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-brand-primary, #4f7cf7)', fontWeight: 600 } }, t('currentTag'))
                          : null,
                        healthBadge(e, snap, Date.now()),
                        circuitInfoIcon(e, snap),
                      );
                    })),
              ),
              // 底部：最近切换 + 设置入口
              h(
                'div',
                {
                  style: {
                    padding: '8px 14px',
                    borderTop: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #eee))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: 'var(--dsw-alias-label-secondary)',
                  },
                },
                // from===to 是空操作（老宿主会记），不显示成"P2 → P2"
                snap?.lastSwitch && snap.lastSwitch.from !== snap.lastSwitch.to
                  ? t('recentSwitch', { from: lbl(snap.lastSwitch.from), to: lbl(snap.lastSwitch.to) })
                  : t('noSwitchRecord'),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  // 已经在 P1 就不给"切回 P1"按钮（-1/静态 0 都算在 P1）
                  enabled && !p1Active
                    ? h(
                        'button',
                        {
                          onClick: failback,
                          title: t('failbackTitle'),
                          style: {
                            fontSize: 11,
                            padding: '3px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--dsw-alias-brand-primary, #4f7cf7)',
                            background: 'transparent',
                            color: 'var(--dsw-alias-brand-primary, #4f7cf7)',
                            cursor: 'pointer',
                          },
                        },
                        // 只有不在 P1 时才显示按钮：已在 P1 跟随再给"切回"就自相矛盾
                        t('failbackAction'),
                      )
                    : null,
                  // F4：chip 面板手动探测全部
                  (enabled && entries.length > 0)
                    ? h(
                        'button',
                        {
                          onClick: () => { void host.pingAll().then(() => { /* 周期性快照会刷新徽章 */ }); },
                          disabled: snap?.probingAll === true,
                          title: snap?.probingAll === true ? t('probingAll', { done: 0, total: entries.length }) : t('probeAll'),
                          style: {
                            fontSize: 11,
                            padding: '3px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
                            background: 'transparent',
                            color: 'inherit',
                            cursor: snap?.probingAll === true ? 'not-allowed' : 'pointer',
                            opacity: snap?.probingAll === true ? 0.5 : 1,
                          },
                        },
                        snap?.probingAll === true ? t('probingAll', { done: 0, total: entries.length }) : t('probeAll'),
                      )
                    : null,
                  onOpenSettings
                    ? h(
                        'button',
                        {
                          onClick: onOpenSettings,
                          style: {
                            fontSize: 11,
                            padding: '3px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--dsw-elevation-stroke-color, var(--dsw-alias-label-secondary, #ddd))',
                            background: 'transparent',
                            color: 'inherit',
                            cursor: 'pointer',
                          },
                        },
                        t('settings'),
                      )
                    : null,
                ),
              ),
            )
          : null,
      );
    }

    // ---------- 装配 ----------

    // ---------- Typert Remote 契约（SRC fallback：host 侧 Service 无 strict schema，client 描述符走最小 strict codec） ----------

    const jsonCodec = (sym) => ({ mode: 'strict', typeSymbol: sym, create: () => ({}) });

    const TYPERT_REMOTE = {
      package: 'dsh-model-fallback-queue',
      descriptors: [
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/snapshot',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'snapshot',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'src-json' },
        },
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/probe',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'probe',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'index', wire: 'index', source: 'json', codec: jsonCodec('dsh-model-fallback-queue#Index') }],
          result: { mode: 'src-json' },
        },
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/manualFailback',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'manualFailback',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'index', wire: 'index', source: 'json', codec: jsonCodec('dsh-model-fallback-queue#Index') }],
          result: { mode: 'src-json' },
        },
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/getQueue',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'getQueue',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'src-json' },
        },
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/setQueue',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'setQueue',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'queue', wire: 'queue', source: 'json', codec: jsonCodec('dsh-model-fallback-queue#Queue') }],
          result: { mode: 'src-json' },
        },
        // F4：探测全部（6th method）
        {
          id: 'dsh-model-fallback-queue#dsh-model-fallback-queue/pingAll',
          service: 'FallbackQueueService',
          namespace: 'dsh-model-fallback-queue',
          method: 'pingAll',
          invocation: { kind: 'direct' },
          parameters: [{ name: 'opts', wire: 'opts', source: 'json', codec: jsonCodec('dsh-model-fallback-queue#PingAllOpts') }],
          result: { mode: 'src-json' },
        },
      ],
    };

    return {
      inject: ['slots', 'remote', 'remote.settings', 'remote.session'],
      async apply(ctx) {
        // 挂载自己的 Remote namespace，然后在内层 ctx.inject 里拿 remote.dsh-model-fallback-queue face
        const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
        ctx.effect(() => () => { void disposeRemote(); }, 'fallback-queue remote mount');
        // session face 供 ModelPicker 拉模型目录（同内置模型选择器的数据源）
        window.__fallbackQueueSession = ctx.remote.session;
        await ctx.inject(
          ['slots', 'remote', 'remote.settings', 'remote.dsh-model-fallback-queue'],
          (rctx) => registerSlots(rctx, rctx.remote?.['dsh-model-fallback-queue']),
        );
      },
    };

    // typert face 的返回值可能是 {ok,value} 信封，也可能是裸值（取决于 result codec）。
    // 统一拆一次：成功取 value，失败/异常取 null。
    function unwrapEnvelope(r) {
      if (r && typeof r === 'object' && 'ok' in r) return r.ok ? (r.value ?? null) : null;
      return r ?? null;
    }

    function registerSlots(ctx, rpcFace) {
        // 健康圆点动画样式（幂等注入一次）
        if (!document.getElementById('fq-dot-style')) {
          const st = document.createElement('style');
          st.id = 'fq-dot-style';
          st.textContent = `
            .fq-dot{position:absolute;top:-2px;right:-2px;width:5px;height:5px;border-radius:50%;
              background:var(--fq-dot-color,#22c55e);border:1.5px solid var(--dsw-alias-bg-overlay,#fff);
              animation:fq-pulse 2s ease-in-out infinite;}
            .fq-dot-fast{animation-duration:1s;}
            .fq-dot-off{animation:none;opacity:.6;}
            @keyframes fq-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--fq-dot-color)}50%{opacity:.35;box-shadow:0 0 0 3px transparent}}`;
          document.head.appendChild(st);
        }
        // host 桥：经 ctx（client side）调用 host 侧设置与运行态。
        // rpcFace = 内层 inject 显式注入的 'remote.dsh-model-fallback-queue' face（ctx.remote 上未必有该键）。
        const host = {
          async getSettings() {
            try {
              // ctx.remote.settings.describe() 返回 {ok, value} 信封（原生 UI 同款处理）；
              // value = {writable, hasDocument, namespaces:[{ns, value, revision}...]}
              const doc = await ctx.remote?.settings?.describe?.();
              if (!doc?.ok) return null;
              const v = doc.value;
              const list = Array.isArray(v) ? v : v?.namespaces;
              const ns = (list || []).find((n) => n.ns === 'dsh-model-fallback-queue');
              return ns?.value ?? null;
            } catch (e) {
              console.warn('[fallback-queue] getSettings failed', e);
              return null;
            }
          },
          async updateSettings(patch) {
            try {
              const doc = await ctx.remote?.settings?.describe?.();
              const v = doc?.ok ? doc.value : doc;
              const list = Array.isArray(v) ? v : v?.namespaces;
              const ns = (list || []).find((n) => n.ns === 'dsh-model-fallback-queue');
              // update 返回 {ok, value} 信封：**必须把结果带回调用方**。
              // 旧实现只 console.warn，设置页于是把失败当成功——用户点开关，
              // 页面刷新后弹回原值，看起来就是"设置页坏了/点了没用"。
              const r = await ctx.remote?.settings?.update?.(
                'dsh-model-fallback-queue',
                patch,
                ns?.revision,
              );
              if (r && r.ok === false) {
                console.warn('[fallback-queue] update rejected', r.error?.message);
                return { ok: false, error: r.error?.message || 'update rejected' };
              }
              return { ok: true };
            } catch (e) {
              console.warn('[fallback-queue] update failed', e);
              return { ok: false, error: e?.message || String(e) };
            }
          },
          // 队列经 host 侧 RPC 读写 state 文件（不走 settings，避免主题全量重算）
          async getQueue() {
            try {
              const remote = rpcFace;
              if (!remote?.getQueue) return null;
              const r = await remote.getQueue();
              const v = r && typeof r === 'object' && 'ok' in r ? (r.ok ? r.value : null) : r;
              return Array.isArray(v?.queue) ? v.queue : null;
            } catch (e) {
              console.warn('[fallback-queue] getQueue failed', e);
              return null;
            }
          },
          async setQueue(queue) {
            try {
              const remote = rpcFace;
              if (!remote?.setQueue) return { ok: false, error: 'setQueue unavailable' };
              const r = await remote.setQueue(queue);
              if (r && typeof r === 'object' && 'ok' in r && r.ok === false) {
                console.warn('[fallback-queue] setQueue rejected', r.error?.message);
                return { ok: false, error: r.error?.message || 'setQueue rejected' };
              }
              // 信封里带 ok:false 之外，host 侧写盘失败会以 {ok:false} 返回
              return { ok: true };
            } catch (e) {
              console.warn('[fallback-queue] setQueue failed', e);
              return { ok: false, error: e?.message || String(e) };
            }
          },
          async getRuntimeSnapshot() {
            try {
              const remote = rpcFace;
              if (!remote?.snapshot) return null;
              const r = await remote.snapshot();
              // typert face 可能返回 {ok,value} 信封或裸值，两种都兼容
              if (r && typeof r === 'object' && 'ok' in r) return r.ok ? (r.value ?? null) : null;
              return r ?? null;
            } catch (e) {
              console.warn('[fallback-queue] snapshot failed', e);
              return null;
            }
          },
          // typert face 返回值可能是 {ok,value} 信封（失败时 {ok:false,error}），也可能
          // 是裸值。统一在这里拆一次，调用方看到的永远是裸值/null，避免把 {ok:false}
          // 当成真值继续用（probe/manualFailback 以前直接透传信封，UI 判断会失真）。
          async probe(index) {
            try {
              const r = await rpcFace?.probe?.(index);
              return unwrapEnvelope(r);
            } catch (e) {
              console.warn('[fallback-queue] probe failed', e);
              return null;
            }
          },
          async manualFailback(index) {
            try {
              const r = await rpcFace?.manualFailback?.(index);
              return unwrapEnvelope(r);
            } catch (e) {
              console.warn('[fallback-queue] manualFailback failed', e);
              return null;
            }
          },
          // F4：探测全部（手动按钮优先，skipPaid=false 全探测；周期扫描由 host 端计时器驱动）
          async pingAll() {
            try {
              const r = await rpcFace?.pingAll?.();
              return unwrapEnvelope(r);
            } catch (e) {
              console.warn('[fallback-queue] pingAll failed', e);
              return null;
            }
          },
        };

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'dsh-model-fallback-queue', order: 60, label: t('slotLabel') },
            () => SettingsPage({ host, onOpenSettings: null }),
          ),
        );

        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register(
            { name: 'conversation.input.right', id: 'dsh-model-fallback-queue-chip', order: 20 },
            // slot 是 session scope：宿主渲染时把当前会话的 sessionId 等标准 props 传进来，
            // 原样透传给 Chip（Chip 里读 props.sessionId 取 per-session inFlight）。
            (slotProps) => Chip({ ...slotProps, host }),
          ),
        );
    }
  },
});
