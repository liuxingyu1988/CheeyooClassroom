# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

OpenMAIC（Open Multi-Agent Interactive Classroom）——把一个主题或一组资料变成可交互的 AI 课堂：课件 slides、测验、HTML 交互仿真、PBL 项目式学习，由 AI 老师和 AI 同学讲课、画白板、实时讨论。

技术栈：Next.js 16（App Router）、React 19、TypeScript strict、pnpm workspace、Vercel AI SDK、LangGraph、PostgreSQL（裸 `pg`，无 ORM）、Zustand、i18next、Vitest + Playwright。

运行环境：Node >= 22.19，pnpm 10.28。`pnpm dev` 跑在 3000，E2E 跑在 3002。

> 本仓库是 [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 的 fork（`upstream` remote 指向官方仓库，`main` 当前与 `upstream/main` 同步）。PR 面向 `main`。
>
> 注意仓库内 README 的架构图有陈旧之处（例如它写的 `lib/generation/` 已不存在，生成逻辑在 `packages/@openmaic/generation`）。以实际代码为准。

## 语言约定

**工作语言是中文；代码、标识符、提交、PR 保持英文。**

具体到各处：

| 场景 | 语言 |
|---|---|
| 对话回复、需求讨论、方案说明 | 中文 |
| 文档正文（本文件、README、注释性说明、commit body 的解释性段落） | 中文 |
| 代码、函数/变量/类型/文件命名 | 英文 |
| 代码内注释 | 英文 |
| commit message 标题与类型前缀 | 英文（Conventional Commits 要求） |
| PR 标题与描述 | 英文 |

标识符一律英文，不要因为注释是中文就把变量名、文件名或 API 字段名写成拼音或中文。已有的中文标识符（如无）不要为了这条规则去重命名。

## 常用命令

```bash
pnpm install                 # postinstall 会构建全部 workspace 包并 sync importer
pnpm db:up                   # docker 起本地 PostgreSQL（127.0.0.1:5432，compose project: openmaic-dev-db）
pnpm db:down                 # 停止但保留数据
pnpm dev                     # 先构建 standalone player 再 next dev
pnpm build                   # 断言 vendor importer + 构建 standalone player + next build
pnpm start                   # 生产启动（要求 DATABASE_URL）

# 检查（与 CI 一致，四者无共享状态，可并行）
pnpm check                   # prettier --check
pnpm format                  # prettier --write
pnpm lint                    # eslint
pnpm lint --fix
npx tsc --noEmit
pnpm check:i18n-keys         # i18n key 完整性
pnpm check:node-engine
pnpm check:package-versions  # 发布包改动未升版本号时报错

# 测试
pnpm test                    # vitest run，954 个单测（tests/**/*.test.ts）
pnpm exec vitest run tests/<path>.test.ts          # 单个测试文件（CI 用的就是这个形式）
pnpm exec vitest run tests/<dir> -t "<test name>"  # 单个用例
TEST_LOAD_LOCAL_ENV=1 pnpm exec vitest run <suite>  # 默认不加载 .env.local，需要真实凭据时才开
pnpm --filter @openmaic/<pkg> test                # 包内测试（dsl / storage / generation / importer / editor / renderer）

# E2E
pnpm test:e2e                # playwright，spec 在 e2e/tests/*.spec.ts，只跑 Chromium，需要 DATABASE_URL
pnpm test:e2e:ui

# 其它
pnpm build:standalone-player # 改过 lib/standalone-player 后必须重跑，否则 HTML 导出用的是旧产物
pnpm eval:<name>              # eval/ 下的 LLM 质量评测，见下方警告
```

`render-service/` 是**独立的 npm 项目**（不在 pnpm workspace 内，也被根 tsconfig/eslint 排除），用自己的 `npm ci` + `npm run typecheck` + `npm test`。

## 架构

### 分层：从契约到播放

```
@openmaic/dsl        版本化的课程/幻灯片数据契约（纯类型 + 纯校验/归一化，零运行时依赖）
   ↓
@openmaic/renderer   React 渲染 slide DSL
@openmaic/editor     可组合的幻灯片编辑内核 + React 表面
@openmaic/importer   PPTX → OpenMAIC slide
@openmaic/generation 两段式生成流水线 + prompt 资产
@openmaic/storage    browser / HTTP / PostgreSQL / S3 持久化原语
```

依赖箭头必须保持无环。`@openmaic/dsl` 永远不能引入 React、pptx、echarts 之类运行时依赖。

**机器强制的边界**：ESLint 禁止 `@openmaic/renderer`、`@openmaic/storage`、`@openmaic/generation`、`lib/choreography`、`lib/video-export`、`lib/pbl/v2/operations/kernel` 引用宿主的 `@/...` 路径。包与宿主之间只能通过 props / 回调交互。`@openmaic/generation` 另有 import/reexport 白名单，并禁止一切 `ImportExpression` 和 `require()`。

### 数据契约与文档读写（最重要的一节）

`packages/@openmaic/dsl/src/` 是整个系统的 keystone：

- `stage.ts` / `slides.ts` —— 课程骨架 `Stage` / `Scene` / `SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl'`；`Scene` 是泛型，契约只管通用结构 + 四种持久化内容 kind + 扩展点。
- `action.ts` —— 播放动作 `Action` 联合类型（spotlight、speech、`wb_*`、`widget_*` 等）。
- `validate.ts` 的 `validate*` 只**报告**问题（`{valid, errors:[{path,message}]}`）；`normalize.ts` 的 `normalize*` **修复**文档（补默认值、推导几何、畸形输入直接失败）。
- `version.ts` —— `dslVersion` 与迁移注册表。DSL 版本独立于 npm 包版本，标识的是**已序列化文档**的形状。

改动 DSL 时：任何收窄已有文档合法范围的改动都是 breaking change，哪怕 diff 很小。

**读写一份课程文档的唯一正确姿势**（`lib/document-store/`，应用的接缝）：

- `store.ts` —— `getDocumentStore` / `configureDocumentStorage`
- `migration.ts` —— `mutateDocument` / `withDocumentLock` / `accessDocument`
- `validators.ts` —— `validateAppScene` / `validateAppStage`
- 持久化的聚合很小：`MaicDocument<Scene,Stage> = { stage, scenes[], outline?, dslVersion? }`，外加列表用的 `DocumentSummary`。

`lib/document-store/persistence-types.ts` 里的 `AppDocumentOutline` 带一个 **`producer: 'client' | 'server-job'`** 字段。`producer: 'server-job'` 是不变量：**浏览器永远不能author 服务端拥有的课程的 scene**。改课程内容优先走 `lib/api/stage-api*.ts`（agent 用的舞台 facade：`scene`/`element`/`canvas`/`navigation`/`whiteboard` 五个命名空间，幂等，返回显式成功/失败），不要直接改 store，更不要手写 JSON。

### 生成流水线

`packages/@openmaic/generation`（模型侧库）：`outline-generator.ts`（第一段：需求 → `SceneOutline[]`，带 `json-repair.ts`）、`scene-builder.ts`（`buildCompleteScene`）、`scene-generator.ts`、`outline-media.ts`、`pbl/`、以及随包发布的 prompt 资产。宿主侧 prompt 由 `lib/prompts/`（按 id 加载 markdown）提供。

1.2.0 起 generation 是**服务端 run**：关页面继续跑，重启后从 checkpoint 恢复，事件流推给所有打开的标签页，某步失败则暂停，Retry 只重跑那步。Web 端和 headless API 共用同一条流水线。

- `lib/server/generation/run/` —— 持久化引擎：`start.ts` → `store.ts`（Postgres 权威）→ `engine.ts`（步骤：research → outline → outline 确认 → agents → 逐场景内容 → actions → 旁白/TTS → 图片/视频），每步一个模块在 `lib/server/generation/steps/`。
- 数据表（`lib/persistence/generation-runs.ts`）：`generation_runs`（状态机 `preparing|outlining|awaiting_outline_confirmation|generating|paused|completed|ended` + 租约列）、`generation_run_steps`（可恢复 checkpoint）、`generation_run_events`（`seq` 有序）、`generation_run_commands`（幂等命令）。worker 用租约认领，每次写入都被 `lease_generation` 围栏，被接管的 worker 写不进去。
- `app/api/generation-runs/` —— `GET /[id]/events?after=<seq>` 是 **SSE 不是轮询**：按 `seq`（或 `Last-Event-ID`）补发积压事件 → 一帧 `caught_up` → 之后实时帧；事件被压缩过则发 `resync` 让客户端重载快照；另有 5s 兜底轮询和 Postgres `NOTIFY` 唤醒，单 owner 流过多返回 429。`GET /[id]` 是快照轮询。命令是 `confirm-outline` / `hold-outline` / `retry`。
- 客户端：`lib/generation-run-client/`（`use-generation-run`、`commands`、`reducer`、`run-course`）。
- `app/api/generate-classroom/` 只是薄门面：`{requirement, materialIds?}` → `startGenerationRun(...)`，返回 202 + job view，过载返回 429 `ACTIVE_RUN_LIMIT`。

`lib/chat/agent-loop.ts` 是另一条路径：浏览器驱动的多 agent 循环核心，无 React 依赖，前端 hook 和 eval harness 共用。

### Agent 与编排（两套，不要混淆）

- **`lib/server/agent-runtime/`** —— Pro workbench 的**持久化 runner**，主循环是 **`@earendil-works/pi-agent-core`**，不是 LangGraph、也不是 CopilotKit（`@copilotkit/*` 虽然是依赖，但持久化运行时不走它）。`runner.ts` 是租约协调的后台 `Session` 执行：任何进程都可能跑这个循环，Postgres 是认领、租约代次、事件顺序、取消的权威，没有客户端连接持有 session。工具由 `course-tools.ts`（`buildDslCourseToolset`）、`curriculum-tools.ts`、`material-tools.ts`、`roster-tools.ts`、`dsl-tools.ts`、`generation-tools.ts`、`import-pptx.ts`、`create-skill.ts` 等构建。写工具的清单只有一份：`lib/agent-runtime/stage-writer-tools.ts`，它们以 `sequential` 运行并在开始时抢占编辑器写权限；写入走 `document-writes.ts`（`putSceneBringingCurrent`、`DocumentVersionError` 守卫）和 `mutation-fence.ts`。API 在 `app/api/agent/`（sessions / events / messages / cancel / skills）与 `app/api/agents/`。
- **`lib/orchestration/`** —— 课堂内多 agent 讨论的调度，是个小的 LangGraph `StateGraph`（`director-graph.ts`：director → agent_generate），经 `ai-sdk-adapter.ts` 流式输出，另有 `registry/`（agent 预设）和 `summarizers/`。它是无状态的。

### 播放与动作

- `lib/playback/` —— 播放状态机（idle → playing → live）：`engine.ts`、`derived-state.ts`、`action-navigation.ts`、`action-resume.ts`。
- `lib/action/engine.ts` —— 执行 `Action` 联合类型的动作（speech、白板 draw/text/shape/chart、spotlight、laser 等）。

### 持久化与所有权

课程存在服务端 PostgreSQL，浏览器只保留属于设备的东西（设置、播放位置、缓存）。**Settings → Clear Local Cache 不碰服务端。**

- `@openmaic/storage` 提供可替换的 document / runtime / KV / asset / agent-session / material / skill store，每个原语有 `browser.ts` / `http.ts` / `pg` 导出路径（`./document/pg`、`./asset/s3-bytes` …）。PostgreSQL 是参考实现；HTTP 契约允许外接任意存储服务，且对请求设了截止时间（`requestTimeoutMs`，默认 30s）。
- **没有裸的 document store**：文档只能通过 `lib/persistence/owner-bound-document-store.ts` 走。`schema-stores.ts` 的 `APP_SCHEMA_STORES` 列出全部迁移集的 bootstrap 顺序。
- **每个请求都解析出一个 owner**，每个 owner 一份独立的库。身份模式：`OWNER_SINGLE_USER=true`（单用户）/ `PERSISTENCE_SHARED_OWNER_ID`（团队）/ 默认按浏览器 cookie 的匿名 / `instrumentation.ts` 注册的账号鉴权。匿名工作可用 `POST /api/identity/claim` 并入账号。
- 跨设备同步靠 `app/api/persistence/`（嵌入式持久化服务的 HTTP 契约）；浏览器侧由 `lib/persistence/bootstrap.ts` 指向 `HttpDocumentStore` / `HttpAssetStore`，并从 `/api/persistence/learner-key` 取 learner key。
- 媒体：`app/api/classroom-media/` 会先查课程生命周期，已删除的课程返回与文件缺失相同的 404；响应是 `private, max-age=300, must-revalidate`（不是 public/immutable）。字节存储还有 `ASSET_*` 配额与 S3 出口设置。
- 共享部署的站点级密码 `ACCESS_CODE`（至少 16 位随机字符）由 `middleware.ts` 拦截：cookie 是 **HMAC 校验**的而非仅查存在；API 无有效 cookie 返回 401 JSON，页面放行由前端弹窗。**未配置 ACCESS_CODE 时不设防，没有第二处强制点。** 单 owner 持有的流过多会 429。

### 模型配置

模型在服务端配一次，不是每个浏览器各配一套。

- `cheeyoo.yml`（从 `cheeyoo.example.yml` 复制）声明 `providers` / `slots` / `lock` / `allowUserKeys`。capability slot 有 `llm`（含 `course.*`、`classroom`、`agent`）、`tts`、`asr`、`image`、`video`、`webSearch`、`document`。密钥留在环境里，以 `${VAR}` 引用。**校验失败会让服务器启动失败**并指出确切位置（变量未设、未知 preset/slot、引用了未声明的 provider）。
- 服务端托管凭据的 provider，**provider 里的 `models` 是授权白名单**——只有列表里的模型 id 加上部署默认/回退和 slot 引用被授权，预置目录里的模型不隐式授权；它同时影响连接测试。无凭据的本地 provider（Ollama、Lemonade）不受限，但别拿无 key 的网关去接自带上游凭据的服务。缺列表时启动会告警指出该改哪个配置项。
- `lib/ai/providers.ts` 是统一 provider 抽象（基于 Vercel AI SDK），另有 `model-aliases.ts` / `model-fallbacks.ts` / `thinking-config.ts`。
- 密钥以加密形式存在服务端（`OPENMAIC_SECRET_KEY`，未设置时首次启动生成到 `data/instance-secret.key`），**永不下发到浏览器**。
- `agent` slot 需要支持 tool calling 的模型，且**不能**设 `thinking.effort`。

### 路由面

用户入口：`app/page.tsx`（首页/生成）、`app/workspace/`（Pro workspace，受 workbench 双开关门禁）、`app/workbench/new`（仅是历史 `?prompt=&skill=` 链接的兼容重定向，本身无 UI）、`app/classroom/[id]/`（课堂播放与编辑）、`app/generation-preview/`（服务端 run 的实时视图：流式步骤/outline/agents，发 confirm-outline / retry，run 在后台继续）、`app/eval/whiteboard`。

`app/api/` 按域分：`generation-runs`、`stages`/`stage-meta`、`generate`、`generate-classroom`、`chat`、`agent`/`agents`、`persistence`、`materials`、`folders`、`export-video`、`pbl`、`quiz-grade`、`transcription`、`parse-pdf`、`identity`、`access-code`、`skills`、`model-config`/`server-providers`/`provider`、`verify-*`（provider 连通性冒烟）、`usage`、`proxy-media`、`azure-voices`、`comfyui-workflows`、`health`。

`middleware.ts` 负责公共门面：ACCESS_CODE 校验、workbench 门禁（Edge 读不到 server-only 变量，所以完整检查交给 Node，Edge 只做公开门面）、以及给匿名 owner 下发 cookie 并**转发到请求头**，保证页面和它发出的每个请求解析出同一个 owner。

### 导出与渲染

- `lib/export/` —— PPTX 与 HTML 导出；HTML 导出用 `lib/standalone-player` 构建的独立播放器，`pnpm dev`/`pnpm build` 各构建一次，**改动后不会自动重建**。
- `lib/video-export/` —— **纯编译器**：`compileVideoTimeline` → `VideoTimeline` IR（`ir.ts`），一系列 `passes/`（normalize、probe、timeline、visuals、interactive、reflow、geometry、assets）、字幕处理、`emit-hyperframes/`（字体、KaTeX、quiz 脚本）。ESLint 禁止它引用 `@/`、React/DOM、FFmpeg。`emitManifest` 用 zod 校验。
- `lib/video-export-app/` —— 应用侧的有状态接线。`build-export-zip.ts` 是两条下载路径的共同前缀（编译 IR → Hyperframes project → 收集资源 → ZIP）：`use-export-video.ts` 下载 ZIP，`use-render-video.ts` 上传它渲染 MP4。两者都调 `buildExportZip`，所以不会漂移。
- `app/api/export-video/render/` —— 把 multipart ZIP 代理给渲染服务（`lib/server/render-service.ts`），流式转发 body 且不解析，300 MB 上限；未配置时返回 501，客户端降级为 ZIP 下载。**渲染作业绑定请求者 owner**，app 与 render-service 必须一起升级；新旧版本混跑会通过独立的 owner 命名空间 fail closed。预览并发受 render resource profile 限制，由 `/api/health` 上报。
- `render-service/` —— 独立服务（`@openmaic/render-service`，Hono + Node 22 + `puppeteer-core` + FFmpeg），自己的 Dockerfile 和 npm lockfile。解压上传的工程、分块渲染、对不可信 HTML 做 sanitize（CSP、`project-html-hardening.ts`）、作业与产物存储、预览，以及独立的多租户资源守护进程模式（`resource-main.ts`）。
- ⚠️ **版本偏移**：`render-service/package.json` 钉的是**已发布的** `@openmaic/dsl@0.11.0` / `@openmaic/renderer@0.1.4`，而 workspace 里已经是 0.11.3 / 0.1.13。改 slide/scene 类型前先确认这个钉版本，否则渲染服务会静默接受不了新形状。

## 前端约定

- **状态**：Zustand，store 在 `lib/store/`（`stage.ts` 是课件舞台状态，`canvas.ts` 只管 UI 态——选择、视口、工具栏——**不含** slide 数据；后者在 scene context 里）。immer 在状态层只出现一次：`lib/contexts/scene-context.tsx` 的 `produce`。
- **新增 store 必须套 `createSelectors`**（`lib/utils/create-selectors.ts`）：`export const useXStore = createSelectors(useXStoreBase)`，组件用 `useStageStore.use.scenes()` 而不是解构整个 store。`lib/store/index.ts` 只 re-export 五个核心 store，其余按路径直接 import。
- **持久化**：只有 `lib/store/settings.ts` 和 `user-profile.ts` 用 `persist`，且都走 `lib/store/kv-persist.ts` —— 它是 `@openmaic/storage` 的 `KVStore` 之上的应用层适配器，**不是** zustand 默认的 `localStorage`。它把异步后端失败建模成显式的 Outcome/KeyState 状态机（"读失败不等于不存在"），并按 `device`（不出机器）/ `account`（可服务端同步）标注作用域。别绕过它。
- **Context**：`lib/contexts/scene-context.tsx`（`SceneProvider` / `useSceneData` / `useSceneSelector`，支持 `controller` prop 让编辑面走私有 undo/redo 而不写 live stage store）、`media-stage-context.tsx`。
- **Hooks**：`lib/hooks/`，全部 `'use client'`，按功能命名。
- **i18n**：`lib/i18n/`，i18next + lazy `resources-to-backend`，12 个 locale 在 `lib/i18n/locales/*.json`，注册表在 `locales.ts`，默认 `zh-CN`。**所有面向用户的文案必须走 i18n，不得硬编码**；新 key 要加到全部 12 个文件（`pnpm check:i18n-keys` 会逐一比对 `en-US.json`，且禁止数组和空对象）。插值用 i18next 默认的 `{{variable}}`。workbench 聊天文案是特例：放在 `lib/i18n/workbench.ts`（zh/en 的 TS map，合并进 `workbench.*` 命名空间，覆盖层在 `workbench-locales/*.json`），因为那些是拿不到 hook 的纯展示函数。新增语言的步骤见 `lib/i18n/TRANSLATION_GUIDE.md`——注意 `supportedLocales` 只能追加不能重排，每种语言前缀的第一个 locale 是裸语言码的默认值。
- **组件**：`components/` 按功能而非类型分组（`edit/`、`stage/`、`workbench/`、`canvas/`、`agent/`、`classroom/`、`scene-renderers/`、`slide-renderer/`、`generation/`、`roundtable/`、`whiteboard/`、`ai-elements/`）。基础件在 `components/ui/`（shadcn/ui，style `radix-vega`，Tailwind v4 + CSS 变量；`combobox.tsx` 用 `@base-ui/react`，其余用 Radix）。
- **路径别名**：`@/*` → 仓库根（tsconfig paths）。注意根 tsconfig **排除** `packages/*/src`、`packages/docs`、`e2e`、`render-service`，所以那些目录要用各自的配置单独检查。

## LLM 调用约定（强制）

**不要直接从 `ai` 包 import `generateText` / `streamText`**，静态 import、`import('ai')` 动态 import、模板字符串形式的动态 import 全部被 ESLint 禁止。走 `callLLM` / `streamLLM`（`lib/ai/llm.ts`）——只有那里做用量统计、`LLM_THINKING_DISABLED` 紧急开关和按 provider 的 thinking 解析。两个 wrapper 会原样透传所有 SDK 选项，并接受可选的 per-call thinking 配置。

例外仅限 `lib/ai/llm.ts`、`eval/**`、`tests/**`。这个范围由 `tests/lint-llm-entry-guard.test.ts` 钉死，不能再收窄。改动 ESLint 里这条规则时注意：flat config 是**替换**而非合并 `no-restricted-syntax` 的选项，所以常量 `AI_SDK_DYNAMIC_IMPORT_BAN` 是 spread 进每一个设置了该规则的 block 里的，要一起改。

## 测试

- **单测**：`tests/` 目录**镜像 `lib/` 的结构**（`tests/playback/`、`tests/orchestration/`…），另有 `tests/fixtures/`、`tests/helpers/` 和跨领域的根级文件。`vitest.config.ts` 只 include `tests/**/*.test.ts`。
- **默认 hermetic**：suite 不加载 `.env.local`（CI 根本没有这个文件，依赖它的测试在那里必然是红的）。需要真实凭据时用 `TEST_LOAD_LOCAL_ENV=1` 显式开启。
- 两个依赖浏览器的 suite 用环境变量开启：`tests/video-export/*.browser.test.ts` 需要 `COVER_LAYOUT_BROWSER=1` / `INTERACTIVE_STATIC_BROWSER=1`，它们和单测放在一起但只在浏览器 job 里跑。
- `vitest.eval.config.ts`（include `*.eval.test.ts`）目前**没有匹配的测试文件**，也没有 npm 脚本调用它——eval harness 的测试现在是以普通 `*.test.ts` 放在 `tests/eval/` 下，跑在默认 suite 里。
- **E2E**：`e2e/tests/*.spec.ts`，只跑 Chromium，通过 `e2e/fixtures/server-seed.ts` 走应用自己的持久化端点播种（每个 spec 用全新 id），需要 `DATABASE_URL`。page object 在 `e2e/pages/`。
- **eval/**：不是测试，是 LLM 质量评测（`pnpm eval:*`）。每个子目录有自己的 `runner.ts`（tsx 执行）、`scenarios/`、`judge.ts`、`reporter.ts`，调真实模型、按变体采样 N 次、打分并把 markdown 报告写到 `eval/<name>/results/<model>/<timestamp>/report.md`，用非零退出码当回归门禁。**它们会花钱并打到真实 provider，不要随手跑。** 改了 prompt 或编排才跑。

## 发布包

`packages/@openmaic/` 下**全部六个**包都发布到 npm：`dsl`、`storage`、`renderer`、`importer`、`editor`、`generation`（`.github/workflows/publish-packages.yml` 是权威；CONTRIBUTING.md 里说"四个"已过时）。仓库内以 `workspace:*` 消费。

| 包 | 版本 | 职责 |
|---|---|---|
| `@openmaic/dsl` | 0.11.3 | 纯依赖的 slide 契约：类型 + JSON Schema + 校验器 + 版本迁移。导出 `.` 和 `./schema/*` |
| `@openmaic/storage` | 0.37.3 | 可插拔持久化：document / runtime / kv / asset / agent-session / skill / material，含 pg 迁移 |
| `@openmaic/renderer` | 0.1.13 | PPTist 风格 Slide JSON 的 React 渲染器 + 元素库 + 字体 CSS + 几何工具 |
| `@openmaic/importer` | 0.3.1 | `.pptx` → Slide JSON 解析器（rollup 打包，`src1/` 是 vendored 第三方 JS） |
| `@openmaic/editor` | 0.0.11 | 可组合的幻灯片编辑内核 + React 表面 + UI，导出 `.`/`./core`/`./react`/`./ui` |
| `@openmaic/generation` | 0.3.18 | 无头生成流水线：outline/scene/content builder、prompt、JSON 修复。导出 `.` 和 `./browser` |

另有 `packages/mathml2omml`（MathML → OMML）和 `packages/pptxgenjs`（PPTX writer 的 fork），二者也发布。

**改了这些包里会进 tarball 的文件，必须在同一个 PR 里升该包的 `version`**，否则 CI 报 `publishable package inputs changed but version did not increase`。哪些算 publishable 见 `scripts/check-package-version-bumps.mjs`（`docs/`、`test/`、`vitest.config.ts` 不算）。

版本号是 semver 判断：`patch` 不改变已文档化的行为；`minor` 新增行为且不影响现有使用者；`major` 现有使用者必须响应。`1.0.0` 以下按 0.x 惯例——`minor` 表示破坏性变更。你自己不发布；合并后 CI 自动发布并打 `@openmaic/<name>@<version>` tag（tag 只是标记，不是触发器）。

## 其它约束

- `scripts/sync-maic-importer.mjs` 把 `packages/@openmaic/importer/dist` 复制到 `public/vendor/maic-importer`——因为 bundle 里有 pdfjs-dist 的动态 `require()`，Turbopack 会直接报硬解析错误，所以应用改成按 URL 运行时 import，类型仍来自 workspace 包。`pnpm build` 开头的 `scripts/assert-vendor-maic-importer.mjs` 会 stat 这个产物并在缺失/为空时让构建失败，避免跳过 postinstall 的部署上线后 PPTX 导入 404（404 的 HTML 被当 JS 解析会变成难以定位的 SyntaxError）。
- Prettier：printWidth 100、单引号、分号、trailing comma all、LF、2 空格。
- 提交信息走 Conventional Commits，scope 用领域名（`feat(tts):`、`fix(whiteboard):`）。每个 PR 必须关联 issue（`Closes #123`）。
- 新增/重命名面向运维的环境变量时，同一个 PR 里更新 `.env.example`，写清是否可选、默认值、构建期还是运行期读取。
- `packages/docs/` 是独立的文档子应用（自己的 lockfile 和构建部署，从 workspace 显式排除），`.zh-cn.mdx` 等多语言文档要同步更新。
- AI 辅助的 PR 需要在标题或描述里标注，并**先自行跑一遍 AI code review 并处理发现**，再请求人工评审。
