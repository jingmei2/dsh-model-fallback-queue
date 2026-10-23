# dsh-model-fallback-queue

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-model-fallback-queue"><img src="https://img.shields.io/npm/v/dsh-model-fallback-queue?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-model-fallback-queue"><img src="https://img.shields.io/npm/d18m/dsh-model-fallback-queue?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/HelloQingTao/dsh-model-fallback-queue?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/HelloQingTao/dsh-model-fallback-queue/stargazers"><img src="https://img.shields.io/github/stars/HelloQingTao/dsh-model-fallback-queue?style=flat-square" alt="GitHub stars"></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://awesome.re/badge.svg" alt="Awesome"></a>
</p>

**English** | [中文](#中文)

---

## 中文

当前模型限额、限流或不可用时，自动切到队列里的下一个模型，把会话接着跑完。开关、队列、P1 恢复策略都在设置页里点，不需要命令行。

### 功能

- **请求级自动切换**：命中熔断码立刻熔断当前路由；非即时错误连续失败 2 次也熔断。
- **队列 P1 → Pn**：P1 默认跟随当前会话模型（你在模型选择器里换，P1 跟着换），队列里加的是后备 P2、P3…
- **三档 P1 恢复策略**：粘滞（默认）/ 探测回切 / 手动回切。
- **输入框状态芯片**：显示当前生效路由与健康状态，全熔断时是红色「全部熔断」徽章；展开是队列面板，可「切回 P1」或跳到设置页。
- **全熔断降级放行**：所有路由都不可用时按原配置放行，插件不拦截请求。
- **不抢同路由重试的活**：非致命错误一律放行，退避重试仍由 dsh-llm-retry 负责。
- **界面中英双语**：所有界面文案跟随 DSH 的语言设置，自动在中文 / English 之间切换。
- **厂商勾选批量添加**：模型选择器按厂商分组，复选框一次勾选多个，批量入队（按「先厂商、后组内序」追加；已入队的自动防重复）。
- **大保底置顶（pinned）**：给某个模型打上📌「大保底」标记，无论怎么排序它都恒在队尾（最后兜底），P1 槽不受影响。
- **免费/付费标记**：入口行手动标记免费或付费，芯片与设置页同步显示（中性文字标签，不占用颜色）；仅作标注辅助，不参与排序、不自动判定。
- **切换是否生效，面板直接回答**：切换本身只决定「下一个请求用哪条」，不产生任何可用性结论。面板顶部那一行写的是**上一轮真实请求**走了哪条、成没成（`上一轮：P3 · 成功 · 12s前` / `上一轮：P3 · 失败 · QUOTA`）；还没发过消息就写「还没发过消息」，刚切换就写「已切到 P3，下一条消息会用它」。没有探测伪造的「验证通过」，也没有自相矛盾的「P1 验证失败」。
- **健康色与前瞻**：颜色只表示健康——绿＝刚确认可用、黄＝风险（探测失败或偏慢）、红＝熔断、灰＝未测；行内只放状态词加一个很短的「12s前」，完整证据（延迟、失败码、原因）在悬浮提示里，不占面板空间。周期探测默认每 60 秒一次、默认**探测全部模型**（含付费，`maxTokens=1`）；**探测失败只记证据、不会把路由自己熔断**，探测请求被厂商拒绝时标「探测被拒」而不是「不可用」。
- **快速探测（ping）**：一键探测队列里所有模型可用性；周期健康探测默认 60 秒一次（可在设置里改间隔或关掉，也可选择跳过付费模型省配额）。
- **面板直接点选切换**：点芯片面板里的任意一行，立即把生效路由切到该模型（不用等它故障）；P1 行在已生效时点击会打开宿主的模型选择器——P1 的身份就是当前会话模型，只有宿主能改。

### 效果图

设置页（开关 / 队列 / P1 恢复策略）：

![故障转移设置页：启用开关、P1 → Pn 队列（优先级、路由名、健康徽章、上移/下移/移除）、+ 添加模型、P1 恢复策略三档单选](assets/settings-page.png)

输入框右侧的芯片与展开面板：

![输入框右侧的故障转移芯片与展开面板：P1 当前会话模型、P2/P3/P4 后备路由与健康状态、最近切换记录](assets/chip-panel.png)

### 安装

```sh
dsh plugin --profile web add dsh-model-fallback-queue
```

装完重启 dsh（或刷新 Web GUI），bundle 会随包里的 `cordis.patch.yml` 自动注册。

### 用法

1. **设置 → 故障转移** → 打开「启用故障转移」。
2. **+ 添加模型**：挑后备模型（P2、P3…），↑ / ↓ 调顺序，「移除」删掉。
3. **P1 恢复策略**：选粘滞 / 探测回切 / 手动回切。
4. 回到会话：输入框右侧出现芯片，显示当前生效的 P1 路由。

发生切换时，会话里会出现核心自带的「模型已切换」通知，芯片同步切到新路由。

**芯片状态**

| 显示 | 含义 |
| --- | --- |
| `P1` + 绿点 | 正常走 P1 |
| `P2`（黄点） | 已切到 P2；黄点表示半开探测中 |
| `P!` + 红点 | 队列全部熔断，已降级放行原配置 |
| `P`（灰点） | 插件未启用 |

**恢复策略三档**

| 档位 | 行为 |
| --- | --- |
| **粘滞**（默认） | 切到 P2 后只要 P2 可用就一直用，P1 恢复也不切回；P2 也挂时按邻近可用往后找，绕回 P1 是最后手段。 |
| **探测回切** | P1 冷却到期后，由下一个真实请求探测回 P1；成功留下，失败回 P2（防抖 5 分钟，不发额外探测流量）。 |
| **手动回切** | 切走后不自动回 P1，用芯片面板里的「切回 P1」恢复。 |

### 配置项

| 字段 | 默认值 | 说明 | 设置页可改 |
| --- | --- | --- | --- |
| `enabled` | `false` | 总开关 | ✅ |
| `queue` | `[]` | 后备队列，数组顺序即优先级（存在 `~/.dsh/fallback-queue-state.json`，不在 settings 里，见下方说明） | ✅ |
| `failbackMode` | `sticky` | `sticky` / `probe` / `manual` | ✅ |
| `p1Follow` | `true` | P1 跟随当前会话模型 | — |
| `immediateCodes` | `QUOTA`、`ACCOUNT_QUOTA`、`RATE_LIMIT`、`AUTH`、`INVALID_CREDENTIAL`、`NO_ADAPTER` | 命中即熔断的错误码 | — |
| `failureThreshold` | `2` | 非即时码的连续失败阈值 | — |
| `cooldownMs` | `60000` | 熔断冷却毫秒 | — |
| `failbackDelayMs` | `300000` | 探测回切防抖毫秒 | — |

日常用的开关、队列、恢复策略都在设置页；标「—」的高级旋钮默认值适用于绝大多数场景，需要时写进 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里本插件那一行的 `config`。

**为什么队列不放在 settings 里**：DSH 的 `ui-theme` 只要你写一次 settings 文档，就会重推一次主题快照，前端随之把整页 design token 逐个移除再写回，深色模式下会闪一帧白。队列排序是高频操作（反复点上下箭头调优先级），放在 settings 里每点一次闪一次；改存独立的 JSON 文件就完全不碰 settings revision，白闪消失。

队列文件是插件私有数据，**不在设置页的配置导出/备份范围内**，换机器需要重新排序。首次升级时如果文件不存在，会自动把 settings 里的旧队列迁移过来，所以已有配置不会丢。

### 兼容与注意

- 实测 dsh `0.2.0-rc.2`、`0.2.1-rc.2`（宿主 + Web GUI）。
- 兼容范围以 `package.json` 的 `engines.dsh` 为准（当前 `>=0.2.0-rc.2 <0.3.0`）。
- 与 `dsh-client-auto-continue` 天然兼容：自动续发走同一条请求瀑布，一样享受队列切换。
- 与 `dsh-llm-retry` 分层：它管同路由退避重试，本插件管跨路由切换。
- 号池类 provider（如 workbuddy-xdpool）单号限流由号池内部换号，整池到顶才轮到本插件跨模型切换。
- 熔断态是内存态，进程重启归零；不写文件、不动 session。
- 队列为空或只有一项时不会发生切换。
- 不要和其他故障转移插件同时启用，两个插件争抢同一错误事件没有意义。

### 四大新功能

**① 厂商勾选批量添加（F1）**：点「+ 添加模型」打开选择器，顶部按厂商分组（来自 DSH 内置模型目录 `group.id`），每组是复选框列表，可跨厂商一次勾选多个；点底部「添加 N 个到队列」批量入队，顺序＝先厂商、后组内展示序。已入队的行整行置灰防重复，勾了也不会再添。

**② 大保底置顶（F2）**：队列每一行都有📌按钮。给某行打上「大保底」后，它在切换候选序里**恒排最后**（最后兜底）——不管你怎么用↑/↓调整其余行的顺序，大保底总在队尾；P1 槽（当前会话模型）不受影响，不能被打到大保底。允许多个大保底，彼此仍按物理序顺延；全部打上大保底时退化为原顺序，安全。

**③ 免费/付费标记（F3）**：行内按钮在「未标注 → 免费 → 付费 → 未标注」间轮转；标签为中性文字（不占用颜色通道——颜色专供健康状态），未标注不显示。芯片面板同步显示。该标注只做展示辅助，**不参与排序、不做自动判定**（没有可靠的免费/付费数据源，不猜）。

**④ 快速探测 ping（F4）**：设置页排队按钮旁的「探测全部」一键并发（串行请求）探测队列里所有模型可用性，结束后提示「可用 N / 不可用 M」；芯片面板也有同款按钮。设置页下方可配**周期健康探测**：`周期探测间隔`（毫秒，0＝关闭，默认 60000＝每 60 秒一次；存量设置会一次性从 0 升到 60000，之后改回 0 永久生效）＋ `周期探测跳过付费模型`（默认开，省配额）。⚠ 周期探测会向模型发真实请求，可能消耗配额/费用。

### 许可证

[MIT](LICENSE)

---

## English

When your current model hits its quota, gets rate-limited or becomes unavailable, requests automatically fail over to the next model in your queue and the session keeps going. The switch, the queue and the P1 recovery mode are all configured from the Settings UI — no CLI needed.

### Features

- **Per-request failover.** Known failure codes trip the current route immediately; two consecutive failures of any other kind also trip it.
- **Queue P1 → Pn.** P1 follows the current session model by default (switch models in the picker and P1 follows); entries you add are the backups P2, P3…
- **Three P1 recovery modes.** Sticky (default), probe-back, manual.
- **Input-box status chip.** Shows the active route and its health, a red “all tripped” badge when nothing is left; expand it for the queue panel with a “Back to P1” action and a settings shortcut.
- **Degrades safely.** When every route is tripped the original config is passed through untouched — the plugin never blocks a request.
- **Does not fight same-route retries.** Non-fatal errors are always passed through; backoff retries stay with dsh-llm-retry.
- **Bilingual UI.** Every label follows the DSH language setting and switches between 中文 and English automatically.
- **Batch vendor-based adding.** The model picker groups by vendor; check a box per vendor, tick several, and add them all at once (appended vendor-by-vendor then in-group display order; entries already in the queue are greyed out and never re-added).
- **Pin as last resort (📌).** Mark any row as a “safety net” and it always stays at the tail of the failover order, no matter how you reorder the rest; the P1 slot is unaffected. Multiple pins keep their relative order; pinning everything just falls back to the natural order.
- **Free/paid marks.** Toggle each entry 未标注 → free → paid. Shown in both the settings rows and the chip panel as neutral text tags (colour is reserved for health); purely a visual aid — never used for sorting or guessed automatically.
- **Health colour + foresight.** Colour means health only: green = just confirmed working, amber = risk/pending, red = tripped, grey = unverified. Rows carry evidence such as “probe 820ms · 12s ago”, and periodic probing confirms every model every 60s by default.
- **Fast ping probe.** One click probes every queue model for availability (serial, ~1 token each); periodic health probing runs every 60s by default (paid models skipped to save quota/cost; set the interval to 0 to turn it off).
- **Click-to-switch in the panel.** Click any row in the chip panel to route the active traffic to that model immediately — no failure required. Clicking the P1 row while it is active opens the host's model picker, because P1 *is* the current session model and only the host can change it.

### Screenshots

Settings page (switch / queue / P1 recovery mode):

![Failover settings page: enable switch, P1 → Pn queue (priority, route, health badge, move up/down, remove), + Add model, and the three P1 recovery modes](assets/settings-page.png)

The chip next to the input box and its expanded panel:

![The chip next to the input box and its expanded panel: P1 is the current session model, P2/P3/P4 are backups with health badges, plus the last-switch line](assets/chip-panel.png)

### Install

```sh
dsh plugin --profile web add dsh-model-fallback-queue
```

Restart dsh (or reload the Web GUI); the bundle registers itself through the `cordis.patch.yml` shipped in the package.

### Usage

1. **Settings → Failover** → turn on “Enable failover”.
2. **+ Add model** to add backups (P2, P3…); reorder with ↑ / ↓, remove with the remove action.
3. Pick a P1 recovery mode.
4. Back in the conversation, the chip next to the input box shows the active P1 route.

On every switch the core “model switched” notice appears in the session and the chip follows.

**Chip states**

| Chip | Meaning |
| --- | --- |
| `P1` green dot | Running on P1 |
| `P2` amber dot | Switched to P2; amber means a half-open probe is in flight |
| `P!` red dot | Every route tripped — original config passed through |
| `P` grey dot | Plugin disabled |

**Recovery modes**

| Mode | Behaviour |
| --- | --- |
| **Sticky** (default) | Once on P2 it stays there while P2 works, even after P1 recovers; if P2 also fails it walks forward and only wraps back to P1 as a last resort. |
| **Probe back** | After P1's cooldown expires the next real request probes P1; success keeps it, failure returns to P2 (5-minute debounce, no extra probe traffic). |
| **Manual** | Never returns to P1 automatically — use “Back to P1” in the chip panel. |

### Configuration

| Field | Default | Description | In Settings UI |
| --- | --- | --- | --- |
| `enabled` | `false` | Master switch | ✅ |
| `queue` | `[]` | Backups; array order = priority (stored in `~/.dsh/fallback-queue-state.json`, not in settings — see below) | ✅ |
| `failbackMode` | `sticky` | `sticky` / `probe` / `manual` | ✅ |
| `p1Follow` | `true` | P1 follows the current session model | — |
| `immediateCodes` | `QUOTA`, `ACCOUNT_QUOTA`, `RATE_LIMIT`, `AUTH`, `INVALID_CREDENTIAL`, `NO_ADAPTER` | Codes that trip a route immediately | — |
| `failureThreshold` | `2` | Consecutive failures for a soft trip | — |
| `cooldownMs` | `60000` | Circuit cooldown in ms | — |
| `failbackDelayMs` | `300000` | Probe-back debounce in ms | — |

The everyday switch, queue and recovery mode live in the Settings UI; the advanced knobs marked “—” keep sensible defaults and can be set in the plugin row's `config` inside `~/.dsh/profiles/<profile>/cordis.patch.yml`.

**Why the queue is not in settings**: any write to a DSH settings document makes `ui-theme` republish the theme snapshot, and the client then removes and rewrites every design token for the whole page — in dark mode that shows up as a one-frame white flash. Reordering the queue is frequent (you keep clicking the up/down arrows), so keeping it in settings meant a flash per click. Storing it in a standalone JSON file never touches the settings revision, and the flash is gone.

That file is plugin-private data and is **outside the Settings UI's config export/backup**, so ordering must be redone on another machine. On the first upgrade, if the file is missing, the old queue in settings is migrated automatically — existing configuration is not lost.

### Compatibility & notes

- Tested with dsh `0.2.0-rc.2` and `0.2.1-rc.2` (host + Web GUI).
- The supported range is declared by `engines.dsh` in `package.json` (currently `>=0.2.0-rc.2 <0.3.0`).
- Works alongside `dsh-client-auto-continue`: auto-continue rides the same request waterfall, so it benefits from failover too.
- Layered with `dsh-llm-retry`: it handles same-route backoff, this plugin handles cross-route failover.
- For pool-style providers (e.g. workbuddy-xdpool) a single account's rate limit is handled inside the pool; this plugin only switches models once the whole pool is exhausted.
- Breaker state is in memory and resets on restart; the plugin writes no files and never touches the session.
- No switching happens with an empty or single-entry queue.
- Do not run another failover plugin at the same time — two plugins competing for the same error event is not useful.

### Four new features

**① Batch add by vendor (F1).** Click “+ Add model”; the picker lists vendors (from the built-in DSH model catalog `group.id`) with a checkbox list per vendor. Tick across vendors, then “Add N to queue” appends them all in vendor → in-group order. Rows already in the queue are disabled and deduped.

**② Pin as last resort (F2).** Each queue row has a 📌 button. Pinning a row forces it to the **tail** of the failover candidate order (last resort) regardless of ↑/↓ moves on the other rows; the P1 slot (current session model) can't be pinned and stays first. Multiple pins keep their relative order; pinning everything degrades safely to the original order.

**③ Free/paid marks (F3).** The row button cycles 未标注 → free → paid → 未标注; tags are neutral text (colour is reserved for health), unknown shows none. The chip panel mirrors the tags. Purely a display aid — never used for ordering or auto-detected (there is no reliable source, so it never guesses).

**④ Fast ping probe (F4).** The “Probe all” button (in the settings page next to the queue, and in the chip panel) pings every queue model serially and reports “N ok / M unavailable”. Below the queue, periodic health probing can be enabled via **probe interval (ms, 0 = off, default 60000 = once a minute; existing configs are migrated from 0 once)** and **skip paid models in periodic probes** (default on, saves quota). ⚠ Periodic probing sends real requests to models and can consume quota/cost.

### License

[MIT](LICENSE)
