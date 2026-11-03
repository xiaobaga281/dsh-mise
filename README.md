# Mise

**A film is a mise-en-scène.** Mise 是一个把「影片」写成网页、由代码渲染成 MP4 的 DSH 插件：构图、排版、动效、配乐、测量、校验、渲染、交付都在插件内部完成，**不依赖外部 Studio、网页编辑器或视频生成模型**。

- **影片 = `film.html` + 一组镜头页**，片段用 `at` / `#t=in,out` 排到时间轴上，`window.film.frame(t)` 画出第 t 秒
- **渲染 = 自带渲染器**：临时回环服务 + headless Chromium 逐帧驱动时钟 + ffmpeg 混流，默认 2× 超采样
- **配乐 = 代码合成**（拨弦 / 铺底 / 混响），卡点重音、段落和声、句子级闪避，自带母带总线
- **测量 = 先看见再交付**：调色板、影调、色度、构图、细节分层、运动曲线、逐行对比度、响度与频段
- **交付 = 门禁驱动**：结构校验 → 抽帧验收 → 逐镜批准 → 调色 / 响度 / 回执

核心主张：**能测量的都不靠形容词**。每个判断要么有像素、要么有数字、要么有标准编号（EBU R95、WCAG 1.4.3、ITU-R BS.1770、Netflix TTSG）。

## 安装

### 方式一：从发布包安装（推荐）

```bash
npm i -g ./dsh-mise-2.2.0.tgz
# 或解包后 link 进 ~/.dsh/plugins/dsh-mise
```

### 方式二：目录 + profile 登记

插件就是一个目录，链接进 DSH 桌面 profile 即可：

```powershell
# 1. 放到任意位置，例如 C:\Users\<你>\.dsh\plugins\dsh-mise

# 2. 在 profile 里登记（~/.dsh/profiles/desktop/package.json）
#    dependencies:  "@local/dsh-mise": "link:C:/Users/<你>/.dsh/plugins/dsh-mise"
#    dsh.profile.bundles: 追加 "@local/dsh-mise"

# 3. junction（Windows）
New-Item -ItemType Junction `
  -Path  "$HOME\.dsh\profiles\desktop\node_modules\@local\dsh-mise" `
  -Target "$HOME\.dsh\plugins\dsh-mise"

# 4. 完全退出 DSH 桌面应用再打开
```

