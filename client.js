window.__ModuleLoader__.load({
  id: '@local/dsh-mise',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PLUGIN_ID = '@local/dsh-mise';
    const NS = 'dsh-mise';

    /** How often the progress strip re-reads the Host's view of the agent. */
    const PROGRESS_INTERVAL_MS = 2000;
    /** How many finished steps the strip keeps visible. */
    const RECENT_LIMIT = 5;

    const dicts = {
      zh: {
        title: '影片',
        subtitle: 'Mise · 影片即调度',
        refresh: '刷新',
        loading: '正在读取影片状态…',
        loadFailed: '读取失败：',
        notInstalled: 'Mise 的渲染依赖缺失，工具不可用。',
    setup: '设置',
    addShot: '新增一镜',
    lastDelivery: '上一版交付',
    gatePassed: '门禁通过',
    gateBlocked: '门禁未过',
    noChanges: '这一版还没有可对比的改动记录。',
    noPreview: '还没有画面。先画一帧，看看片子长什么样。',
    drawStill: '画一帧',
        installed: '已安装',
        version: '版本',
        studio: 'Studio',
        studioNotRunning: 'Studio 未启动',
        openStudio: '打开 Studio',
        storyboard: '分镜',
        prevShot: '上一镜',
        nextShot: '下一镜',
        renderFilm: '渲染全片',
        moveEarlier: '前移',
        moveLater: '后移',
        shotChanged: '已更新分镜',
        render: '导出 MP4',
        rendering: '导出中…',
        look: '检查画面',
        looking: '检查中…',
        busy: '处理中…',
        duration: '时长',
        durationUnknown: '未知',
        inProject: '在影片工程中',
        notInProject: '不在影片工程中',
        projectPath: '工程路径',
        noProjectHint: '还没有影片工程，在对话里用 /video <描述> 建一个。',
        previewAlt: '影片画面',
        noPreview: '还没有画面 · 拍完后这里会显示影片',
        previewBroken: '画面读取失败 · 点刷新重试',
        tagSheet: '最新画面',
        tagVideo: '已导出',
        styles: '风格技能',
        stylesCount: '共 {n} 个',
        stylesHint: '在对话里说「做个发布会风格的片子」，或 /video <描述> --style=<name>',
        stylesEmpty: '没有可用的风格技能',
        outputLabel: '输出',
        status: '状态',
        ok: '完成',
        // 面板直出媒体
        mediaVoice: '配音',
        mediaImage: '图片',
        mediaVideo: '视频',
        mediaVoicePlaceholder: '要念的台词…',
        mediaPromptPlaceholder: '要生成的画面…（需对应服务商密钥）',
        mediaMake: '生成',
        mediaMaking: '生成中…',
        mediaProvider: '服务商',
        mediaModel: '模型',
        mediaRefs: '参考图/首帧',
        mediaRefsPlaceholder: '项目内图片路径，逗号分隔（如 assets/hero.png）',
        mediaAudio: '原生声音',
        mediaAudioHint: '只有支持声音的模型才有这个选项',
        providerNotConfigured: '未配置密钥',
        queueQueued: '已加入队列',
        cancel: '取消',
        regionSelect: '框选修改',
        regionCancel: '退出框选',
        regionHint: '在画面上拖一个框，标出要改的地方',
        regionHint2: '只改框里的内容，其它物体和构图保持原样；提交后 Agent 直接改，Studio 实时显示。',
        regionTitle: '框选区域：想要改成什么？',
        regionPlaceholder: '例如：把这块的颜色改成暖橙，别动其它地方',
        regionSubmit: '交给 Agent',
        regionSending: '提交中…',
        // 时间线
        timelineToggle: '影片时间线',
        // 后台队列
        queuePending: '后台任务进行中，完成后文件出现在 assets/',
        // 实时进度
        progress: '实时进度',
        working: '正在做',
        noActivity: '还没有影片活动，在对话里试试 /video <描述>',
        steps: '最近步骤',
        idle: '空闲',
        stepOk: '完成',
        stepError: '失败',
        stepRunning: '进行中',
        hideOutput: '收起输出',
        showOutput: '查看输出',
        // 服务商密钥
        providers: '服务商密钥',
        providersHint: '配音、音乐、音效、图片等媒体要靠这些服务生成。不配也能做片——画面是网页画的；配了才有自动配音和配乐。',
        providersNone: '还没有可配置的服务商。',
        capVoice: '配音',
        capSfx: '音效',
        capMusic: '音乐',
        capTranscript: '转写',
        capImage: '图片',
        capVideo: '视频',
        capSubtitle: '字幕翻译',
        capStock: '图库照片',
        capSearch: '网页搜索',
        providerConfigured: '已配置',
        providerRemove: '移除',
        providerRemoveConfirm: '再点一次确认移除',
        providerSave: '保存',
        providerSaving: '保存中…',
        providerInputPlaceholder: '粘贴 API 密钥',
        providerKeySaved: '已保存',
        providerKeyRemoved: '已移除',
        providerSaveFailed: '保存失败：',
        providerStoreNote: '密钥存进 DSH 统一凭据库，只保存在本机，重启后依然有效。',
        studioOpenLink: '打开 Studio 编辑器',
        projects: '影片工程',
        sessionLabel: '会话',
        library: '影视集',
        librarySearch: '搜索影片…',
        librarySort: '排序',
        sortUpdated: '最新生成',
        sortOldest: '最早生成',
        sortName: '名称',
        sortSize: '文件大小',
        libraryEmpty: '还没有导出的影片',
        libraryExpand: '展开影视集',
        libraryCollapse: '收起影视集',
      },
      en: {
        title: 'Film',
        subtitle: 'Mise · a film is a mise-en-scène',
        refresh: 'Refresh',
        loading: 'Loading film status…',
        loadFailed: 'Failed to load: ',
        notInstalled: 'Mise is missing its render dependencies; the tools are unavailable.',
    setup: 'Setup',
    addShot: 'Add shot',
    lastDelivery: 'Last delivery',
    gatePassed: 'Gate passed',
    gateBlocked: 'Gate blocked',
    noChanges: 'No change record for this version yet.',
    noPreview: 'Nothing drawn yet. Take a still and see what the film looks like.',
    drawStill: 'Draw a still',
        installed: 'Installed',
        version: 'Version',
        studio: 'Studio',
        studioNotRunning: 'Studio is not running',
        openStudio: 'Open Studio',
        storyboard: 'Shots',
        prevShot: 'Previous shot',
        nextShot: 'Next shot',
        renderFilm: 'Render film',
        moveEarlier: 'Move earlier',
        moveLater: 'Move later',
        shotChanged: 'Storyboard updated',
        render: 'Export MP4',
        rendering: 'Rendering…',
        look: 'Check frames',
        looking: 'Checking…',
        busy: 'Working…',
        duration: 'Duration',
        durationUnknown: 'unknown',
        inProject: 'in a film project',
        notInProject: 'not a film project',
        projectPath: 'Project path',
        noProjectHint: 'No film project yet — create one with /video <description>.',
        previewAlt: 'Film preview',
        noPreview: 'No picture yet — the film appears here once it is checked',
        previewBroken: 'Could not load the picture — refresh to retry',
        tagSheet: 'Latest frame',
        tagVideo: 'Exported',
        styles: 'Style skills',
        stylesCount: '{n} available',
        stylesHint: 'Ask in chat (“make a keynote-style film”), or /video <description> --style=<name>',
        stylesEmpty: 'No style skills available',
        outputLabel: 'Output',
        status: 'Status',
        ok: 'done',
        // Media direct
        mediaVoice: 'Voice',
        mediaImage: 'Image',
        mediaVideo: 'Video',
        mediaVoicePlaceholder: 'The line to speak…',
        mediaPromptPlaceholder: 'The picture to generate… (needs that service\'s key)',
        mediaMake: 'Make',
        mediaMaking: 'Making…',
        mediaProvider: 'Service',
        mediaModel: 'Model',
        mediaRefs: 'References / first frame',
        mediaRefsPlaceholder: 'Project picture paths, comma separated (e.g. assets/hero.png)',
        mediaAudio: 'Native sound',
        mediaAudioHint: 'Only models that generate sound offer this',
        providerNotConfigured: 'no key',
        queueQueued: 'queued',
        cancel: 'Cancel',
        regionSelect: 'Mark a region',
        regionCancel: 'Stop marking',
        regionHint: 'Drag a box on the picture to mark what should change',
        regionHint2: 'Only the marked area changes; the rest of the picture stays as it is. The agent edits it and Studio shows it live.',
        regionTitle: 'Marked region: what should it become?',
        regionPlaceholder: 'e.g. make this area warm orange, leave everything else alone',
        regionSubmit: 'Send to agent',
        regionSending: 'Sending…',
        // Timeline
        timelineToggle: 'Film timeline',
        // Queue
        queuePending: 'Background jobs running; files land in assets/ when done',
        // Live progress
        progress: 'Live progress',
        working: 'Working on',
        noActivity: 'No film activity yet — try /video <description> in chat',
        steps: 'Recent steps',
        idle: 'idle',
        stepOk: 'done',
        stepError: 'failed',
        stepRunning: 'running',
        hideOutput: 'Hide output',
        showOutput: 'Show output',
        // Provider keys
        providers: 'Provider keys',
        providersHint: 'Voice, music, sound effects and images come from these services. A film can be made without any of them — the picture is drawn by the browser — but not with generated voice or music.',
        providersNone: 'No configurable providers reported.',
        capVoice: 'voice',
        capSfx: 'SFX',
        capMusic: 'music',
        capTranscript: 'transcripts',
        capImage: 'images',
        capVideo: 'video',
        capSubtitle: 'subtitles',
        capStock: 'stock photos',
        capSearch: 'web search',
        providerConfigured: 'configured',
        providerRemove: 'Remove',
        providerRemoveConfirm: 'Click again to confirm',
        providerSave: 'Save',
        providerSaving: 'Saving…',
        providerInputPlaceholder: 'Paste API key',
        providerKeySaved: 'Saved',
        providerKeyRemoved: 'Removed',
        providerSaveFailed: 'Save failed: ',
        providerStoreNote: 'Keys go into the shared DSH credential store, stay on this machine, and survive a restart.',
        studioOpenLink: 'Open Studio editor',
        projects: 'Film projects',
        sessionLabel: 'session',
        library: 'Film library',
        librarySearch: 'Search films…',
        librarySort: 'Sort',
        sortUpdated: 'Newest',
        sortOldest: 'Oldest',
        sortName: 'Name',
        sortSize: 'File size',
        libraryEmpty: 'No exported films yet',
        libraryExpand: 'Expand film library',
        libraryCollapse: 'Collapse film library',
      },
    };

const css = `
.of-dock {
  display: flex; flex-direction: column; gap: 10px;
  box-sizing: border-box;
  width: 100%; max-width: 100%; min-width: 0;
  padding: 14px 18px 16px; margin: 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  /* Horizontal clipping stays: no child may widen the app frame (that defect
     pushed the refresh button off-screen). The panel takes the full height the
     main column gives it and scrolls when its own content is taller — no
     arbitrary max-height of its own, which only ever left the bottom of the
     column empty while the panel hid content behind a scrollbar of its own. */
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  height: 100%;
}
/* A thin, theme-aware scrollbar: the default one reads as a browser artifact
   inside a panel. */
.of-dock::-webkit-scrollbar { width: 8px; }
.of-dock::-webkit-scrollbar-track { background: transparent; }
.of-dock::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l2);
  border-radius: 4px;
}
.of-dock::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-label-secondary); }
/* No child may claim more than the panel's own width. */
.of-dock > * { min-width: 0; max-width: 100%; box-sizing: border-box; flex: none; }

/* Two columns when there is room, one column when there is not. The split
   point is a container query on the panel's own width, not a media query on
   the window: the panel's width is what changes, the window's is not its
   business. */
.of-body { display: flex; flex-direction: row; flex-wrap: wrap; gap: 14px; container-type: inline-size; }
.of-col-preview { flex: 1 1 320px; min-width: 0; max-width: 100%; display: flex; flex-direction: column; gap: 10px; }
.of-col-side { flex: 1 1 380px; min-width: 0; max-width: 100%; display: flex; flex-direction: column; gap: 10px; }

.of-dock-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.of-dock-title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; min-width: 0; }
.of-dock-title > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.of-dock-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }

/* The storyboard: one chip per shot, scrolling sideways like a real timeline.
   It replaces the separate Studio: the shots, the picture and the render button
   are in the same column now. */
.of-board { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.of-board-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.of-board-sub { opacity: 0.7; }
.of-board-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.of-shot { flex: 0 0 auto; display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
  padding: 5px 8px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,.14));
  background: transparent; color: inherit; cursor: pointer; min-width: 58px; text-align: left; }
.of-shot:hover { border-color: var(--dsw-alias-brand-primary); }
.of-shot-active { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.of-shot-i { font-size: 10px; opacity: 0.55; font-variant-numeric: tabular-nums; }
.of-shot-k { font-size: 11px; font-weight: 600; }
.of-shot-t { font-size: 10px; opacity: 0.65; font-variant-numeric: tabular-nums; }
.of-shot-m { position: absolute; } /* the moving-shot dot is a title, kept out of line */
.of-board-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.of-board-edit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.of-board-edit-name { font-variant-numeric: tabular-nums; opacity: 0.8; }

/* The picture the panel exists to show. A fixed-height frame, not a ratio:
   absolute children and an explicit height cannot be stretched by a broken
   image the way aspect-ratio plus auto height can. */
/* The preview frame keeps the film's own shape instead of a fixed height: a
   180px-tall box in a wide column crops a 16:9 picture into a letterbox slice.
   The height follows the width, and the width is capped so the preview cannot
   crowd out the controls below it. The ratio is the panel's layout choice; the
   picture itself is always the film's, whatever size that film declares. */
.of-preview {
  position: relative; aspect-ratio: 16 / 9;
  width: 100%; max-width: 100%;
  max-height: 42vh; flex: none;
  border-radius: 10px; overflow: hidden;
  background: #000;
  border: 1px solid var(--dsw-alias-border-l1);
}
/* object-fit: contain, not cover: the whole film must be visible. Cover fills
   the box by cropping the sides, which is exactly the defect being fixed. */
.of-preview > img, .of-preview > video {
  position: absolute; inset: 0; display: block;
  width: 100%; height: 100%; object-fit: contain; background: #000;
}
.of-preview-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--dsw-alias-label-secondary); text-align: center; padding: 12px;
}
.of-preview-tag {
  position: absolute; left: 8px; bottom: 8px;
  font-size: 10px; letter-spacing: .4px; padding: 2px 7px; border-radius: 6px;
  background: rgba(0, 0, 0, .62); color: #fff;
}
/* Marking a region: the layer takes the pointer only while marking, so the
   player's own controls and scrubbing keep working. */
.of-region-layer { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.of-region-layer.of-region-on { pointer-events: auto; cursor: crosshair; }
.of-region-box { position: absolute; border: 1.5px solid var(--dsw-alias-brand-primary); background: rgba(255,255,255,.06); box-shadow: 0 0 0 9999px rgba(0,0,0,.3); }
.of-region-hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,.34); color: #fff; font-size: 12px; pointer-events: none; text-align: center; padding: 0 16px; }
.of-region-toggle { position: absolute; right: 8px; top: 8px; z-index: 4; height: 24px; padding: 0 9px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: rgba(0,0,0,.55);
  color: #fff; font-size: 11px; cursor: pointer; white-space: nowrap; }
.of-region-toggle-on { border-color: var(--dsw-alias-brand-primary); background: rgba(0,0,0,.75); }
.of-region-form { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.of-region-form-title { font-size: 11px; font-weight: 600; }
.of-region-text { width: 100%; box-sizing: border-box; resize: vertical; min-height: 48px; padding: 6px 8px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); font: 12px/1.5 inherit; }
.of-region-actions { display: flex; gap: 6px; }

.of-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.of-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); min-width: 0; }
.of-current { display: flex; align-items: center; gap: 8px; font-size: 12px; min-width: 0; }
.of-current-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.of-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.of-dot-live { background: var(--dsw-alias-brand-primary); animation: of-pulse 1.2s ease-in-out infinite; }
.of-dot-warn { background: var(--dsw-alias-state-warn-primary); }
.of-dot-error { background: var(--dsw-alias-state-error-primary); }
@keyframes of-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .35; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) { .of-dot-live { animation: none; } }

.of-steps { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.of-step { display: flex; align-items: baseline; gap: 8px; font-size: 11px; min-width: 0; }
.of-step-name { flex: none; font-family: ui-monospace, Consolas, monospace; }
.of-step-args { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.of-step-time { flex: none; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.of-step-session { flex: none; font-size: 10px; color: var(--dsw-alias-label-secondary); opacity: .75; }
.of-tone-ok { color: var(--dsw-alias-state-success-primary); }
.of-tone-warn { color: var(--dsw-alias-state-warn-primary); }
.of-tone-error { color: var(--dsw-alias-state-error-primary); }
.of-tone-running { color: var(--dsw-alias-label-primary); }

.of-btn { height: 26px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer; white-space: nowrap; }
.of-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.of-btn:disabled { opacity: .45; cursor: default; }
.of-btn-primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.of-btn-small { height: 22px; padding: 0 7px; font-size: 10px; }
.of-btn-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); background: none; }
.of-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.of-library { position: relative; width: 100%; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.of-library-open { z-index: 40; overflow: visible; }
.of-library-head { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 30px; padding: 0 9px; border: 0; background: none; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.of-library-title { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; }
.of-library-count { margin-left: auto; color: var(--dsw-alias-label-secondary); font: 10px ui-monospace, Consolas, monospace; }
.of-library-chevron { width: 12px; color: var(--dsw-alias-label-secondary); font-size: 10px; text-align: center; }
.of-library-body { padding: 7px; border-top: 1px solid var(--dsw-alias-border-l1); }
.of-library-tools { display: flex; gap: 5px; margin-bottom: 7px; }
.of-library-search { min-width: 0; flex: 1; height: 25px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 10px; }
.of-library-sort-select { position: relative; z-index: 66; width: 104px; }
.of-library-sort-select .of-select-trigger { width: 100%; justify-content: space-between; height: 25px; font-size: 10px; padding: 0 7px; }
.of-library-sort-menu { right: 0; left: auto; min-width: 104px; }
/* The library is a stack of rendered films. Collapsed, the cards sit on top of
   one another like a pile of prints and only their top edges show; pressing the
   pile fans it out into a readable list, and pressing one card plays that film.
   Two steps on purpose: the pile is what says "there are films here", the fan is
   what lets a person pick without the panel always taking vertical space. */
.of-library-stack { position: relative; display: flex; flex-direction: column; gap: 0; max-height: 236px; overflow-y: auto; }
.of-library-pile { position: relative; min-height: calc(34px + (var(--of-pile-count, 1) - 1) * 15px); }
.of-library-card { position: relative; display: flex; align-items: center; gap: 7px; width: 100%; min-height: 34px; padding: 5px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; box-shadow: 0 2px 6px rgba(0,0,0,.28); }
/* The pile: every card after the first is pushed down a sliver and inset, so the
   top edges read as one stack instead of a list of rows. */
/* The pile: each card is pushed down a sliver and inset slightly, so the stack
   reads as a pile of prints. The newest film sits on top (index 0 is highest),
   which is also the one a person most likely wants. */
.of-library-pile .of-library-card { position: absolute; left: calc(var(--of-stack-index, 0) * 4px); right: calc(var(--of-stack-index, 0) * 4px); top: calc(var(--of-stack-index, 0) * 15px); width: auto; z-index: calc(50 - var(--of-stack-index, 0)); transition: top .18s cubic-bezier(.2,.8,.2,1), left .18s cubic-bezier(.2,.8,.2,1), right .18s cubic-bezier(.2,.8,.2,1), box-shadow .18s ease, background-color .18s ease; }
.of-library-pile .of-library-card .of-library-card-copy { opacity: .92; }
.of-library-fanned { display: flex; flex-direction: column; gap: 4px; max-height: 236px; overflow-y: auto; }
.of-library-fanned .of-library-card { width: 100%; }
.of-library-card:hover, .of-library-card-picked { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2)); }
.of-library-card-mark { display: inline-flex; color: var(--dsw-alias-brand-primary); }
/* The poster keeps the film's own shape: the frame is 16:9 on the cards by
   aspect-ratio, not by a guessed number, so a 9:16 film simply shows taller. */
.of-library-card-poster { position: relative; flex: none; width: 62px; aspect-ratio: 16 / 9; border-radius: 5px; overflow: hidden; background: #000; display: flex; align-items: center; justify-content: center; }
.of-library-card-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
.of-library-card-poster .of-icon { color: var(--dsw-alias-label-secondary); opacity: .8; }
/* In the pile only the top strip of each poster shows, which is what makes the
   pile read as stacked prints rather than rows. */
.of-library-pile .of-library-card-poster { width: 54px; }
/* Only the top card of the pile reads as a card: the ones under it are edges,
   so the stack looks like prints instead of four overlapping rows of text. */
.of-library-pile .of-library-card:not(:first-child) .of-library-card-copy,
.of-library-pile .of-library-card:not(:first-child) .of-library-card-play { visibility: hidden; }
/* Hovering a card in the pile brings that film to the top of the stack: it is
   raised above every other card and shows its name. It does NOT move: a card
   that slid out from under the pointer would hand the hover to its neighbour,
   and the two would swap forever (the flicker this replaced). The effect is
   pure CSS on :hover, so it works even where a React pointer handler does not
   reach; the class is kept for keyboard focus, which has no :hover. */
.of-library-pile .of-library-card:hover,
.of-library-pile .of-library-card.of-library-card-raised,
.of-library-pile .of-library-card:focus-visible {
  z-index: 61;
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 8px 20px rgba(0,0,0,.45);
}
.of-library-pile .of-library-card:hover .of-library-card-copy,
.of-library-pile .of-library-card:hover .of-library-card-play,
.of-library-pile .of-library-card.of-library-card-raised .of-library-card-copy,
.of-library-pile .of-library-card.of-library-card-raised .of-library-card-play,
.of-library-pile .of-library-card:focus-visible .of-library-card-copy,
.of-library-pile .of-library-card:focus-visible .of-library-card-play { visibility: visible; }
.of-library-card-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; gap: 2px; }
.of-library-card-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; }
.of-library-card-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.of-library-card-play { color: var(--dsw-alias-brand-primary); font-size: 14px; }
.of-library-pile-hint { position: absolute; right: 8px; bottom: 4px; font-size: 9px; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.of-library-collapse { align-self: flex-start; margin-bottom: 2px; padding: 2px 6px; border: 0; background: none; color: var(--dsw-alias-label-secondary); font-size: 9px; cursor: pointer; }
.of-library-collapse:hover { color: var(--dsw-alias-label-primary); }
.of-library-empty { padding: 14px 6px; color: var(--dsw-alias-label-secondary); font-size: 10px; text-align: center; }

.of-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: 0; padding: 0; color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer; }

/* Style-skill chips and the project switcher share a wrap-and-clip row. */
.of-styles { display: flex; flex-wrap: wrap; gap: 4px; }
.of-style { font-size: 10px; line-height: 16px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, Consolas, monospace; white-space: nowrap; }
.of-projects { display: flex; flex-wrap: wrap; gap: 4px; }
.of-project { font-size: 10px; line-height: 18px; padding: 0 8px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l1); background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.of-project:hover { background: var(--dsw-alias-bg-layer-2); }
.of-project-active { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }

.of-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.of-path { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary); word-break: break-all; min-width: 0; max-width: 100%; }
.of-badge { display: inline-flex; align-items: center; font-size: 11px; padding: 0 6px; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.of-badge-ok { color: var(--dsw-alias-state-success-primary); border-color: var(--dsw-alias-state-success-primary); }
.of-badge-warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.of-studio-link { font-size: 11px; color: var(--dsw-alias-brand-primary); word-break: break-all; }

/* Media direct from the panel: one row for the prompt, one for the kind, and
   the made asset as a result line. Same implementation as the tools. */
.of-media-row { display: flex; gap: 6px; align-items: center; min-width: 0; }
.of-media-input { flex: 1 1 200px; min-width: 0; box-sizing: border-box; height: 26px; padding: 0 9px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11px; }
.of-media-input::placeholder { color: var(--dsw-alias-label-secondary); }
.of-media-kind { flex: none; height: 26px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11px; padding: 0 4px; }

/* The custom kind picker: a trigger button and a themed menu, replacing the
   native select whose popup the page cannot style. */
.of-select { position: relative; flex: none; }
.of-select-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 8px;
  border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 11px; cursor: pointer; white-space: nowrap;
}
.of-select-trigger:hover { border-color: var(--dsw-alias-border-l2); }
.of-select-open { border-color: var(--dsw-alias-brand-primary); }
.of-select-caret { font-size: 8px; color: var(--dsw-alias-label-secondary); line-height: 1; }
.of-select-menu {
  position: absolute; left: 0; top: calc(100% + 4px); z-index: 70;
  min-width: 100%; padding: 4px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  display: flex; flex-direction: column; gap: 2px;
}
.of-select-item {
  text-align: left; padding: 5px 10px; border: 0; border-radius: 5px;
  background: none; color: var(--dsw-alias-label-secondary);
  font-size: 11px; cursor: pointer; white-space: nowrap;
}
.of-select-item:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.of-select-active { color: var(--dsw-alias-label-primary); }
.of-select-active::before { content: '●'; font-size: 7px; margin-right: 5px; vertical-align: 1px; color: var(--dsw-alias-brand-primary); }

/* The film as a timeline: one row per track, one cell per clip, positioned by
   the clip's own at and length against the film's total. Read-only: editing
   stays in Studio. */
.of-timeline { display: flex; flex-direction: column; gap: 4px; }
.of-tl-track { display: flex; gap: 2px; height: 22px; min-width: 0; }
.of-tl-clip {
  position: relative; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 9px; line-height: 22px; padding: 0 5px;
  border-radius: 4px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  box-sizing: border-box;
}
.of-tl-page { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.of-tl-sound { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, var(--dsw-alias-bg-layer-2)); }
.of-tl-gap { background: none; border-style: dashed; opacity: 0.4; }
.of-tl-clip:hover { filter: brightness(1.15); }
.of-tl-scale { display: flex; justify-content: space-between; font-size: 9px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, Consolas, monospace; }

/* Background asset jobs (video against a busy queue). */
.of-queue { display: flex; flex-direction: column; gap: 3px; }
.of-queue-row { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--dsw-alias-label-secondary); min-width: 0; }
.of-queue-prompt { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Provider rows: name, what it makes, state, and the key field when unset.
   The list scrolls on its own once opened: ten providers (plus a voice row)
   would otherwise push the controls below out of the panel's view. */
.of-providers { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
.of-providers::-webkit-scrollbar { width: 6px; }
.of-providers::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 3px; }
.of-provider { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 11px; }
.of-provider-name { font-family: ui-monospace, Consolas, monospace; flex: none; }
.of-provider-caps { flex: 1 1 110px; min-width: 0; color: var(--dsw-alias-label-secondary); }
.of-provider-key { flex: 1 1 150px; min-width: 0; box-sizing: border-box; height: 22px; padding: 0 7px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 11px; }
.of-provider-key::placeholder { color: var(--dsw-alias-label-secondary); }

.of-output { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-word; max-height: 110px; overflow: auto; margin: 0; }
.of-status-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.of-status-ok { font-size: 11px; color: var(--dsw-alias-state-success-primary); }
.of-icon { flex: none; display: block; }

/* ─────────────────────────────────────────────────────────────────────────────
   Mise · Apple-style layer

   Rules of the design:
   - one type scale (11 / 13 / 15 / 22) with tight tracking on the large end;
   - inset grouped cards on a quiet background, 14px radius;
   - list rows 44px tall with hairline separators, last row without one;
   - pill controls 30px tall, active state = fill, press = 0.97 scale;
   - one blue (system blue) for the only primary action;
   - motion settles: 220ms cubic-bezier(0.32, 0.72, 0, 1), never bounces.
   ───────────────────────────────────────────────────────────────────────────── */

.of-dock {
  --mise-fill: color-mix(in srgb, currentColor 8%, transparent);
  --mise-fill-strong: color-mix(in srgb, currentColor 14%, transparent);
  --mise-hairline: color-mix(in srgb, currentColor 16%, transparent);
  --mise-hairline-soft: color-mix(in srgb, currentColor 12%, transparent);
  --mise-blue: #0a84ff;
  --mise-green: #30d158;
  --mise-red: #ff453a;
  --mise-radius: 14px;
  --mise-radius-sm: 10px;
  --mise-pill: 980px;
  --mise-ease: cubic-bezier(0.32, 0.72, 0, 1);
  font-family: -apple-system, "SF Pro Text", "SF Pro Display", "Segoe UI Variable Text",
    "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.006em;
  gap: 16px;
  padding: 20px 16px 24px;
  border-bottom: 0;
  background: transparent;
}

/* ── large title header ───────────────────────────────────────────────────── */
.of-dock-head { align-items: flex-start; }
.of-dock-title {
  display: grid;
  grid-template-columns: 24px auto;
  grid-template-rows: auto auto;
  column-gap: 8px;
  row-gap: 3px;
  align-items: center;
  min-width: 0;
}
.of-dock-title > svg {
  grid-row: 1; grid-column: 1;
  width: 22px; height: 22px;
  color: var(--mise-blue);
}
.of-dock-title > span:first-of-type {
  grid-row: 1; grid-column: 2;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.028em;
  line-height: 1.1;
}
.of-dock-title > .of-dock-sub {
  grid-row: 2; grid-column: 1 / -1;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in srgb, currentColor 50%, transparent);
  white-space: normal;
}

/* ── inset grouped cards ──────────────────────────────────────────────────── */
.of-card {
  background: var(--mise-fill);
  border: 0;
  border-radius: var(--mise-radius);
  padding: 4px 14px;
  gap: 0;
  box-shadow: inset 0 0 0 0.5px var(--mise-hairline-soft);
}
.of-card > .of-toggle {
  min-height: 44px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  padding: 0;
  color: color-mix(in srgb, currentColor 92%, transparent);
}
.of-card > .of-card,
.of-card > .of-row:first-of-type { border-top: 1px solid var(--mise-hairline-soft); }

/* list rows */
.of-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  font-size: 15px;
  border-bottom: 1px solid var(--mise-hairline-soft);
}
.of-row:last-child { border-bottom: 0; }
.of-row > span:first-child { color: color-mix(in srgb, currentColor 90%, transparent); }

/* ── pill controls ────────────────────────────────────────────────────────── */
.of-btn {
  appearance: none;
  border: 0;
  border-radius: var(--mise-pill);
  background: var(--mise-fill-strong);
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  min-height: 30px;
  padding: 0 14px;
  cursor: pointer;
  transition: transform 220ms var(--mise-ease), background-color 140ms var(--mise-ease),
    opacity 140ms var(--mise-ease);
}
.of-btn:hover { background: color-mix(in srgb, currentColor 20%, transparent); }
.of-btn:active { transform: scale(0.97); }
.of-btn:disabled { opacity: 0.35; cursor: default; transform: none; }
.of-btn.of-primary { background: var(--mise-blue); color: #fff; }
.of-btn.of-primary:hover { background: color-mix(in srgb, var(--mise-blue) 86%, #fff); }
.of-btn.of-quiet { background: transparent; color: var(--mise-blue); }

.of-toggle {
  appearance: none; border: 0; background: transparent; color: inherit;
  font: inherit; cursor: pointer; width: 100%;
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.of-toggle > span:last-child {
  font-size: 17px; font-weight: 400; line-height: 1;
  color: color-mix(in srgb, currentColor 42%, transparent);
}

/* ── shot strip ───────────────────────────────────────────────────────────── */
.of-board { gap: 8px; }
.of-board-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: color-mix(in srgb, currentColor 50%, transparent);
}
.of-board-sub { letter-spacing: 0.01em; text-transform: none; color: color-mix(in srgb, currentColor 40%, transparent); }
.of-board-strip { gap: 6px; padding: 1px 0 6px; scrollbar-width: none;
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent 100%);
  mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent 100%); }
.of-board-strip::-webkit-scrollbar { display: none; }
.of-shot {
  min-width: 64px;
  padding: 8px 10px 7px;
  border: 0;
  border-radius: var(--mise-radius-sm);
  background: var(--mise-fill);
  color: inherit;
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  transition: transform 220ms var(--mise-ease), background-color 160ms var(--mise-ease);
}
.of-shot:hover { background: var(--mise-fill-strong); }
.of-shot:active { transform: scale(0.97); }
.of-shot-active { background: var(--mise-blue); color: #fff; }
.of-shot-active .of-shot-k { color: color-mix(in srgb, #fff 78%, transparent); }
/* A shot with a still becomes the picture: labels are laid over the frame. */
.of-shot-has { position: relative; overflow: hidden; width: 116px; height: 66px; padding: 0;
  justify-content: flex-end; align-items: stretch; }
.of-shot-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; }
.of-shot-has::after { content: ''; position: absolute; inset: 0; z-index: 1;
  background:
    linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.86) 100%); }
.of-shot-active.of-shot-has::after {
  background:
    linear-gradient(180deg, rgba(10,132,255,0.55) 0%, rgba(10,132,255,0.20) 40%, rgba(0,40,90,0.86) 100%); }
.of-shot-has > span { position: relative; z-index: 2; color: #fff; padding: 0 8px; }
.of-shot-has .of-shot-i { position: absolute; top: 4px; left: 8px; font-size: 12px; letter-spacing: 0.04em; opacity: 0.92; }
.of-shot-has .of-shot-k { text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
.of-shot-has .of-shot-t { padding-bottom: 6px; opacity: 0.85; text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
/* Segmented control: one track, one raised pill, instant read. */
.of-seg { display: flex; gap: 2px; padding: 2px; border-radius: 9px;
  background: color-mix(in srgb, currentColor 10%, transparent); }
/* Three sections, one column: the segments switch what is showing rather than
   stacking everything a person might need. */
.of-dock[data-tab="film"] .of-sec-look, .of-dock[data-tab="film"] .of-sec-setup,
.of-dock[data-tab="look"] .of-sec-film, .of-dock[data-tab="look"] .of-sec-setup,
.of-dock[data-tab="setup"] .of-sec-film, .of-dock[data-tab="setup"] .of-sec-look { display: none; }
.of-seg-item { appearance: none; border: 0; flex: 1 1 0; min-height: 28px; border-radius: 7px;
  background: transparent; color: color-mix(in srgb, currentColor 70%, transparent);
  font: inherit; font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em; cursor: pointer;
  transition: background-color 180ms var(--mise-ease), color 180ms var(--mise-ease); }
.of-seg-item:hover { color: color-mix(in srgb, currentColor 88%, transparent); }
.of-seg-on { background: color-mix(in srgb, currentColor 20%, transparent); color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.16); }
.of-board-strip-actions { margin-bottom: 4px; }
.of-shot-add { align-items: center; justify-content: center; width: 96px; height: 66px; gap: 4px;
  background: transparent; border: 1.5px dashed color-mix(in srgb, currentColor 30%, transparent);
  color: color-mix(in srgb, currentColor 60%, transparent); }
.of-shot-add:hover { background: color-mix(in srgb, currentColor 8%, transparent);
  border-color: color-mix(in srgb, var(--mise-blue) 60%, transparent); color: var(--mise-blue); }
.of-shot-add:disabled { opacity: 0.4; }
.of-shot-add-mark { font-size: 22px; line-height: 1; }
.of-shot-i { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.of-shot-k {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: color-mix(in srgb, currentColor 55%, transparent);
}
.of-board-actions { gap: 6px; }
.of-board-edit { font-size: 12px; gap: 6px; color: color-mix(in srgb, currentColor 55%, transparent); }
.of-board-edit-name { font-weight: 600; font-variant-numeric: tabular-nums; color: color-mix(in srgb, currentColor 80%, transparent); }

/* ── preview surface ──────────────────────────────────────────────────────── */
.of-preview, .of-frame {
  border-radius: var(--mise-radius);
  overflow: hidden;
  background: color-mix(in srgb, currentColor 12%, transparent);
  box-shadow: inset 0 0 0 0.5px var(--mise-hairline-soft);
}

/* ── status, hints, output ────────────────────────────────────────────────── */
.of-preview-empty { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 20px;
  color: color-mix(in srgb, currentColor 55%, transparent); }
.of-empty-mark { font-size: 30px; line-height: 1; color: color-mix(in srgb, currentColor 30%, transparent); }
.of-empty-line { font-size: 12.5px; max-width: 240px; line-height: 1.45; }
.of-compare-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 15px; font-weight: 600; min-height: 32px; }
.of-compare-file { font-size: 11.5px; color: color-mix(in srgb, currentColor 50%, transparent);
  font-variant-numeric: tabular-nums; }
.of-compare-meta { display: flex; gap: 6px; flex-wrap: wrap; padding-bottom: 6px; }
.of-chip-warn { color: color-mix(in srgb, var(--mise-red) 80%, currentColor);
  background: color-mix(in srgb, var(--mise-red) 14%, transparent); }
.of-compare-list { display: flex; flex-direction: column; }
.of-compare-row { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center;
  width: 100%; min-height: 34px; font: inherit; font-size: 13px; text-align: left;
  background: transparent; border: 0; border-top: 1px solid var(--mise-hairline-soft);
  color: inherit; cursor: pointer; padding: 0;
  transition: background-color 140ms var(--mise-ease); }
.of-compare-row:hover:not(:disabled) { background: color-mix(in srgb, currentColor 6%, transparent); }
.of-compare-row:disabled { opacity: 0.45; cursor: default; }
.of-compare-row:active:not(:disabled) { transform: scale(0.995); }
.of-compare-shot { color: color-mix(in srgb, currentColor 90%, transparent); }
.of-compare-at { font-size: 11.5px; color: color-mix(in srgb, currentColor 45%, transparent);
  font-variant-numeric: tabular-nums; }
.of-compare-pct { font-size: 12px; font-weight: 600; color: var(--mise-blue);
  font-variant-numeric: tabular-nums; }
.of-hint { font-size: 12px; line-height: 1.5; color: color-mix(in srgb, currentColor 46%, transparent); }
.of-status-ok, .of-status-error, .of-output {
  font-size: 12px; line-height: 1.5; border-radius: var(--mise-radius-sm); padding: 9px 12px;
}
.of-status-ok { color: color-mix(in srgb, var(--mise-green) 62%, currentColor);
  background: color-mix(in srgb, var(--mise-green) 13%, transparent); }
.of-status-error { color: color-mix(in srgb, var(--mise-red) 74%, currentColor);
  background: color-mix(in srgb, var(--mise-red) 13%, transparent); }
.of-output {
  font-family: "SF Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  font-size: 11.5px; white-space: pre-wrap; word-break: break-word;
}

/* ── chips ────────────────────────────────────────────────────────────────── */
.of-style, .of-chip {
  font-size: 12px; font-weight: 500; padding: 4px 10px; border-radius: var(--mise-pill);
  background: var(--mise-fill-strong); color: color-mix(in srgb, currentColor 78%, transparent);
}
.of-styles { display: flex; flex-wrap: wrap; gap: 6px; }

/* ── focus ────────────────────────────────────────────────────────────────── */
.of-dock button:focus-visible,
.of-dock input:focus-visible,
.of-dock select:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--mise-blue) 45%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .of-dock *, .of-dock *::before, .of-dock *::after {
    transition-duration: 1ms !important; animation-duration: 1ms !important;
  }
}

`;

    /**
     * Resolve a Host route against the document base. The query string is kept:
     * the preview route carries the file it serves there, and the project
     * switcher travels on it too, so dropping it would empty both.
     * @param {string} routePath
     * @returns {string}
     */
    function apiUrl(routePath) {
      if (typeof document === 'undefined') return routePath;
      const url = new URL(routePath, document.baseURI);
      // A token in the fragment would never reach the Host; drop it.
      url.hash = '';
      return url.pathname + url.search;
    }

    /**
     * Read one Host answer. A 401 here is not a bug in the plugin: DSH signs a
     * per-authority cookie, so when the app restarts on another port the page
     * that is already open still holds the old one. Reload the page once to
     * pick up the new authorisation instead of leaving a dead panel behind.
     */
    async function readResponse(response) {
      // A plain fetch answer carries text; a test double may only carry json().
      const text = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (!body && typeof response.json === 'function') {
        try { body = await response.json(); } catch { body = null; }
      }
      const unauthorized = response.status === 401 || /authentication required/i.test(text);
      if (unauthorized) {
        const last = Number(window.__ofAuthReloadAt ?? 0);
        if (Date.now() - last > 30_000) {
          window.__ofAuthReloadAt = Date.now();
          setTimeout(() => { try { window.location.reload(); } catch {} }, 300);
          throw new Error('DSH 已重新签发访问授权（应用重启或换了端口）。正在自动刷新界面，几秒后面板会恢复。');
        }
        throw new Error('DSH 仍未授权：请按 Ctrl+R 重新加载界面。');
      }
      if (!response.ok || !body) throw new Error(body?.error ?? (text.trim().slice(0, 200) || `HTTP ${response.status}`));
      return body;
    }

    async function getJson(routePath) {
      const response = await fetch(apiUrl(routePath), { cache: 'no-store' });
      return readResponse(response);
    }

    async function postJson(routePath, payload) {
      const response = await fetch(apiUrl(routePath), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      return readResponse(response);
    }

    /** The film mark: a frame with a play head, used by the strip title and the
     *  current-step dot. Everything is centred on the frame's own box, so the
     *  triangle sits in the middle and nothing floats outside the frame. */
    function filmIcon(size) {
      const dim = size ?? 16;
      return h(
        'svg',
        {
          className: 'of-icon',
          width: dim,
          height: dim,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        // The frame: 3..21 across, 4.5..19.5 down. Its centre is (12, 12).
        h('rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2.5 }),
        // The play head, centred on that same (12, 12), drawn as a triangle
        // whose own bounding box is centred too (10.2..15.2 across, 8.9..15.1 down).
        h('path', { d: 'M10.2 8.9 15.2 12 10.2 15.1Z' }),
      );
    }

    /** Human-facing milliseconds: 820ms, 4.2s, 1m 05s. */
    function formatBytes(bytes) {
      const n = Number(bytes) || 0;
      if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
      if (n >= 1024) return `${Math.round(n / 1024)} KB`;
      return `${n} B`;
    }

    function formatDuration(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value < 0) return '';
      if (value < 1000) return `${Math.round(value)}ms`;
      if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
      const minutes = Math.floor(value / 60_000);
      const seconds = Math.round((value % 60_000) / 1000);
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }

    /** Short session tag, so a row can be traced to the conversation it came from. */
    function sessionTag(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return '';
      return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
    }

    /**
     * The film as a timeline: one row per track, one cell per clip, sized by
     * the clip's own at/length against the film's total. Read-only — editing
     * stays in Studio. A clip whose length lives only in its media file shows
     * at its start with a nominal width, which is honest and still legible.
     */
    function renderTimeline(check, t) {
      const facts = check?.facts;
      if (!facts || !Array.isArray(facts.picture)) return null;
      const total = facts.duration > 0 ? facts.duration : 0;
      const knownEnds = facts.picture.filter((c) => c.length > 0).map((c) => c.at + c.length);
      const seconds = total > 0 ? total : Math.max(1, ...knownEnds, ...facts.picture.map((c) => c.at + 2));
      const pct = (v) => `${Math.max(1.5, (v / seconds) * 100).toFixed(2)}%`;
      const tracks = [...new Set(facts.picture.map((c) => c.track))].sort((a, b) => a - b);
      const rows = tracks.map((trackIndex) =>
        h(
          'div',
          { className: 'of-tl-track', key: `t${trackIndex}` },
          facts.picture
            .filter((c) => c.track === trackIndex)
            .sort((a, b) => a.at - b.at)
            .map((clip, i) => {
              const width = clip.length > 0 ? clip.length : Math.min(2, seconds * 0.05);
              const cls = 'of-tl-clip ' + (clip.kind === 'page' ? 'of-tl-page' : clip.kind === 'still' || clip.kind === 'video' ? '' : 'of-tl-gap');
              return h(
                'div',
                {
                  className: cls,
                  key: clip.id ?? `c${i}`,
                  style: { marginLeft: pct(clip.at), width: pct(width) },
                  title: `${clip.src} @${clip.at}${clip.length > 0 ? ` +${clip.length}s` : ' (length in file)'}`,
                },
                clip.src ? clip.src.split('/').pop().split('#')[0] : clip.id,
              );
            }),
        ),
      );
      rows.push(h('div', { className: 'of-tl-scale', key: 'scale' }, h('span', null, '0s'), h('span', null, `${seconds > 0 ? seconds : '—'}s`)));
      return h('div', { className: 'of-timeline' }, rows);
    }

    /** One-line summary of whatever the Host reported for a step's arguments. */
    function summarizeArgs(raw) {
      if (raw === undefined || raw === null) return '';
      if (typeof raw === 'string') return raw;
      if (Array.isArray(raw)) return raw.join(' ');
      if (typeof raw !== 'object') return String(raw);
      // The Host sends `summary`; older argument shapes stay readable too.
      if (typeof raw.summary === 'string' && raw.summary) return raw.summary;
      const parts = [];
      const args = raw.args;
      if (Array.isArray(args)) parts.push(args.join(' '));
      else if (typeof args === 'string') parts.push(args);
      for (const key of ['command', 'name', 'target', 'file', 'path']) {
        const value = raw[key];
        if (typeof value === 'string' && value) parts.push(value);
      }
      return parts.join(' · ');
    }

    /** Normalize one progress entry; unknown shapes degrade to a readable row. */
    function toStep(raw, index) {
      if (raw === null || typeof raw !== 'object') {
        return { name: String(raw ?? ''), args: '', tone: 'ok', ms: 0, key: `s${index}`, detail: '', session: '', project: '' };
      }
      const state = typeof raw.state === 'string' ? raw.state : typeof raw.status === 'string' ? raw.status : '';
      const tone = /error|fail/i.test(state) ? 'error' : /warn/i.test(state) ? 'warn' : /run|active|pending|progress/i.test(state) ? 'running' : 'ok';
      // The Host records ISO timestamps rather than a millisecond count, so
      // the elapsed time is derived from them when no explicit value is sent.
      const startedAt = Date.parse(raw.startedAt ?? '');
      const finishedAt = Date.parse(raw.finishedAt ?? '');
      const derived = Number.isFinite(startedAt) && Number.isFinite(finishedAt) ? finishedAt - startedAt : NaN;
      const ms = Number(raw.durationMs ?? raw.ms ?? raw.elapsedMs ?? derived);
      // `toolName` is the field this Host actually sends; the others are kept
      // so an entry from another producer still names its tool.
      const name = [raw.toolName, raw.tool, raw.name].find((v) => typeof v === 'string' && v) ?? '';
      return {
        name,
        args: summarizeArgs(raw),
        tone,
        ms: Number.isFinite(ms) && ms >= 0 ? ms : 0,
        key: typeof raw.id === 'string' && raw.id ? raw.id : `${raw.startedAt ?? 'k'}-${index}`,
        detail: typeof raw.detail === 'string' ? raw.detail : '',
        session: typeof raw.sessionId === 'string' ? raw.sessionId : '',
        project: typeof raw.projectPath === 'string' ? raw.projectPath : '',
      };
    }

    /** Capability ids the Host sends with each provider, as panel labels. The
     *  Host owns the list; an id with no label renders as itself, so a new
     *  provider can never appear as "unknown" just because this file is old. */
    const CAP_LABELS = {
      voice: 'capVoice', sfx: 'capSfx', music: 'capMusic', transcript: 'capTranscript',
      image: 'capImage', video: 'capVideo', subtitle: 'capSubtitle',
      stock: 'capStock', search: 'capSearch',
    };

    /** The last good snapshot, shared by every mounted panel. */
    const EMPTY_PROGRESS = { current: null, recent: [] };
    // A Map, not a Set: two mounts may legitimately pass the same callback
    const progressSubscribers = new Map();
    let progressSubscriberSeq = 0;
    let progressTimer = null;
    let latestProgress = EMPTY_PROGRESS;
    let latestSession = undefined;

    /** One read of the Host's progress view; failures keep the last good value. */
    async function readProgress(session) {
      try {
        const query = typeof session === 'string' && session.length > 0 ? `?session=${encodeURIComponent(session)}` : '';
        const body = await getJson(`/mise/progress${query}`);
        const p = body?.progress ?? body;
        const recentRaw = Array.isArray(p?.recent) ? p.recent : [];
        latestProgress = {
          current: p?.current && typeof p.current === 'object' ? toStep(p.current, -1) : null,
          recent: recentRaw.slice(-RECENT_LIMIT).reverse().map(toStep),
        };
      } catch {
        // Route not mounted yet, or a transient failure: keep the previous
        // snapshot rather than flashing an error into the panel.
      }
      return latestProgress;
    }

    /**
     * Share one interval across every mounted panel: the first subscriber starts
     * polling, the last one to leave stops it. Several open surfaces therefore
     * cost one request per tick rather than one each.
     * @param {(snapshot: { current: unknown, recent: unknown[] }) => void} onSnapshot
     * @param {string} [session] the conversation to scope progress to
     * @returns {() => void} unsubscribe
     */
    function subscribeProgress(onSnapshot, session) {
      const key = progressSubscriberSeq++;
      const subscriber = (snapshot) => {
        try {
          onSnapshot(snapshot);
        } catch {
          // A subscriber that throws must not stop the others or the timer.
        }
      };
      progressSubscribers.set(key, subscriber);
      if (session) latestSession = session;

      const publish = (snapshot) => {
        for (const notify of [...progressSubscribers.values()]) notify(snapshot);
      };

      if (progressTimer === null) {
        void readProgress(latestSession).then(publish);
        progressTimer = setInterval(() => void readProgress(latestSession).then(publish), PROGRESS_INTERVAL_MS);
      } else {
        // Already polling: hand the new subscriber what we already know.
        subscriber(latestProgress);
      }

      return () => {
        // Keyed removal: releasing one of two subscriptions must not drop the
        // other, and only the last release stops the timer.
        progressSubscribers.delete(key);
        if (progressSubscribers.size === 0 && progressTimer !== null) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };
    }

    /**
     * The panel: a live view of the film being made. The picture is the film's
     * own contact sheet; the right column carries status, progress and the
     * controls. Every field is optional so the panel keeps rendering when the
     * Host has not published it yet.
     */
    function OpenFilmPanel({ t, inject }) {
      const injected = inject ?? {};
      const [status, setStatus] = React.useState(null);
      const [loading, setLoading] = React.useState(true);
      // Which part of the panel is showing: the shots, the picture, or the controls.
      const [tab, setTab] = React.useState('film');
      const [loadError, setLoadError] = React.useState(null);
      const [busy, setBusy] = React.useState(null);
      const [result, setResult] = React.useState(null);
      const [progress, setProgress] = React.useState({ current: null, recent: [] });
      const [stylesOpen, setStylesOpen] = React.useState(false);
      const [keysOpen, setKeysOpen] = React.useState(false);
      const [pickedProject, setPickedProject] = React.useState(null);
      // Which shot the storyboard is on. The panel edits the film here instead
      // of sending the person to a second web app.
      const [shotIndex, setShotIndex] = React.useState(0);
      // A preview URL that fails once is not retried forever: the panel says so
      // instead of showing a broken image, and a newer file clears the flag.
      const [previewBroken, setPreviewBroken] = React.useState(false);
      const [videoBroken, setVideoBroken] = React.useState(false);
      // A region marked on the picture: the person draws a box, types what they
      // want there, and it is handed to the agent as exact coordinates instead
      // of a screenshot. The box is stored in the preview's own 0..1 space and
      // converted to the film's frame when it is sent.
      const [regionMode, setRegionMode] = React.useState(false);
      const [regionBox, setRegionBox] = React.useState(null);
      const [regionDrag, setRegionDrag] = React.useState(null);
      const [regionText, setRegionText] = React.useState('');
      const [regionBusy, setRegionBusy] = React.useState(false);
      const [regionResult, setRegionResult] = React.useState(null);
      // Key drafts live only here: never in a store, in localStorage, or a log.
      const [keyDrafts, setKeyDrafts] = React.useState({});
      const [confirmRemove, setConfirmRemove] = React.useState(null);
      // Media direct from the panel: the prompt, the kind, its result, and the
      // kind picker's open state — a custom menu, since the native select
      // cannot take the panel's dark theme.
      const [mediaKind, setMediaKind] = React.useState('voice');
      const [mediaPrompt, setMediaPrompt] = React.useState('');
      const [mediaBusy, setMediaBusy] = React.useState(false);
      const [mediaResult, setMediaResult] = React.useState(null);
      // Which service makes the picture, which of its models, and the project
      // files that keep a character consistent. The Host's catalogue decides
      // what is offered; nothing here assumes a model's limits.
      const [mediaProvider, setMediaProvider] = React.useState('agnes');
      const [mediaModel, setMediaModel] = React.useState('');
      const [mediaRefs, setMediaRefs] = React.useState('');
      const [mediaAudio, setMediaAudio] = React.useState(false);
      const [kindOpen, setKindOpen] = React.useState(false);
      // Built per render, not memoized: the client must not assume which hooks
      // beyond useState/useEffect/useCallback the host's React exposes.
      const MEDIA_KINDS = [
        { value: 'voice', label: t('mediaVoice') },
        { value: 'image', label: t('mediaImage') },
        { value: 'video', label: t('mediaVideo') },
      ];
      const mediaKindLabel = MEDIA_KINDS.find((k) => k.value === mediaKind)?.label ?? mediaKind;
      const mediaProviders = Array.isArray(status?.media) && status.media.length > 0
        ? status.media
        : [{ id: 'agnes', name: 'Agnes', configured: undefined, models: {} }];
      const currentMedia = mediaProviders.find((p) => p.id === mediaProvider) ?? mediaProviders[0] ?? { models: {} };
      const mediaModels = mediaKind === 'voice' ? [] : (currentMedia?.models?.[mediaKind] ?? []);
      const mediaModelSpec = mediaModels.find((m) => m.id === mediaModel) ?? mediaModels[0];
      const mediaAudioSupported = mediaKind === 'video' && mediaModelSpec?.generateAudio === true;
      const pickKind = React.useCallback((value) => {
        setMediaKind(value);
        setKindOpen(false);
      }, []);
      // The film's own structure, read on demand (mise_check's facts).
      const [timeline, setTimeline] = React.useState(null);
      const [timelineOpen, setTimelineOpen] = React.useState(false);
       const [library, setLibrary] = React.useState({ films: [] });
       const [libraryOpen, setLibraryOpen] = React.useState(false);
       const [libraryQuery, setLibraryQuery] = React.useState('');
       const [librarySort, setLibrarySort] = React.useState('updated');
       const [librarySortOpen, setLibrarySortOpen] = React.useState(false);
       const [libraryPicked, setLibraryPicked] = React.useState(null);
       // The pile opens into a fan; a card then plays. Two steps, because the
       // person asked for a stack that opens, not a permanent list.
       const [libraryFanned, setLibraryFanned] = React.useState(false);
       // Which card the pointer is over: that one is brought to the top of the
       // pile, so a stack of films can be read without fanning it first.
       const [libraryHovered, setLibraryHovered] = React.useState(null);
       const LIBRARY_SORTS = [
         { value: 'updated', label: t('sortUpdated') },
         { value: 'oldest', label: t('sortOldest') },
         { value: 'name', label: t('sortName') },
         { value: 'size', label: t('sortSize') },
       ];
       const librarySortLabel = LIBRARY_SORTS.find((k) => k.value === librarySort)?.label ?? librarySort;
       const pickLibrarySort = React.useCallback((value) => {
         setLibrarySort(value);
         setLibrarySortOpen(false);
       }, []);
       // Playing a film means: it becomes the panel's picture. Closing the fan
       // after the choice keeps the panel short once the person has decided.
       const playLibraryFilm = React.useCallback((film) => {
         setLibraryPicked(film);
         setPreviewBroken(false);
         setLibraryFanned(false);
       }, []);

      const projects = Array.isArray(status?.projects) ? status.projects : [];
      const activeProject = typeof pickedProject === 'string' && pickedProject.length > 0
        ? pickedProject
        : typeof status?.project?.path === 'string'
          ? status.project.path
          : null;

      const refresh = React.useCallback(async () => {
        setLoading(true);
        setLoadError(null);
        try {
          // The session always travels with the request: a browser panel has no
          // other way to say which folder it is looking at, and without it the
          // Host falls back to wherever its own process happens to run.
          const query = new URLSearchParams();
          if (activeProject) query.set('cwd', activeProject);
          if (injected.sessionId) query.set('session', injected.sessionId);
          const suffix = query.toString();
          const body = await getJson(`/mise/status${suffix ? `?${suffix}` : ''}`);
          setStatus(body);
          // A freshly reported picture deserves another attempt.
          setPreviewBroken(false);
          setConfirmRemove(null);
        } catch (error) {
          setLoadError(String(error?.message ?? error));
        } finally {
          setLoading(false);
        }
      }, [activeProject, injected.sessionId]);

      // Initial status plus an explicit refresh from the panel's button.
      React.useEffect(() => {
        void refresh().catch(() => {});
      }, [refresh]);

      React.useEffect(() => {
        if (!libraryOpen) return undefined;
        // The library is scoped to the film this panel is showing: a plugin
        // process does not necessarily run in the person's folder, so without
        // the directory the film they are working on would be invisible.
        const query = new URLSearchParams({ q: libraryQuery, sort: librarySort });
        if (activeProject) query.set('cwd', activeProject);
        if (injected.sessionId) query.set('session', injected.sessionId);
        let alive = true;
        getJson(`/mise/library?${query.toString()}`).then((body) => {
          if (alive) setLibrary(body?.films ? body : { films: [] });
        }).catch(() => {});
        return () => { alive = false; };
      }, [libraryOpen, libraryQuery, librarySort, activeProject, injected.sessionId]);

      // Live progress. The poll itself is shared across every mounted panel
      // (see subscribeProgress); this effect only subscribes and releases.
      React.useEffect(() => subscribeProgress(setProgress, injected.sessionId), [injected.sessionId]);

      const run = React.useCallback(
        async (label, args) => {
          setBusy(label);
          setResult(null);
          try {
            const body = await postJson('/mise/run', {
              args,
              ...(activeProject ? { cwd: activeProject } : {}),
              ...(injected.sessionId ? { session: injected.sessionId } : {}),
            });
            const text = [body.stdout, body.stderr && `stderr:\n${body.stderr}`].filter(Boolean).join('\n').trim();
            setResult({ tone: body.ok === true ? 'ok' : 'error', text: text || (body.ok ? t('ok') : `exit ${body.exitCode}`) });
          } catch (error) {
            setResult({ tone: 'error', text: String(error?.message ?? error) });
          } finally {
            setBusy(null);
            void refresh().catch(() => {});
          }
        },
        [activeProject, injected.sessionId, refresh, t],
      );

      // The storyboard: pick a shot, draw it, and it appears in the preview.
      // Editing (length, order) writes back to film.html through the host, so
      // the panel does not need a Studio server to retime a film.
      const board = status?.storyboard ?? null;
      const beats = Array.isArray(board?.beats) ? board.beats : [];
      const editShot = React.useCallback(
        async (action, payload) => {
          setBusy(action);
          try {
            const body = await postJson('/mise/storyboard', {
              action,
              ...payload,
              ...(activeProject ? { cwd: activeProject } : {}),
              ...(injected.sessionId ? { session: injected.sessionId } : {}),
            });
            if (body?.ok && body.storyboard) {
              setStatus((previous) => ({ ...previous, storyboard: body.storyboard }));
              setResult({ tone: 'ok', text: t('shotChanged') });
            } else {
              setResult({ tone: 'error', text: String(body?.error ?? 'edit failed') });
            }
          } catch (error) {
            setResult({ tone: 'error', text: String(error?.message ?? error) });
          } finally {
            setBusy(null);
          }
        },
        [activeProject, injected.sessionId, t],
      );
      const drawShot = React.useCallback(
        async (beat) => {
          if (!beat) return;
          const mid = Number((Number(beat.at) + Number(beat.length) / 2).toFixed(2));
          setShotIndex(beat.index);
          await run(`look ${mid}`, ['look', String(mid)]);
        },
        [run],
      );
      const stepShot = React.useCallback(
        (delta) => {
          if (!beats.length) return;
          const current = Math.max(0, beats.findIndex((beat) => beat.index === shotIndex));
          const next = beats[Math.min(beats.length - 1, Math.max(0, current + delta))];
          void drawShot(next);
        },
        [beats, drawShot, shotIndex],
      );

      const saveKey = React.useCallback(
        async (env) => {
          const value = (keyDrafts[env] ?? '').trim();
          if (!value) return;
          setBusy(env);
          setResult(null);
          try {
            await postJson('/mise/credential', { env, value });
            // Clear the draft the moment it is accepted: a saved key must not
            // linger in the input, and the state above never held it either.
            setKeyDrafts((drafts) => ({ ...drafts, [env]: '' }));
            await refresh();
          } catch (error) {
            setResult({ tone: 'error', text: String(error?.message ?? error) });
          } finally {
            setBusy(null);
          }
        },
        [keyDrafts, refresh],
      );

      const removeKey = React.useCallback(
        async (env) => {
          setBusy(env);
          setResult(null);
          try {
            await postJson('/mise/credential', { env, value: null });
            setConfirmRemove(null);
            await refresh();
          } catch (error) {
            setResult({ tone: 'error', text: String(error?.message ?? error) });
          } finally {
            setBusy(null);
          }
        },
        [refresh],
      );

      const providers = Array.isArray(status?.providers) ? status.providers : [];
      const styles = Array.isArray(status?.styles) ? status.styles : [];
      const installed = status?.installed === true;
      const hasProgress = progress.current !== null || progress.recent.length > 0;

      // Media direct: the same /mise/media route the tools' implementations
      // serve. A voice line needs nothing but words; a picture or a video needs
      // AGNES_API_KEY, and the route's error says so.
      const makeMedia = React.useCallback(
        async () => {
          const prompt = mediaPrompt.trim();
          if (!prompt || mediaBusy) return;
          setMediaBusy(true);
          setMediaResult(null);
          try {
            const references = mediaRefs.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
            const body = await postJson('/mise/media', {
              kind: mediaKind,
              ...(mediaKind === 'voice'
                ? { text: prompt }
                : {
                    prompt,
                    provider: mediaProvider,
                    ...(mediaModel ? { model: mediaModel } : {}),
                    ...(mediaKind === 'video' && references.length ? { references } : {}),
                    ...(mediaKind === 'video' && mediaAudio ? { generateAudio: true } : {}),
                  }),
              ...(activeProject ? { cwd: activeProject } : {}),
            });
            setMediaResult({
              tone: 'ok',
              text: body.queued
                ? `${t('queueQueued')} · ${body.provider ?? ''} ${body.model ?? ''} · ${String(body.jobId ?? '').slice(0, 8)}`
                : mediaKind === 'voice'
                  ? `${body.relative} · ${body.seconds}s · ${body.voice ?? ''}`
                  : `${body.relative} · ${body.provider ?? ''} ${body.model ?? ''}${body.actual?.duration ? ` · ${body.actual.width}x${body.actual.height} ${body.actual.duration}s` : ''}`,
            });
            setMediaPrompt('');
            void refresh().catch(() => {});
          } catch (error) {
            setMediaResult({ tone: 'error', text: String(error?.message ?? error) });
          } finally {
            setMediaBusy(false);
          }
        },
        [mediaKind, mediaPrompt, mediaBusy, activeProject, refresh, mediaProvider, mediaModel, mediaRefs, mediaAudio],
      );

      // The film's structure, read on first open (mise_check's facts via
      // the read-only /mise/check route). Not polled: film.html changes
      // only when someone edits it.
      const loadTimeline = React.useCallback(
        async () => {
          if (!activeProject) return;
          try {
            const body = await getJson(`/mise/check?cwd=${encodeURIComponent(activeProject)}`);
            setTimeline(body);
          } catch {
            setTimeline(null);
          }
        },
        [activeProject],
      );

      // ── marking one region and asking for a change there ──────────────────
      const previewMedia = () => (typeof document !== 'undefined' ? document.querySelector('.of-preview > video, .of-preview > img') : null);

      const pointInPreview = (event) => {
        const el = previewMedia();
        const r = el?.getBoundingClientRect();
        if (!r || !r.width || !r.height) return null;
        return {
          x: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
        };
      };
      const startRegion = (event) => {
        if (!regionMode) return;
        const p = pointInPreview(event);
        if (!p) return;
        setRegionResult(null);
        setRegionBox(null);
        setRegionDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      };
      const moveRegion = (event) => {
        if (!regionDrag) return;
        const p = pointInPreview(event);
        if (!p) return;
        setRegionDrag({ ...regionDrag, x1: p.x, y1: p.y });
      };
      const endRegion = () => {
        if (!regionDrag) return;
        const box = {
          x: Math.min(regionDrag.x0, regionDrag.x1),
          y: Math.min(regionDrag.y0, regionDrag.y1),
          w: Math.abs(regionDrag.x1 - regionDrag.x0),
          h: Math.abs(regionDrag.y1 - regionDrag.y0),
        };
        setRegionDrag(null);
        if (box.w < 0.01 || box.h < 0.01) return;
        setRegionBox(box);
      };
      const submitRegion = async () => {
        const text = regionText.trim();
        if (!regionBox || !text || regionBusy) return;
        setRegionBusy(true);
        setRegionResult(null);
        try {
          const el = previewMedia();
          const r = el?.getBoundingClientRect();
          const vw = el?.videoWidth || el?.naturalWidth || 16;
          const vh = el?.videoHeight || el?.naturalHeight || 9;
          // object-fit: contain — strip the letterbox, so the rectangle is in
          // the picture's own coordinates rather than the empty bars beside it.
          const scale = r ? Math.min(r.width / vw, r.height / vh) : 1;
          const cw = vw * scale;
          const ch = vh * scale;
          const offX = r ? (r.width - cw) / 2 : 0;
          const offY = r ? (r.height - ch) / 2 : 0;
          const pxX = Math.max(0, regionBox.x * (r?.width ?? 0) - offX);
          const pxY = Math.max(0, regionBox.y * (r?.height ?? 0) - offY);
          const pxW = Math.max(1, Math.min(cw - pxX, regionBox.w * (r?.width ?? 0)));
          const pxH = Math.max(1, Math.min(ch - pxY, regionBox.h * (r?.height ?? 0)));
          const body = await postJson('/mise/region-edit', {
            ...(activeProject ? { cwd: activeProject } : {}),
            ...(injected.sessionId ? { session: injected.sessionId } : {}),
            time: Number(el?.currentTime) || 0,
            rect: {
              x: cw > 0 ? pxX / cw : regionBox.x,
              y: ch > 0 ? pxY / ch : regionBox.y,
              w: cw > 0 ? pxW / cw : regionBox.w,
              h: ch > 0 ? pxH / ch : regionBox.h,
            },
            instruction: text,
          });
          setRegionResult({ tone: body.submitted ? 'ok' : 'info', text: body.message });
          if (body.submitted) {
            setRegionBox(null);
            setRegionText('');
            setRegionMode(false);
          }
        } catch (error) {
          setRegionResult({ tone: 'error', text: String(error?.message ?? error) });
        } finally {
          setRegionBusy(false);
        }
      };

      // The film is a picture, not a status line: show the contact sheet `look`
      // drew, or the exported video, instead of describing it in words.
      const films = Array.isArray(library?.films) ? library.films : [];
      const videoSrc = libraryPicked?.url ?? (typeof status?.videoUrl === 'string' && status.videoUrl ? status.videoUrl : null);
      const delivery = status?.delivery ?? null;
      const sheetSrc = typeof status?.previewUrl === 'string' && status.previewUrl ? status.previewUrl : null;
      // A video that cannot be read falls back to the contact sheet instead of
      // replacing the whole picture with an error: the sheet is smaller and
      // still proves the film exists.
      const previewSrc = videoSrc && !videoBroken ? videoSrc : sheetSrc;
      const isVideo = Boolean(videoSrc && !videoBroken);

      // Another film or a new render is a new chance: clear the broken flags.
      React.useEffect(() => { setVideoBroken(false); setPreviewBroken(false); }, [videoSrc, sheetSrc]);

      // A render error must never blank the sidebar: an empty panel is the
      // hardest failure for a person to describe. Catch it and print the reason.
      try {
      return h(
        'div',
        { className: 'of-dock', 'data-tab': tab },
        h(
          'div',
          { className: 'of-dock-head' },
          h(
            'div',
            { className: 'of-dock-title' },
            filmIcon(16),
            h('span', null, t('title')),
            h('span', { className: 'of-dock-sub' }, t('subtitle')),
          ),
          h(
            'button',
            { type: 'button', className: 'of-btn', onClick: () => void refresh(), disabled: loading },
            t('refresh'),
          ),
        ),

        // A jump bar, the way an iOS panel moves between its parts: the content
        // stays in one column (a sidebar has no room for hidden pages), and the
        // segments take you to the part you named.
        h(
          'div',
          { className: 'of-seg', role: 'tablist' },
          [['film', t('storyboard')], ['look', t('preview')], ['setup', t('setup')]].map(([key, label], index) => h(
            'button',
            {
              key,
              type: 'button',
              className: `of-seg-item${index === 0 ? ' of-seg-on' : ''}`,
              onClick: (event) => {
                setTab(key);
                const dock = event.currentTarget.closest('.of-dock');
                dock?.scrollTo({ top: 0, behavior: 'smooth' });
                for (const item of event.currentTarget.parentElement.children) item.classList.remove('of-seg-on');
                event.currentTarget.classList.add('of-seg-on');
              },
            },
            label,
          )),
        ),

        // The shot list, editable here. The web Studio was a second app to
        // start; the panel already has the plan and the preview, so the shots
        // live beside them.
        beats.length
          ? h(
              'div',
              { className: 'of-board of-sec-film' },
              h(
                'div',
                { className: 'of-board-head' },
                h('span', null, `${t('storyboard')} · ${beats.length}`),
                h('span', { className: 'of-board-sub' }, board?.plan?.genre ?? ''),
              ),
              h(
                'div',
                { className: 'of-board-strip' },
                beats.map((beat) => h(
                  'button',
                  {
                    type: 'button',
                    key: beat.index,
                    className: `of-shot${beat.index === shotIndex ? ' of-shot-active' : ''}${beat.thumb ? ' of-shot-has' : ''}`,
                    title: `${beat.kind} · ${beat.length}s · ${beat.move}${beat.claim ? ` · ${beat.claim}` : ''}`,
                    onClick: () => void drawShot(beat),
                  },
                  // The still, when mise_thumbs has drawn one: the timeline is
                  // pictures first, labels second.
                  beat.thumb
                    ? h('img', { className: 'of-shot-img', src: beat.thumb, alt: '', loading: 'lazy' })
                    : null,
                  h('span', { className: 'of-shot-i' }, String(beat.index).padStart(2, '0')),
                  h('span', { className: 'of-shot-k' }, beat.kind),
                  h('span', { className: 'of-shot-t' }, `${beat.length}s`),
                  beat.move !== 'still' ? h('span', { className: 'of-shot-m', title: beat.move }, '●') : null,
                )),
              ),
              h(
                'div',
                { className: 'of-board-actions' },
                h('button', { type: 'button', className: 'of-btn', onClick: () => stepShot(-1), disabled: Boolean(busy) }, t('prevShot')),
                h('button', { type: 'button', className: 'of-btn', onClick: () => stepShot(1), disabled: Boolean(busy) }, t('nextShot')),
                h('button', { type: 'button', className: 'of-btn', onClick: () => void run(t('renderFilm'), ['render']), disabled: Boolean(busy) }, t('renderFilm')),
              ),
              // Editing the selected shot: length and position, written straight
              // into film.html. This is what the web Studio was being started for.
              (() => {
                const current = beats.find((beat) => beat.index === shotIndex) ?? beats[0];
                if (!current) return null;
                return h(
                  'div',
                  { className: 'of-board-edit' },
                  h('span', { className: 'of-board-edit-name' }, `${String(current.index).padStart(2, '0')} · ${current.length}s`),
                  h('button', { type: 'button', className: 'of-btn', disabled: Boolean(busy), onClick: () => void editShot('setLength', { index: current.index, length: Number((current.length - 0.5).toFixed(2)) }) }, '−0.5s'),
                  h('button', { type: 'button', className: 'of-btn', disabled: Boolean(busy), onClick: () => void editShot('setLength', { index: current.index, length: Number((current.length + 0.5).toFixed(2)) }) }, '+0.5s'),
                  h('button', { type: 'button', className: 'of-btn', disabled: Boolean(busy), onClick: () => void editShot('move', { index: current.index, delta: -1 }) }, t('moveEarlier')),
                  h('button', { type: 'button', className: 'of-btn', disabled: Boolean(busy), onClick: () => void editShot('move', { index: current.index, delta: 1 }) }, t('moveLater')),
                );
              })(),
            )
          : null,

        // The live picture of the film.
        h(
          'div',
          { className: 'of-preview of-sec-look' },
          previewSrc
            ? h(isVideo ? 'video' : 'img', {
                src: apiUrl(previewSrc),
                alt: t('previewAlt'),
                ...(isVideo ? { controls: true, muted: true, playsInline: true } : {}),
                loading: 'lazy',
                onError: () => { if (isVideo) setVideoBroken(true); else setPreviewBroken(true); },
              })
            : h(
                'div',
                { className: 'of-preview-empty' },
                h('span', { className: 'of-empty-mark' }, '◍'),
                h('span', { className: 'of-empty-line' }, t('noPreview')),
                h(
                  'button',
                  { type: 'button', className: 'of-btn of-primary', disabled: Boolean(busy), onClick: () => void run(t('drawStill'), ['look']) },
                  t('drawStill'),
                ),
              ),
          // Mark a region on the picture. The layer only takes the pointer while
          // marking, so playing and scrubbing keep working the rest of the time.
          previewSrc
            ? h(
                'div',
                {
                  className: `of-region-layer${regionMode ? ' of-region-on' : ''}`,
                  onMouseDown: startRegion,
                  onMouseMove: moveRegion,
                  onMouseUp: endRegion,
                  onMouseLeave: endRegion,
                  title: regionMode ? t('regionHint') : undefined,
                },
                regionDrag
                  ? h('div', {
                      className: 'of-region-box',
                      style: {
                        left: `${Math.min(regionDrag.x0, regionDrag.x1) * 100}%`,
                        top: `${Math.min(regionDrag.y0, regionDrag.y1) * 100}%`,
                        width: `${Math.abs(regionDrag.x1 - regionDrag.x0) * 100}%`,
                        height: `${Math.abs(regionDrag.y1 - regionDrag.y0) * 100}%`,
                      },
                    })
                  : regionBox
                    ? h('div', {
                        className: 'of-region-box',
                        style: {
                          left: `${regionBox.x * 100}%`,
                          top: `${regionBox.y * 100}%`,
                          width: `${regionBox.w * 100}%`,
                          height: `${regionBox.h * 100}%`,
                        },
                      })
                    : null,
                regionMode && !regionBox && !regionDrag ? h('div', { className: 'of-region-hint' }, t('regionHint')) : null,
              )
            : null,
          previewSrc
            ? h(
                'button',
                {
                  type: 'button',
                  className: `of-region-toggle${regionMode ? ' of-region-toggle-on' : ''}`,
                  onClick: () => { setRegionMode((v) => !v); setRegionBox(null); setRegionDrag(null); setRegionResult(null); },
                },
                regionMode ? t('regionCancel') : t('regionSelect'),
              )
            : null,
          previewSrc && !previewBroken ? h('div', { className: 'of-preview-tag' }, isVideo ? t('tagVideo') : t('tagSheet')) : null,
          previewSrc && previewBroken ? h('div', { className: 'of-preview-empty' }, t('previewBroken')) : null,
        ),

        // What the marked region should become. The words and the exact box go
        // to the agent together, so nothing is guessed from a screenshot.
        regionBox
          ? h(
              'div',
              { className: 'of-region-form' },
              h('div', { className: 'of-region-form-title' }, t('regionTitle')),
              h('textarea', {
                className: 'of-region-text',
                rows: 2,
                value: regionText,
                placeholder: t('regionPlaceholder'),
                onChange: (e) => setRegionText(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submitRegion(); },
              }),
              h(
                'div',
                { className: 'of-region-actions' },
                h(
                  'button',
                  { type: 'button', className: 'of-btn', onClick: () => void submitRegion(), disabled: regionBusy || !regionText.trim() },
                  regionBusy ? t('regionSending') : t('regionSubmit'),
                ),
                h('button', { type: 'button', className: 'of-btn', onClick: () => { setRegionBox(null); setRegionText(''); setRegionResult(null); } }, t('cancel')),
              ),
              regionResult
                ? h('div', { className: regionResult.tone === 'error' ? 'of-status-error' : 'of-status-ok' }, regionResult.text)
                : h('div', { className: 'of-hint' }, t('regionHint2')),
            )
          : null,

        loadError ? h('div', { className: 'of-status-error' }, `${t('loadFailed')}${loadError}`) : null,
        loading && !status ? h('div', { className: 'of-hint' }, t('loading')) : null,
        installed === false ? h('div', { className: 'of-status-error' }, t('notInstalled')) : null,

        // A film this panel is showing, and the switcher when there is more
        // than one. A wrong film is worse than no film, so the choice is explicit.
        projects.length > 1
          ? h(
              'div',
              { className: 'of-projects' },
              projects.map((project) => {
                const path = typeof project?.path === 'string' ? project.path : '';
                if (!path) return null;
                const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
                return h(
                  'button',
                  {
                    type: 'button',
                    key: path,
                    className: `of-project${path === activeProject ? ' of-project-active' : ''}`,
                    title: path,
                    onClick: () => setPickedProject(path),
                  },
                  name,
                );
              }),
            )
          : null,

        h(
          'section',
          { className: `of-library${libraryOpen ? ' of-library-open' : ''}` },
          h(
            'button',
            { type: 'button', className: 'of-library-head', onClick: () => setLibraryOpen((v) => !v), 'aria-expanded': libraryOpen },
            h('span', { className: 'of-library-title' }, filmIcon(16), t('library')),
            h('span', { className: 'of-library-count' }, String(library?.total ?? films.length)),
            h('span', { className: 'of-library-chevron' }, libraryOpen ? '▴' : '▾'),
          ),
          libraryOpen
            ? h(
                'div',
                { className: 'of-library-body' },
                h(
                  'div',
                  { className: 'of-library-tools' },
                  h('input', { className: 'of-library-search', value: libraryQuery, placeholder: t('librarySearch'), onChange: (e) => setLibraryQuery(e.target.value) }),
                  h(
                    'div',
                    { className: 'of-select of-library-sort-select', onBlur: () => setLibrarySortOpen(false), tabIndex: -1 },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'of-select-trigger' + (librarySortOpen ? ' of-select-open' : ''),
                        onClick: () => setLibrarySortOpen((open) => !open),
                        'aria-label': t('librarySort'),
                      },
                      h('span', null, librarySortLabel),
                      h('span', { className: 'of-select-caret' }, librarySortOpen ? '▴' : '▾'),
                    ),
                    librarySortOpen
                      ? h(
                          'div',
                          { className: 'of-select-menu of-library-sort-menu' },
                          LIBRARY_SORTS.map((k) => h(
                            'button',
                            {
                              type: 'button',
                              key: k.value,
                              className: 'of-select-item' + (k.value === librarySort ? ' of-select-active' : ''),
                              onMouseDown: (e) => e.preventDefault(),
                              onClick: () => pickLibrarySort(k.value),
                            },
                            k.label,
                          )),
                        )
                      : null,
                  ),
                ),
                films.length === 0
                  ? h('div', { className: 'of-library-empty' }, t('libraryEmpty'))
                  : libraryFanned
                    // Fanned out: one readable row per film, press to play.
                    ? h(
                        'div',
                        { className: 'of-library-fanned' },
                        h(
                          'button',
                          { type: 'button', className: 'of-library-collapse', onClick: () => setLibraryFanned(false) },
                          `▴ ${t('libraryCollapse')}`,
                        ),
                        films.map((film) => h(
                          'button',
                          {
                            type: 'button',
                            key: film.id,
                            className: `of-library-card${libraryPicked?.id === film.id ? ' of-library-card-picked' : ''}`,
                            onClick: () => playLibraryFilm(film),
                            title: `${film.name} · ${film.project}`,
                          },
                          h(
                            'span',
                            { className: 'of-library-card-poster' },
                            film.poster
                              ? h('img', { src: film.poster, alt: film.name })
                              : filmIcon(16),
                          ),
                          h('span', { className: 'of-library-card-copy' },
                            h('strong', null, film.name),
                            h('small', null, `${film.project} · ${formatBytes(film.bytes)}`),
                          ),
                          h('span', { className: 'of-library-card-play' }, libraryPicked?.id === film.id ? '▶' : '›'),
                        )),
                      )
                    // The pile: pressing it fans the cards out.
                    : h(
                        'div',
                        {
                          className: 'of-library-pile',
                          style: { '--of-pile-count': films.length },
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': t('libraryExpand'),
                          onClick: () => setLibraryFanned(true),
                          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') setLibraryFanned(true); },
                          onMouseLeave: () => setLibraryHovered(null),
                        },
                        films.map((film, index) => h(
                          'div',
                          {
                            key: film.id,
                            className: `of-library-card${libraryPicked?.id === film.id ? ' of-library-card-picked' : ''}${libraryHovered === film.id ? ' of-library-card-raised' : ''}`,
                            style: { '--of-stack-index': index },
                            title: `${film.name} · ${film.project}`,
                            onMouseEnter: () => setLibraryHovered(film.id),
                            onFocus: () => setLibraryHovered(film.id),
                            onBlur: () => setLibraryHovered(null),
                          },
                          h(
                            'span',
                            { className: 'of-library-card-poster' },
                            film.poster
                              ? h('img', { src: film.poster, alt: film.name })
                              : filmIcon(14),
                          ),
                          h('span', { className: 'of-library-card-copy' },
                            h('strong', null, film.name),
                            h('small', null, `${film.project} · ${formatBytes(film.bytes)}`),
                          ),
                          h('span', { className: 'of-library-card-play' }, '›'),
                        )),
                        h('span', { className: 'of-library-pile-hint' }, t('libraryExpand')),
                      ),
              )
            : null,
        ),

        h(
          'div',
          { className: 'of-actions' },
          h(
            'button',
            { type: 'button', className: 'of-btn of-btn-primary', onClick: () => void run('render', ['render']), disabled: busy !== null },
            busy === 'render' ? t('rendering') : t('render'),
          ),
          h(
            'button',
            { type: 'button', className: 'of-btn', onClick: () => void run('look', ['look']), disabled: busy !== null },
            busy === 'look' ? t('looking') : t('look'),
          ),
        ),

        // Media direct: a line in the panel, no round-trip through the
        // conversation. Voice is the default — it needs no key. The kind
        // picker is a custom menu: one that takes the panel's theme, unlike
        // Which service and model make the picture, and the project files that
        // keep a character or product the same from shot to shot. Only what the
        // service accepts is offered: the Host's catalogue is the one source.
        mediaKind !== 'voice'
          ? h(
              'div',
              { className: 'of-media-row' },
              h(
                'select',
                {
                  className: 'of-media-input',
                  value: mediaProvider,
                  onChange: (e) => { setMediaProvider(e.target.value); setMediaModel(''); },
                  disabled: mediaBusy || !installed,
                  title: t('mediaProvider'),
                },
                (mediaProviders.length > 0 ? mediaProviders : [{ id: 'agnes', name: 'Agnes' }]).map((p) =>
                  h('option', { key: p.id, value: p.id }, `${p.name}${p.configured === false ? ' · ' + t('providerNotConfigured') : ''}`),
                ),
              ),
              mediaModels.length > 1
                ? h(
                    'select',
                    {
                      className: 'of-media-input',
                      value: mediaModel,
                      onChange: (e) => setMediaModel(e.target.value),
                      disabled: mediaBusy || !installed,
                      title: t('mediaModel'),
                    },
                    mediaModels.map((m) => h('option', { key: m.id, value: m.id }, m.name)),
                  )
                : null,
            )
          : null,
        mediaKind === 'video'
          ? h(
              'div',
              { className: 'of-media-row' },
              h('input', {
                className: 'of-media-input',
                value: mediaRefs,
                placeholder: t('mediaRefsPlaceholder'),
                onChange: (e) => setMediaRefs(e.target.value),
                disabled: mediaBusy || !installed,
                title: t('mediaRefs'),
              }),
              mediaAudioSupported
                ? h(
                    'label',
                    { className: 'of-hint', title: t('mediaAudioHint') },
                    h('input', {
                      type: 'checkbox',
                      checked: mediaAudio,
                      onChange: (e) => setMediaAudio(e.target.checked),
                      disabled: mediaBusy || !installed,
                    }),
                    t('mediaAudio'),
                  )
                : null,
            )
          : null,
        // the native select, whose popup the page cannot style.
        h(
          'div',
          { className: 'of-media-row' },
          h(
            'div',
            { className: 'of-select', onBlur: () => setKindOpen(false), tabIndex: -1 },
            h(
              'button',
              {
                type: 'button',
                className: 'of-select-trigger' + (kindOpen ? ' of-select-open' : ''),
                onClick: () => setKindOpen((open) => !open),
                disabled: mediaBusy,
              },
              h('span', null, mediaKindLabel),
              h('span', { className: 'of-select-caret' }, kindOpen ? '▴' : '▾'),
            ),
            kindOpen
              ? h(
                  'div',
                  { className: 'of-select-menu' },
                  MEDIA_KINDS.map((k) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: k.value,
                        className: 'of-select-item' + (k.value === mediaKind ? ' of-select-active' : ''),
                        onMouseDown: (e) => e.preventDefault(), // keep the row from blurring first
                        onClick: () => pickKind(k.value),
                      },
                      k.label,
                    ),
                  ),
                )
              : null,
          ),
          h('input', {
            className: 'of-media-input',
            value: mediaPrompt,
            placeholder: mediaKind === 'voice' ? t('mediaVoicePlaceholder') : t('mediaPromptPlaceholder'),
            onChange: (e) => setMediaPrompt(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void makeMedia(); },
            disabled: mediaBusy || !installed,
          }),
          h(
            'button',
            { type: 'button', className: 'of-btn', onClick: () => void makeMedia(), disabled: mediaBusy || !mediaPrompt.trim() || !installed },
            mediaBusy ? t('mediaMaking') : t('mediaMake'),
          ),
        ),
        mediaResult
          ? h('div', { className: mediaResult.tone === 'ok' ? 'of-status-ok' : 'of-status-error' }, mediaResult.text)
          : null,

        // The film as a timeline: read on first open, one row per track.
        h(
          'button',
          {
            type: 'button',
            className: 'of-toggle',
            onClick: () => {
              const next = !timelineOpen;
              setTimelineOpen(next);
              if (next && !timeline) void loadTimeline();
            },
          },
          h('span', null, t('timelineToggle')),
          h('span', { className: 'of-badge' }, timeline ? `${timeline.facts?.clips ?? 0}` : '…'),
        ),
        timelineOpen && timeline
          ? renderTimeline(timeline, t)
          : null,
        timelineOpen && timeline && timeline.ok === false
          ? h('div', { className: 'of-status-error' }, (timeline.problems ?? []).slice(0, 3).map((p) => `L${p.line}: ${p.message}`).join('\n'))
          : null,

        // Background asset jobs: video generation against a busy queue.
        Array.isArray(status?.queue?.jobs) && status.queue.jobs.length > 0
          ? h(
              'div',
              { className: 'of-queue' },
              status.queue.jobs.slice(0, 3).map((job) =>
                h(
                  'div',
                  { className: 'of-queue-row', key: job.id },
                  h('span', { className: `of-badge ${job.state === 'done' ? 'of-badge-ok' : job.state === 'failed' || job.state === 'unknown_submission' ? 'of-badge-warn' : ''}` }, job.phase && job.phase !== 'created' ? `${job.state}/${job.phase}` : job.state),
                  h('span', { className: 'of-queue-prompt', title: job.lastError ?? '' }, `${job.provider ? job.provider + ' · ' : ''}${job.prompt}`),
                  job.result?.relative
                    ? h('span', { className: 'of-step-args' }, job.result.relative)
                    : ['queued', 'creating', 'running', 'downloading', 'waiting'].includes(job.state)
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'of-btn of-btn-small',
                            onClick: () => { void postJson('/mise/queue', { action: 'cancel', jobId: job.id, cwd: activeProject }).then(() => refresh()).catch(() => {}); },
                          },
                          t('cancel'),
                        )
                      : null,
                ),
              ),
              status.queue.pending ? h('div', { className: 'of-hint' }, t('queuePending')) : null,
            )
          : null,

        // The last delivery and what changed: the panel's own 对比 view, reading
        // the record the delivery tool wrote rather than re-deriving anything.
        delivery && delivery.output
          ? h(
              'div',
              { className: 'of-card of-sec-setup' },
              h('div', { className: 'of-compare-head' },
                h('span', null, t('lastDelivery')),
                h('span', { className: 'of-compare-file' }, delivery.output),
              ),
              h('div', { className: 'of-compare-meta' },
                h('span', { className: `of-chip${delivery.gate?.ok ? '' : ' of-chip-warn'}` }, delivery.gate?.ok ? t('gatePassed') : t('gateBlocked')),
                delivery.loudness?.integrated !== undefined
                  ? h('span', { className: 'of-chip' }, `${delivery.loudness.integrated} LUFS`)
                  : null,
              ),
              (delivery.changes ?? []).length
                ? h('div', { className: 'of-compare-list' },
                    delivery.changes.map((row) => h('button', {
                      type: 'button',
                      key: `${row.at}`,
                      className: 'of-compare-row',
                      title: t('drawStill'),
                      disabled: Boolean(busy),
                      onClick: () => void run(t('drawStill'), ['look', String(row.at)]),
                    },
                      h('span', { className: 'of-compare-shot' }, row.shot || `${row.at}s`),
                      h('span', { className: 'of-compare-at' }, `${row.at}s`),
                      h('span', { className: 'of-compare-pct' },
                        `${(row.changedPercent ?? 0) > 0 ? `${row.changedPercent}%` : `${row.brightnessBefore} → ${row.brightnessAfter}`}`),
                    )),
                  )
                : h('div', { className: 'of-hint' }, t('noChanges')),
            )
          : null,

        // Live progress: what the agent is doing right now, then its last steps.
        hasProgress
          ? h(
              'div',
              { className: 'of-card of-sec-setup' },
              progress.current
                ? h(
                    'div',
                    { className: 'of-current' },
                    h('span', { className: 'of-dot of-dot-live' }),
                    h('span', { className: 'of-current-text' }, `${t('working')} · ${progress.current.name}`),
                    progress.current.args ? h('span', { className: 'of-step-args' }, progress.current.args) : null,
                  )
                : h(
                    'div',
                    { className: 'of-current' },
                    h('span', { className: 'of-dot' }),
                    h('span', { className: 'of-current-text' }, t('idle')),
                  ),
              progress.recent.length > 0
                ? h(
                    'div',
                    { className: 'of-steps' },
                    progress.recent.map((step, index) =>
                      h(
                        'div',
                        { className: 'of-step', key: step.key ?? `s${index}` },
                        h('span', { className: `of-step-name of-tone-${step.tone}` }, step.name || '—'),
                        step.args ? h('span', { className: 'of-step-args' }, step.args) : null,
                        step.session ? h('span', { className: 'of-step-args' }, sessionTag(step.session)) : null,
                        step.ms > 0 ? h('span', { className: 'of-step-time' }, formatDuration(step.ms)) : null,
                      ),
                    ),
                  )
                : null,
            )
          : h('div', { className: 'of-hint' }, t('noProgress')),

        // Media-service keys, configured here so a person never leaves the panel.
        providers.length > 0
          ? h(
              'div',
              { className: 'of-card of-sec-setup' },
              h(
                'button',
                { type: 'button', className: 'of-toggle', onClick: () => setKeysOpen((open) => !open) },
                h('span', null, `${t('providers')} (${providers.filter((p) => p.configured).length}/${providers.length})`),
                h('span', null, keysOpen ? '−' : '+'),
              ),
              keysOpen
                ? h(
                    'div',
                    { className: 'of-providers' },
                    providers.map((provider) => {
                      const env = typeof provider?.env === 'string' ? provider.env : '';
                      if (!env) return null;
                      const declared = Array.isArray(provider?.caps) ? provider.caps : [];
                      const caps = declared
                        .map((id) => (CAP_LABELS[id] ? t(CAP_LABELS[id]) : String(id)))
                        .filter(Boolean)
                        .join(' / ');
                      return h(
                        'div',
                        { className: 'of-provider', key: env },
                        h('span', { className: 'of-provider-name' }, env),
                        h('span', { className: 'of-provider-caps' }, caps || t('capUnknown')),
                        provider.configured
                          ? h(
                              'span',
                              { className: 'of-badge of-badge-ok' },
                              confirmRemove === env
                                ? h(
                                    'span',
                                    { style: { display: 'inline-flex', gap: '6px' } },
                                    h(
                                      'button',
                                      {
                                        type: 'button',
                                        className: 'of-btn',
                                        onClick: () => void removeKey(env),
                                        disabled: busy !== null,
                                      },
                                      t('confirmRemove'),
                                    ),
                                    h(
                                      'button',
                                      { type: 'button', className: 'of-btn', onClick: () => setConfirmRemove(null) },
                                      t('cancel'),
                                    ),
                                  )
                                : h(
                                    'button',
                                    { type: 'button', className: 'of-btn', onClick: () => setConfirmRemove(env) },
                                    t('remove'),
                                  ),
                            )
                          : h(
                              'span',
                              { style: { display: 'inline-flex', gap: '6px', flex: '1 1 170px', minWidth: 0 } },
                              h('input', {
                                className: 'of-provider-key',
                                type: 'password',
                                value: keyDrafts[env] ?? '',
                                placeholder: t('keyPlaceholder'),
                                onChange: (event) => {
                                  const next = event?.target?.value ?? '';
                                  setKeyDrafts((drafts) => ({ ...drafts, [env]: next }));
                                },
                              }),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'of-btn',
                                  onClick: () => void saveKey(env),
                                  disabled: busy !== null || !(keyDrafts[env] ?? '').trim(),
                                },
                                t('save'),
                              ),
                            ),
                      );
                    }),
                    h('div', { className: 'of-hint' }, t('providersHint')),
                  )
                : null,
            )
          : null,

        // Style skills, listed last: they are reference material, not controls.
        styles.length > 0
          ? h(
              'div',
              { className: 'of-card of-sec-setup' },
              h(
                'button',
                { type: 'button', className: 'of-toggle', onClick: () => setStylesOpen((open) => !open) },
                h('span', null, `${t('styles')} (${styles.length})`),
                h('span', null, stylesOpen ? '−' : '+'),
              ),
              stylesOpen
                ? h(
                    'div',
                    { className: 'of-styles' },
                    styles.map((name) => h('span', { className: 'of-style', key: name }, `openfilm-${name}`)),
                    h('div', { className: 'of-hint' }, t('stylesHint')),
                  )
                : null,
            )
          : null,

        result ? h('pre', { className: `of-output of-sec-setup ${result.tone === 'error' ? 'of-status-error' : 'of-status-ok'}` }, result.text) : null,
      );
      } catch (error) {
        return h(
          'div',
          { className: 'of-dock' },
          h('div', { className: 'of-dock-title' }, filmIcon(16), h('span', null, t('title'))),
          h('div', { className: 'of-status-error' }, `panel error: ${error && error.message ? error.message : String(error)}`),
          h('div', { className: 'of-hint' }, `status ${status ? 'loaded' : 'missing'} · beats ${Array.isArray(status?.storyboard?.beats) ? status.storyboard.beats.length : 'none'}`),
        );
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dicts), 'dsh-openfilm: dictionaries');
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.plugin = PLUGIN_ID;
          style.dataset.pluginCss = 'dsh-openfilm/panel';
          style.textContent = css;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-openfilm: styles');

        const t = ctx.locale.bind(NS);

        // One identity for both seats: the sidebar row's id is handed verbatim
        // to layout.selectPanel(id), and the main panel is keyed by that same
        // id. Two different values render a row that selects nothing — the
        // earlier "click does nothing" defect — so both sides read the one
        // PANEL_ID constant and cannot drift apart.
        const PANEL_ID = 'openfilm';

        // Sidebar rail row: the clapperboard mark selects the panel below.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 90,
              // Matches the neighbouring rows (插件 / 自动化任务 / 技能中心).
              label: () => t('title'),
              inject: () => ({ t }),
            },
            () => filmIcon(20),
          ),
        );

        // The panel itself, in the main column.
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              inject: () => ({ t }),
            },
            () => h(OpenFilmPanel, { t, inject: {} }),
          ),
        );
      },
    };
  },
});
