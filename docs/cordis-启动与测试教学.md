# Cordis 启动与测试 · 教学文档

> 适用环境：Windows + PowerShell（沙盒限制下的实际落地版）
> 教学对象：第一次接触本仓库，想把它跑起来并确认环境可用的人

## 0. 背景知识

本仓库是 **Cordis** 插件框架源码（monorepo），DeepSeek Harness 以 vendor 方式引入它作为底层插件框架。

Cordis 的四个核心概念（也是你验证环境时需要理解的）：

| 概念 | 一句话 |
|---|---|
| Context | 服务容器，`ctx.<key>` 就是服务的家 |
| 插件 | 实现/使用服务的对象，通过 `ctx.plugin(plugin)` 挂载 |
| inject | 插件先声明依赖的服务，就绪后才会启动 |
| 事件 | `on` 注册监听，`emit/waterfall/parallel/serial` 四种方式分发 |

---

## 第一部分：从零启动与测试

### Step 1 — 确认环境

```powershell
node -v        # 需要 >= 20（本仓库要求 Node 20）
yarn -v        # 需要 yarn 4（项目 packageManager: yarn@4.14.1）
```

> **坑 1**：本机没有全局 `yarn`。yarn 4 一般由 Node 自带的 **corepack** 管理。
> 但沙盒禁止写 `C:\Users\<user>\AppData\Local\node`，而 corepack 默认把 yarn 下载到那里。

### Step 2 — 解决 corepack 的沙盒限制

把 corepack 缓存目录指到项目内（可写路径）：

```powershell
$env:COREPACK_HOME = "D:\xuexi\cordis\.corepack"
corepack yarn --version
```

> **坑 2**：corepack 拉下来的 `yarn.js` 在某些环境会被 Node 当成 ESM 加载，报
> `Error: Dynamic require of "util" is not supported`。解决办法是复制成 `.cjs` 强制按 CJS 运行：

```powershell
Copy-Item D:\xuexi\cordis\.corepack\v1\yarn\4.14.1\yarn.js D:\xuexi\cordis\.corepack\yarn.cjs
node D:\xuexi\cordis\.corepack\yarn.cjs --version   # 输出 4.14.1 即成功
```

> **结论**：本仓库之后所有 `yarn <命令>` 都统一写成 `node .corepack\yarn.cjs <命令>`。

### Step 3 — 安装依赖

```powershell
node D:\xuexi\cordis\.corepack\yarn.cjs install
```

预期输出（约 2~3 分钟）：
- `455 packages were added to the project (+ 172.95 MiB)`
- 结尾 `Done with warnings` 可接受（esbuild 等包的 postinstall 脚本被沙盒禁用，
  但 esbuild 的平台二进制已随包自带，不影响构建）

### Step 4 — 构建全部包

```powershell
node D:\xuexi\cordis\.corepack\yarn.cjs build
# 等价于分开执行：
#   node --expose-internals --import tsx --import @cordisjs/unyaml node_modules/yakumo/lib/cli.js esbuild
#   node --expose-internals --import tsx --import @cordisjs/unyaml node_modules/yakumo/lib/cli.js tsc
```

预期：
- `esbuild` 阶段：`packages/core/src/index.ts -> packages/core/lib/index.js` 等全部包打包成功
- `tsc` 阶段：**已知类型报错**集中在 `packages/include`、`packages/hmr`（它们调用本地 core 的 API 与
  自己期望的 npm 发布版有版本差异），会输出 `.d.ts` 但退出码非 0。**不影响运行时产物**。

### Step 5 — 冒烟测试（最快验证核心库可运行）

```powershell
node --input-type=module -e "import { Context } from './packages/core/lib/index.js'; const ctx = new Context(); ctx.plugin(async (c) => { console.log('Cordis OK') });"
```

输出 `Cordis OK`（中文可能显示乱码，见下）即证明核心库可用。

### Step 6 — 三种运行方式

| 方式 | 命令 | 适合场景 |
|---|---|---|
| A. 跑全部测试 | `node --expose-internals --import tsx --import @cordisjs/unyaml node_modules/yakumo/lib/cli.js vitest --import tsx` | 验证整个环境 |
| B. 配置启动 | 写好 `cordis.yml` 后 `node packages/core/bin.js` | 以配置文件加载插件 |
| C. 编程方式 | `node demo.js`（见第二部分） | 学习核心概念 / 快速原型 |