`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，宿主启动时按它插入一行 Host，注册全部工具与技能。

自检（会真的挂载一遍，工具数 / 路由 / overlay 补丁）：

```bash
node tests/install-check.mjs
# installed plugin: 37 tools, 12 routes, 11 skills
```

## 工具（37 个）

| 分组 | 工具 | 用途 |
|---|---|---|
| **起步** | `mise_start` / `mise_new` / `mise_demo` | 环境引导 / 新建工程（建完即可渲染）/ 端到端样片（仅供机器自检） |
| | `mise_manual` / `mise_run` / `mise_doctor` | 影片格式手册 / 命令入口（open·look·render·skills·manual）/ 体检 |
| **规划** | `mise_plan` | 按类型配方出计划：镜头、节奏、配乐网格、调色 |
| | `mise_timeline` | 按算术把旁白铺到镜头下（`mise_voice` 返回实测秒数） |
| **写作** | `mise_type` / `mise_graphics` / `mise_scene` / `mise_cine` | 排版页（版式 / 母题 / 角色 / 色温）/ 图表页 / 场景页（可带字幕家具）/ 摄影感页面 |
| | `mise_promo` / `mise_promo_plan` | 产品宣传片语言与提案（读 README + facts.json） |
| | `mise_duo` / `mise_transition` / `mise_keyframes` | 呈现式转场 / 覆盖式转场 / 镜内关键帧 |
| **测量** | `mise_probe` | **单页体检**：纯函数性、逐行真实对比度、越界、字号、运动、细节分层，并按成文规范断言 |
| | `mise_motion` | 检索动作目录：写页面之前先看有哪些可用动作 |
| **素材** | `mise_cutout` / `mise_depth` / `mise_interpolate` | 抠像 / 景深 / 插帧 |
| | `mise_asset` / `mise_voice` / `mise_pack` | 外部生成图片视频 / 配音 / 可选增强包（SHA-256 校验） |
| **声音** | `mise_score` / `mise_mix` | 配乐（母带 −18 LUFS / TP −1 dBTP，附切点对齐、速度与和声检查）/ 混音闪避 |
| **检查** | `mise_check` / `mise_verify` / `mise_review` | 结构校验 / 像素验收（含整片外观：调色板、影调、色度、异常镜头）/ 逐镜批准 |
| | `mise_look` / `mise_thumbs` | 联系表 + 响度 / 分镜缩略图 |
| **输出** | `mise_compose` | **先量截图留白再定构图**（解码 PNG → 墨量网格 → 版位 / 遮罩 / 曝光） |
| | `mise_render` / `mise_grade` / `mise_deliver` / `mise_signoff` | 渲染 MP4 / 统一调色（预设 + 颗粒 + 暗角 + 光晕 + 遮幅）/ 交付（门禁、响度、回执）/ 人工签收 |

### `mise_probe` 断言的数字

| 规则 | 阈值 | 依据 |
|---|---|---|
| 标题安全区 | 每边 5%（1080p 下 54px） | EBU R 95 / SMPTE ST 2046-1 |
| 正文对比度 | 4.5:1；大字 3:1；低于 2.0:1 一律报错 | WCAG 2.1 SC 1.4.3 |
| 单行长度 | CJK 40 字 / 拉丁 80 字符；行距 ≥ 1.15 | WCAG 2.1 SC 1.4.8 |
| 阅读速度 | 20 字符/秒（整镜常驻文本） | Netflix Timed Text Style Guide |
| 削白占比 | < 2% 画面 | 广播 QC 惯例 |

每条 finding 都带测量值和标准名，**故意破也可以**——审计的意义是让"破"成为一次决定，而不是一次疏忽。

## 画面上被测量的东西

一帧画面进去，出来的是描述，不是评分：

| 维度 | 内容 |
|---|---|
| **调色板** | 覆盖画面的颜色（hex + 占比），相邻色合并 |
| **影调** | p1 / p5 / 中位 / p95 / p99、对比区间、死黑与削白占比 |
| **色度** | HSV 饱和度 + **绝对色度**、冷暖、色相分散度 |
| **构图** | 相对背景的墨量质心、左右/上下/三分平衡、边缘密度、**地平线所在行** |
| **细节** | 局部细节均值/峰值、平坦占比、`radialSlope`（负 = 有焦平面，近 0 = 平面图形） |
| **运动** | 变化覆盖率（平移 vs 主体）、全局位移 px + 置信度、速度曲线与 `even / decelerating / accelerating` |

两个用法：

- **整片跟自己比**（`mise_verify`）：不用外部调色板。算成对距离，点名"离群镜头"。夜海和白底产品页都被如实测量——它回答的是"这一镜是不是不一样"，不是"这一镜好不好"。
- **对照参考图**（`mise_probe { reference }`）：返回五维距离（调色板 / 中位亮度 / 对比 / 色度 / 冷暖），把"像这张"变成数字。

## 声音

- 响度按 **ITU-R BS.1770** 测：K 加权、400ms/100ms 分块、绝对 + 相对门控、**按声道功率求和**（立体声比单声道高 3 LU，这一步不能省）。与 `ffmpeg ebur128` 校准到 0.1 LU。
- 配乐走**母带总线**：30 Hz 高通 → 按积分响度设增益 → 软限幅 → **−1 dBTP** 封顶，目标 **−18 LUFS**（stem；成片在交付阶段整体归一）。
- `auditScore` 检查的是作曲会检查的东西：切点相对自身节拍网格的 **ms 偏差**、**beats per shot**、**和弦是否真的在走**、有没有留白。
- 有人声时：bed 比人声低 12–18 dB（纪录片 18–25），2 kHz 宽而浅 2–4 dB，ducking 3–6 dB / release 300–600 ms。

## 页面侧基础能力 `vendor/motion/mise-kit.mjs`

模型自己写页面时每次都在重新发明六件事，而且都做得很粗糙。这个库就是那六件，**不含任何对片子的主张**：

```js
import { defineShot, stage, typeScale, grid, inkOn, contrast,
         reveal, camera, grain, drawOn, beats, seeded, token } from './mise-kit.mjs';

