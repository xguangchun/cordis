#必须遵守规则
使用中文回答

# 长期记忆：Cordis 入门指南

来源：https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer
（DeepSeek Harness 底层以 vendor 方式引入的插件框架，本仓库即其源码。）

## 五个核心概念

1. **插件是实现 Service 的对象。** 可以是带可选 `inject` 和 `apply(ctx)` 字段的函数，也可以是 `Service` 子类，生命周期由 Cordis 挂载到当前上下文。
2. **上下文是服务的容器。** 一个服务占据稳定的 `ctx.<key>`（如 `ctx.tools`、`ctx.llm`、`ctx.sessions`）；其他插件通过 key 查找服务，而非导入具体实现。
3. **通过 `inject` 声明服务依赖。** 插件声明所需服务后，会等待其就绪才启动；加载顺序由服务依赖表达，而非手动编排。
4. **类型化事件用于通信。** 服务通过 TypeScript 声明合并注册事件名，再以 `emit`、`waterfall`、`parallel` 或 `serial` 分发，分别对应：监听观察、包装、并行扇出、按序执行。
5. **注册是可逆的副作用。** 提示词片段、工具 schema、适配器、提供方、监听器通过 `ctx.effect()` 或 `ctx.on()` 安装，reload 和 teardown 时按预期撤销。

## 分发模式

每个事件都有固定分发模式，只能通过对应方法分发：

| 模式 | 是否 await | 分发顺序 | 是否有返回值 |
|---|---|---|---|
| `emit` | 否 | 按注册顺序观察 | 否 |
| `waterfall` | 否 | 按注册顺序观察 | 是 |
| `parallel` | 是 | 所有监听器并行观察 | 否 |
| `serial` | 是 | 按注册顺序观察 | 是 |

分发模式是事件的公开约定。新 harness 事件通过 `@mode` 标签记录模式，供目录对声明与分发调用点做交叉校验。

## Cordis Waterfall 语义

`ctx.waterfall` 是环绕中间件。监听器接收 `(...args, next)`：
- 调用 `next()` 执行下游监听器；下游返回值通过 `next()` 返回当前层，可包装后继续向外返回。
- 不调用 `next()` 直接返回则短路。
- 协作式监听器通常修改共享的请求/决策对象后委托；也可完全替换结果，下游只见替换后的结果。
- 仅当必须在普通注册之前运行时才用 `prepend: true`。
- 对单决策事件，短路是设计意图：拥有决策权的策略监听器可不调用 `next()` 直接返回；仅标注或观察的监听器必须委托。

## Loader 配置

- `@deepseek-ai/cordis-plugin-include` 将 `!!js` 解析为表达式节点。
- Loader 在声明的注入激活后，基于插件上下文（`ctx.serviceName`）插值条目的 `config`；每次挂载决策时基于 loader 上下文插值其 `disabled` 字段。
- Include 保留嵌套行表达式直到目标行激活；其余条目元数据保持字面值。
- 由环境选择插件时，请使用 overlay。

## 实践规则

- 行为封装为插件：工具流水线事件属于 `ctx.tools`，模型流式输出属于 `ctx.llm`，实时 agent 协调属于 `ctx.agents`。
- 拦截和策略优先使用事件；直接能力调用优先使用服务方法。
- 每个注册都应有 disposer：从 `ctx.effect()` 返回一个，或用 Cordis 辅助方法自动处理。
- teardown 顺序有要求时，把相关工作放在同一个 effect 中，确保按预期顺序释放资源。