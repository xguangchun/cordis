# packages/core - Cordis 框架内核

#必须遵守规则
使用中文回答

## 目录是什么

本目录是 **Cordis（cordis 包，v4.0.0-rc.8）** 的源码，即插件框架内核。DeepSeek Harness 以 vendor 方式引入本仓库作为其底层插件框架。

Cordis 是"元框架"：它本身不提供业务能力，只提供**插件化 + 依赖注入 + 事件分发 + 可逆副作用**四个机制，让上层（如 DeepSeek Harness）以插件方式组织 Service 能力（tools、llm、sessions、agents 等）。

## 发布与依赖

- `package.json`：`name: cordis`，`type: module`，ESM-only，构建产物在 `lib/`。
- 运行时依赖仅 `cosmokit`（工具集）与 `@standard-schema/spec`（配置校验）。
- `peerDependencies`：`@cordisjs/plugin-include`、`@cordisjs/plugin-loader`（均为可选），它们属于 loader 层，不在本包实现。
- 仓库为 yarn workspace monorepo；测试用 vitest（`yarn test`，经 yakumo 转发）。

## 核心概念 → 代码映射

| 概念 | 实现 |
|---|---|
| 上下文（服务容器） | `Context`（[context.ts](src/context.ts)），本质是 **Proxy** |
| 插件（实现服务的对象） | `Plugin` 类型 + `RegistryService`（[registry.ts](src/registry.ts)） |
| 插件生命周期 | `Fiber`（[fiber.ts](src/fiber.ts)） |
| 事件通信 | `EventsService`（[events.ts](src/events.ts)） |
| 服务按 key 查找 | `ReflectService`（[reflect.ts](src/reflect.ts)） |
| Service 基类 | `Service`（[service.ts](src/service.ts)） |
| 日志 | `LoggerService`（[logger.ts](src/logger.ts)） |
| 内部工具 | [utils.ts](src/utils.ts) |

`src/index.ts` 从 `./context` `./events` `./fiber` `./logger` `./registry` `./service` `./utils` 全量导出，`./reflect` 不直接导出（仅内部使用）。

## 各文件职责与关键机制

### context.ts - `Context`
- `new Context()` 创建 `Proxy<Context>`，持有 `events / logger / reflect / registry / fiber` 五个服务与默认 `root`。
- **扩展子系统**：`extend(meta)` 创建子上下文；`isolate(name, label)` 建立隔离域（同名服务在不同 isolate 下互不可见）；`intercept(name, config)` 覆盖服务的默认配置。
- 动态属性访问全部走 `ReflectService.handler` 这个 Proxy（见 reflect.ts），因此 `ctx.anyKey` 不是普通对象访问。

### registry.ts - 插件注册
- `Plugin` 三形态：函数、`new` 构造器、带 `apply` 的对象；`Plugin.Base` 上可声明 `inject` / `provide` / `Config`（Standard Schema）/ `intercept`。
- `ctx.plugin(plugin, config)`：注册到 `_internal` Map，创建 `Fiber` 并开始执行；返回值是 `Fiber & PromiseLike<Fiber>`。
- `ctx.inject(deps, callback)`：不提供能力、只声明依赖的插件，即"等待依赖就绪再执行"的语法糖。
- `@Inject()` 装饰器：用于类/类方法，把依赖声明挂到 `inject` 或 `symbols.initHooks`。
- `Inject.resolve()` 合并依赖表，注意 `symbols.checkProto` 标记的类继承场景。

### fiber.ts - `Fiber`（插件的执行单元）
- 每个插件实例对应一个 Fiber。状态机：`PENDING → LOADING → ACTIVE → FAILED → UNLOADING → DISPOSED`。
- **注入就绪机制**：Fiber 的 `inject` 依赖全部在 reflect.store 中可解析时，epoch 才变为 ACTIVE；`_checkImpl` + `_refresh` + `_setEpoch` 驱动启动/卸载/重载。注入依赖的服务被 provide/remove 时通过 `notify` 触发所有相关 Fiber 刷新。
- **`ctx.effect(execute, label)`**：混入到 ctx 上的副作用注册原语。`execute` 返回 disposer（函数）、可迭代对象、Promise 或 async iterable；dispose 时**逆序**逐个调用。所有注册（事件、provide、mixin、exporter……）底层都是 effect。
- 配置校验：`resolveConfig` 用 `runtime.Config['~standard'].validate(config)`；异步校验不支持；失败抛 `ValidationError`。
- `Fiber.await()` 等待加载完成；`update(config)` 先走 `internal/update` waterfall 再 `restart`；`restart()` 即卸载→重载循环。
- `FiberState` 变更会 emit `internal/status`。