const type = typeScale({ base: 26, width: stage().width });   // 真字阶，按画幅算
const g = grid({ width: stage().width });                     // 栏/沟/边距都是数字
const ink = inkOn(card, { light: '#f6f1e7', dark: '#111' });  // 两者里能读的那个

defineShot((t) => {
  reveal(title, t, { at: 0.2, kind: 'mask' });                // rise/fade/mask/wipe/blur/scale
  camera(world, t, { move: 'push-in', amount: 0.06 });        // 按画幅比例，不写死像素
  grain(dust, t);                                             // 逐帧换噪声瓦片
}, { duration: 4 });
```

还有 `drawOn`（SVG 按实测长度匀速描出）、`beats`（切点吸到半拍）、`seeded`（确定性随机，替掉 `Math.random`）、`tokens`（读 `look.css` 的自定义属性）、`fontReady`（逐族确认字体真的加载了）。

## 侧栏面板

原生侧栏，苹果设计语言：大标题 + 分段控件（分镜 / 预览 / 设置）。分镜是**真实帧缩略图**时间轴，可改时长与顺序、直接渲染；预览是成片画面；设置里是帧率、尺寸、响度与检查状态。

后端接口是 `/mise/*` 路由：`status`、`storyboard`、`run`、`file`、`check`、`progress`、`media`、`queue`、`library`、`credential`、`region-edit`、`speech`。

## 目录

```
plugin/
├── index.js               Host 入口：37 个工具与 /mise/* 路由
├── client.js              侧栏面板（分镜 / 预览 / 设置三段）
├── mise-render.mjs        渲染器（2× 超采样 / 快门 / 色彩标记）
├── mise-look.mjs          联系表 / 缩略图 / 响度
├── mise-film-doc.mjs      film.html 解析与写回
├── film-vision.mjs        画面描述（调色板 / 影调 / 色度 / 构图 / 细节分层）
├── film-motion.mjs        运动测量（变化覆盖率 / 全局位移 / 速度曲线）
├── film-probe.mjs         单页体检 + 规范审计
├── film-audio.mjs         响度表（BS.1770）+ 频段分析
├── film-*.mjs             其余能力模块（排版、场景、配乐、混音、构图、校验、交付…）
├── skills/                10 个风格文档 + MANUAL（随插件分发）
├── vendor/motion/         of-motion.mjs（动效数学）+ mise-kit.mjs（页面侧基础能力）
├── media-service.mjs      外部图片/视频生成（创建 → 轮询 → 下载，不重复付费）
├── locale/                en / zh 面板文案
├── scripts/sync.mjs       源码 → 安装目录完整镜像（哈希校验）
└── tests/                 全部套件（node 单文件可跑）
```

## 依赖

- Node（宿主自带运行时）
- `ffmpeg` / `ffprobe` 在 PATH 上（或设 `DSH_FFMPEG` / `DSH_FFPROBE`）
- `vendor/node_modules/playwright-core` + 本机 Chromium（`PLAYWRIGHT_BROWSERS_PATH`）

## 测试

```bash
node scripts/run-tests.mjs        # 全部套件，逐文件报告（36 个文件）
node tests/kit.test.mjs           # 页面侧基础能力 + 单页体检与规范审计
node tests/vision.test.mjs        # 画面描述（调色板 / 影调 / 构图 / 地平线）
node tests/flow.test.mjs          # 运动测量（平移 vs 主体 / 速度曲线）
node tests/audio.test.mjs         # 响度表与 ffmpeg 校准
node tests/freedom.test.mjs       # 自由度回归（版式 / 角色 / 颗粒）
```

## 许可

MIT。第三方组件、字体与文档来源见 [`NOTICE.md`](NOTICE.md)；风格文档各自的出处记在 `skills/<name>/mise.json` 的 `repository` 字段里。