> **小知识**：终端里中文输出乱码是 PowerShell 控制台代码页（GBK）渲染 UTF-8 的问题，
> 先 `chcp.com 65001 > $null` 可缓解；功能本身不受影响。

---

## 第二部分：本次会话操作指引（实录版）

这次会话把仓库从"装好环境"一路跑到"demo 跑通"，以下是每一步实际做了什么、为什么。

### 2.1 识别项目

- 阅读根 `package.json`、`packages/core/README.md` → 确认是 **Cordis v4.0.0-rc.8** 的 monorepo 源码。
- 将官方 [Cordis 入门指南](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer)
  的五个核心概念、四种分发模式、waterfall 语义、loader 配置、实践规则整理进根目录 `AGENTS.md`（每次会话自动加载，即"长期记忆"）。

### 2.2 安装依赖（踩坑记录）

1. `corepack yarn` 报 `EPERM mkdir C:\Users\java_mango\AppData\Local\node\corepack` → 沙盒限制写用户目录。
   **解决**：`$env:COREPACK_HOME = "D:\xuexi\cordis\.corepack"`。
2. 换目录后报 `Dynamic require of "util" is not supported` → yarn.js 被当 ESM 加载。
   **解决**：复制为 `.corepack\yarn.cjs`，用 `node ...yarn.cjs` 调用。
3. `node .corepack\yarn.cjs install` 成功：455 个包，耗时约 2m48s，esbuild postinstall 被禁（无碍）。

### 2.3 构建（踩坑记录）

- `esbuild` 全部成功，`packages/*/lib/*.js` 生成。
- `tsc` 报 `include` / `hmr` 两包的类型错误（如 `Property 'loader' does not exist on type 'Context'`、
  `Property 'entry' does not exist on type 'Fiber'`）——原因是本地 core 与这两个包期望的 API 存在版本差异。
  **结论**：是仓库自身的版本漂移，不影响构建产物与运行，可暂不处理。

### 2.4 编程方式启动（demo.js，两次修正的记录）

第一次运行 `node demo.js` 报错：

1. **`cannot get property "X" without inject` 类错误**（实际表现为 listener 内访问 `ctx.greet` 抛错）
   → Cordis 规则：**插件直接读取某个服务前必须先声明 `inject`**。
   **修正**：给 `pluginUser`、`pluginCli` 加上 `pluginX.inject = ['greet']`。

2. **`TypeError: next is not a function`**
   → `ctx.waterfall('translate', 'Cordis')` 的最后一个参数被当作"兜底执行函数"，导致参数错位。
   **修正**：`ctx.waterfall('translate', 'Cordis', (text) => \`Hello, ${text}!\`)`，
   监听器签名保持 `(参数, next)`，`next()` 委托下游。

最终运行输出（功能正常，中文乱码仅为显示问题）：

```
[plugin-user] 已启动，依赖的 greet 服务就绪      ← inject 生效
[event] 你好，Cordis！ / 你好，世界！              ← emit 事件分发
[waterfall] [wrap] Hello, Cordis!                 ← waterfall 中间件包装
[service] 你好，编程方式！                         ← 直接调用服务
```

### 2.5 知识要点回顾

- **读服务必须 inject**：`inject` 既是依赖声明，也是"允许读取"的门禁。顶层（root）ctx 同理不能随意读。
- **waterfall 签名**：`ctx.waterfall(event, ...args, fallbackFn)`，监听器 `(args..., next)`；
  最靠内的是最后一个监听器或 fallbackFn；不调 `next()` 直接返回即短路。
- **一切副作用可逆**：`ctx.effect(fn)` 注册副作用并返回 disposer，reload/teardown 时逆序撤销（demo 中 `effect` 的打印只是例证）。
- **构建产物**：所有包源码 `src/` → esbuild 产出 `lib/*.js`，运行时直接 import `lib/` 即可。

---

## 附录：常用命令速查

```powershell
# 安装 / 构建 / 测试（沙盒适配版）
node .corepack\yarn.cjs install
node .corepack\yarn.cjs build
node --expose-internals --import tsx --import @cordisjs/unyaml node_modules/yakumo/lib/cli.js vitest --import tsx

# 运行 demo
node demo.js
```