### events.ts - 事件系统
- ctx 混入：`on / once / emit / parallel / serial / bail / waterfall`，另有 thisArg 重载。
- **分发模式**：`emit`（观察，不 await）、`parallel`（并行、聚合异常）、`serial`（按顺序、首个非空结果短路）、`bail`（同步短路）、`waterfall`（中间件，`next` 委托下游）。
- `isBailed(value)`：`value !== null && value !== false && value !== undefined` 即短路。
- 监听器通过 `register` 注册到对应把 Fiber effect 上，dispose 时可逆卸载。
- **事件类型声明合并**：事件名在 `Events` 接口中用 `declare module './context'` 声明，新事件通过 TS 声明合并注册，分发模式即公开约定。
- `internal/` 前缀是一批内部事件（plugin/status/service/update/get/set/listener/dispatch），功能上协作，阅读时注意区分。

### reflect.ts - 服务反射层
- `Context` 的 Proxy handler 就在这里：`get / set / has` 全部被拦截。
- **约定**：符号、`prototype`/`then`、纯数字字符串、`_` 开头的属性视为特殊属性直接反射，其余走服务解析。
- `ctx.get(name)`/`ctx.set(name, value)` 按当前上下文的 `symbols.isolate` 键解析到具体实现；`ctx.provide(name, value, check)` 注册服务实现（可逆），并 `notify` 依赖它的 Fiber 重新 `_refresh`。
- `ctx.accessor(name, options)` / `ctx.mixin(source, keys)`：声明式属性与把服务方法混入 ctx（如 `ctx.on` = `events.on`）。
- 访问未注入且未提供的属性会抛 `cannot get property "X" without inject`；在隔离域外访问会报 `cannot get required service "X" in inactive context`。
- `bind()` 返回 traceable 包装，确保回调内 `this.ctx` 指向调用方上下文。

### service.ts - `Service` 基类
- 抽象基类：子类 `constructor(ctx, name)` 自动 `ctx.reflect.provide(name, self, check)`，使服务占据 `ctx.<name>`。
- `[symbols.invoke]` 存在时服务可调用（callable，如 `ctx.logger('foo')`）；`[symbols.extend]` 用于派生代理。
- `[symbols.resolveConfig]`：沿 intercept 链合并服务配置（含 Config.merge）。
- `Symbol.hasInstance` 跨原型判断实例属于哪个 Service。

### logger.ts - 日志
- `ctx.logger` 是 callable 服务：`ctx.logger(name?)` 返回带名字的 `Logger`；不传时以当前 fiber 名推断。
- 支持 `error/info/warn/debug`、等级过滤（`intercept` 可配 `level`），exporter/formatter 可插拔，默认 1000 条环形 buffer，消息带 `WeakRef<Fiber>`。
- 错误对象会自动展开 `cause` / `AggregateError.errors`。

### utils.ts - 内部工具
- `symbols`：全部内部符号集中定义（`Symbol.for('cordis.*')`）。
- `createTraceable` / `getTraceable` / `Tracker`：**可追踪代理**。服务实例的属性访问会被重定向到"当前调用者上下文"，使 `this.ctx` 在任意深度的调用中都指向正确的插件上下文；这是 `this.ctx` 魔法的基础。
- `DisposableList`：可逆注册表（push 返回 remove 函数，clear 逆序返回）。
- `composeError` / `buildOuterStack`：为 effect 到插件调用点补充调用栈（长堆栈跟踪）。
- `createCallable` / `joinPrototype` / `isConstructor` / `withProps`：辅助 Service 可调用化与原型拼接。

### bin.js - CLI 入口
`yarn cordis`：创建 `Context`，挂 `@cordisjs/plugin-loader`，加载当前目录 `cordis.yml`。本包自身的服务端使用。

## 修改本目录代码的约定

1. **ctx 是 Proxy**：动态属性读取会解析到服务实现，不要在单元测试/工具里按普通对象读 ctx 属性。
2. **一切副作用走 effect**：新增监听器、provide、mixin、task 都要在某个 Fiber 的 effect 里注册并返回 disposer，保证 reload/teardown 时可逆；同一 effect 内的 disposer 顺序即 teardown 顺序。
3. **新事件要声明合并**：在对应的 `declare module` 中扩展 `Events` 接口，并注明分发模式；只用 `emit/parallel/serial/bail/waterfall` 中对应的一种分发。
4. **新服务＝子类化 `Service`（或注册 `provide`）**：上游插件通过 key 查找，不要互相 import 具体类。
5. **internal symbols 复用**：新增内部属性时优先扩展 `symbols`，不要用字符串魔法键。
6. 不要破坏 `lib/` 之外的行为；改 API 时同步更新对应 spec 测试。

## 测试

- `tests/` 下为 vitest spec，覆盖：event（分发模式）、fiber（生命周期/effect）、service（提供/注入）、associate、decorator（@Inject）、dispose、invoke、isolate、logger、plugin、reflect、shadow。
- 运行：仓库根 `yarn test`；本包 `yarn test packages/core`。
- 通用测试工具在 `tests/utils.ts`（如 `Filter`、`Session`、`event`）。