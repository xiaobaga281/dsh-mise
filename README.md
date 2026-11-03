# Mise

**A film is a mise-en-scène.** Mise 是一个把「影片」写成网页、由代码渲染成 MP4 的 DSH 插件：构图、排版、动效、配乐、校验、渲染、交付都在插件内部完成，**不依赖任何外部 Studio、网页编辑器或视频模型**。

- 影片 = `film.html` + 一组镜头页（HTML），片段用 `at` / `#t=in,out` 排到时间轴上
- 渲染 = 插件自己的 `mise_render`：临时回环服务 + headless Chromium 逐帧驱动时钟 + ffmpeg 混流
- 配乐 = `film-score.mjs` 代码合成（拨弦 / 铺底 / 混响），卡点重音、段落和声、句子级闪避
- 校验 = `mise_check`（读 film.html 结构）+ `mise_verify`（抽帧量构图/运动）+ `mise_review`（逐镜批准）
- 交付 = `mise_deliver`（门禁 → 调色 → 响度 → 回执）

## 安装

插件就是一个目录，链接进 DSH 桌面 profile 即可：

```powershell
# 1. 放到任意位置，例如
#    C:\Users\<你>\.dsh\plugins\dsh-mise

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

自检：

```powershell
node tests/install-check.mjs      # 工具数 / 路由 / overlay 补丁可读
```

## 从 OpenFilm 迁移

旧 id 是 `@local/dsh-openfilm`，工具前缀 `openfilm_`，路由 `/openfilm/*`。2.x 起统一为：

| 旧 | 新 |
|---|---|
| `@local/dsh-openfilm` | `@local/dsh-mise` |
| `openfilm_*` | `mise_*` |
| `/openfilm/*` | `/mise/*` |
| vendored openfilm 运行时 | 无（渲染 / 抽帧 / 联系表 / 解析器均为自带） |

迁移时要同步改 profile 的 `dependencies`、`bundles` 与 junction 名。

## 工具

| 工具 | 用途 |
|---|---|
| `mise_new` / `mise_demo` / `mise_start` | 新建工程 / 端到端样例 / 环境引导 |
| `mise_plan` | 按类型配方出计划（镜头、节奏、配乐网格、调色） |
| `mise_compose` | **先量截图留白再定构图**（解码 PNG → 墨量网格 → 版位 / 遮罩 / 曝光） |
| `mise_promo` / `mise_promo_plan` | 产品宣传片语言与提案（读 README + facts.json） |
| `mise_render` | 渲染 MP4（自研，无 Studio）：默认 2× 超采样后降采样，可选 `motionBlur` 快门 |
| `mise_look` / `mise_thumbs` | 联系表 + 响度 / 分镜缩略图 |
| `mise_check` / `mise_verify` / `mise_review` | 结构校验 / 像素验收（含整片外观：调色板、影调、色度、异常镜头）/ 逐镜批准 |
| `mise_probe` | 单页体检：纯函数性（同 t 是否同帧）、对比度、溢出、字号、运动（平移/全局/主体 + 速度曲线）、细节分层；并按成文规范断言：标题安全区 90%（EBU R95）、4.5:1 / 3:1（WCAG 1.4.3）、单行 40 字（WCAG 1.4.8）、20 字/秒（Netflix TTSG） |
| `mise_deliver` / `mise_signoff` | 交付（门禁、调色、响度、回执）/ 人工签收 |
| `mise_score` / `mise_mix` / `mise_voice` | 配乐（母带 −18 LUFS / TP −1 dBTP，附切点对齐、速度与和声检查）/ 混音闪避 / 配音 |
| `mise_type` / `mise_graphics` / `mise_scene` / `mise_cine` | 排版页（可指定版式 / 母题 / 角色 / 色温）/ 图表页 / 场景页（可带字幕家具）/ 摄影感页面 |
| `mise_duo` / `mise_transition` | 呈现式转场 / 覆盖式转场 |
| `mise_depth` / `mise_interpolate` / `mise_pack` | 景深 / 插帧 / 可选增强包（SHA-256 校验） |
| `mise_run` / `mise_manual` | 命令入口（open / look / render / skills / skill / manual）/ 手册 |

## 侧栏面板

原生侧栏，苹果设计语言：大标题 + 分段控件（分镜 / 预览 / 设置）。分镜是**真实帧缩略图**时间轴，可改时长与顺序、直接渲染；预览是成片画面（没有画面时给出「画一帧」入口）；设置里是帧率、尺寸、响度与检查状态。

后端接口是 `/mise/*` 路由：`status`、`storyboard`、`run`、`file`、`check`、`progress`、`media`、`queue`、`library`、`credential`、`region-edit`、`speech`。

## 媒体生成（可选）

`mise_asset` / `mise_voice` 可以调用外部服务生成图片、视频、配音——**是辅助，不是主线**。任务拆成 创建 → 轮询 → 下载 → 完成，服务端任务 id 立刻落盘到 `.film/media-jobs/`，重试只查询同一任务，不会为同一请求二次付费；产物参数用 `ffprobe` 实测，不用请求值。

## 目录

```
plugin/
├── index.js               Host 入口：工具与 /mise/* 路由
├── client.js              侧栏面板（苹果风，分镜 / 预览 / 设置三段）
├── mise-render.mjs        自研渲染器
├── mise-look.mjs          联系表 / 缩略图 / 响度
├── mise-film-doc.mjs      film.html 解析与写回
├── film-*.mjs             能力模块（排版、图表、场景、配乐、混音、构图、校验、交付…）
├── skills/                11 个风格文档 + MANUAL（随插件分发）
├── vendor/motion/         of-motion.mjs（动效数学）+ mise-kit.mjs（页面侧基础能力：栅格 / 字阶 / 对比度 / 揭露 / 运镜 / 颗粒 / defineShot）
├── film-probe.mjs         单页体检（纯函数性 / 对比度 / 溢出 / 字号 / 运动 / 规范审计）
├── film-vision.mjs        画面描述（调色板 / 影调 / 色度 / 构图 / 地平线 / 细节分层），可对照参考图与整片自比
├── film-motion.mjs        运动测量（变化覆盖率 / 全局位移 / 速度曲线与缓动趋势）
├── locale/                en / zh 面板文案
├── scripts/sync.mjs       源码 → 安装目录完整镜像（哈希校验）
└── tests/                 全部套件（node 单文件可跑）
```

## 依赖

- Node（宿主自带运行时）
- `ffmpeg` / `ffprobe` 在 PATH 上（或设 `DSH_FFMPEG` / `DSH_FFPROBE`）
- `vendor/node_modules/playwright-core` + 本机 Chromium（`PLAYWRIGHT_BROWSERS_PATH`）

## 测试

```powershell
node scripts/run-tests.mjs        # 全部套件，逐文件报告
node tests/promo.test.mjs
node tests/promo-structure.test.mjs
node tests/compose.test.mjs
node tests/music.test.mjs
node tests/deliver.test.mjs
node tests/verify.test.mjs
```

## 许可

影片格式与风格文档沿用 OpenFilm（MIT）的格式约定；渲染、构图、配乐、校验、面板为本仓库实现。
