/**
 * Cordis 最小可运行示例
 * 运行：node demo.js
 *
 * 覆盖核心机制：
 *  - Context（服务容器）
 *  - provide / inject（服务注册与依赖注入）
 *  - on / emit（观察型事件）
 *  - waterfall（环绕中间件）
 */
import { Context } from './packages/core/lib/index.js'

// 1. 根上下文 = 服务容器
const ctx = new Context()

// 2. 插件 A：provide 一个服务 greet（占据 ctx.greet）
function pluginGreet(ctx) {
  ctx.provide('greet', {
    hello: (name) => `你好，${name}！`,
  })
}

// 3. 插件 B：inject 依赖 greet，等其就绪后才启动
function pluginUser(ctx) {
  // effect 注册副作用；reload/teardown 时会被撤销
  ctx.effect(() => {
    console.log('[plugin-user] 已启动，依赖的 greet 服务就绪')
  })
  // 观察型事件
  ctx.on('welcome', (name) => {
    console.log('[event]', ctx.greet.hello(name))
  })
}
// 声明关心 greet 服务：不注入前不得直接读取 ctx.greet
pluginUser.inject = ['greet']

await ctx.plugin(pluginGreet)
await ctx.plugin(pluginUser)

// 4. 事件分发（emit：不 await，按注册顺序观察）
ctx.emit('welcome', 'Cordis')
ctx.emit('welcome', '世界')

// 5. waterfall：环绕中间件，next() 委托下游
ctx.on('translate', async (text, next) => {
  const rest = await next() // 执行下游/兜底，拿到返回值后可包装
  return `[wrap] ${rest}`
})

// 最后一个参数是兜底执行函数
const result = await ctx.waterfall('translate', 'Cordis', (text) => `Hello, ${text}!`)
console.log('[waterfall]', result)

// 6. 直接调用服务（须在注入该服务的插件内）
function pluginCli(ctx) {
  console.log('[service]', ctx.greet.hello('编程方式'))
}
pluginCli.inject = ['greet']
await ctx.plugin(pluginCli)

// 完成，进程自然退出