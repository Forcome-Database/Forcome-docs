# Wiki × Docmost 深度集成 — 踩坑记录

## 1. VitePress 路由与 Locale 解析

### 1.1 动态路由 404 问题
**现象**：访问 `/zh/docs/general/abc123` 显示 404 页面
**原因**：VitePress 是文件驱动的路由系统，每个路由必须对应一个 `.md` 文件。Docmost 动态内容没有对应的 `.md` 文件，VitePress 找不到文件就返回 404
**修复**：使用 `router.onBeforePageLoad` 钩子拦截 Docmost 路由，返回 `false` 阻止 VitePress 查找 `.md` 文件，同时手动注入组件到 `router.route.component`
```typescript
// wiki/docs/.vitepress/theme/index.ts
router.onBeforePageLoad = (to: string) => {
  if (isDocmostRoute(to)) {
    router.route.path = to
    router.route.component = markRaw(DocmostContent)
    router.route.data = { ... } as any
    return false  // 阻止 VitePress 查找 .md
  }
  return true
}
```
> **注意**：`onBeforePageLoad` 不是 VitePress 官方文档中的 API，来源于 GitHub Issue #2892，可能在未来版本中变更。

### 1.2 顶部导航栏消失
**现象**：Docmost 路由页面的顶部导航栏完全空白（没有首页、企业应用等链接）
**原因**：VitePress 通过 `route.data.relativePath` 解析当前 locale。locale 解析逻辑（`getLocaleForPath`）用正则匹配 `relativePath` 是否以 locale 前缀开头（如 `zh/`、`en/`）。最初设置 `relativePath: ''`（空字符串）导致无法匹配任何 locale，回退到根级 `themeConfig`，而根级没有定义 `nav`
**修复**：设置 `relativePath` 为带 locale 前缀的路径
```typescript
// 错误
relativePath: '',
// 正确
const relativePath = to.replace(/^\//, '') + '/index.md'
// 例：/zh/docs/general/abc123 → zh/docs/general/abc123/index.md
```

**VitePress locale 解析流程**：
```
route.data.relativePath
  → getLocaleForPath(siteData, relativePath)
  → 匹配 siteData.locales 的 key（如 'zh'、'en'、'vi'）
  → resolveSiteDataByRoute() 合并 locale 配置
  → useData().theme = 已合并的 themeConfig（包含 nav、sidebar）
```

### 1.3 标签页标题显示 404
**现象**：虽然页面内容正常渲染，但浏览器标签显示 "404"
**原因**：VitePress 的 `route.data.title` 为空时，默认标题机制未生效
**修复**：在 `DocmostContent.vue` 中手动更新 `document.title`
```typescript
if (typeof document !== 'undefined') {
  document.title = `${result.title || '文档'} | FORCOME 知识库`
}
```

---

## 2. CORS 跨域问题

### 2.1 预检请求被 preHandler 拦截（初始问题）
**现象**：浏览器控制台报 `No 'Access-Control-Allow-Origin' header` 错误
**原因**：Docmost 的 `main.ts` 中 `app.enableCors()` 在 Fastify `preHandler` hook 之后注册。`preHandler` 检查 `req.raw.workspaceId`，OPTIONS 预检请求没有此字段，抛出 `NotFoundException`，导致预检失败且无 CORS 头
**初始修复**：将 `app.enableCors()` 提前 + `/api/public-wiki` 加入 `excludedPaths`
**最终修复**：发现 `app.enableCors()` 仍有时序不稳定问题（见第 13 节），改为直接 `await fastifyInstance.register(fastifyCors, ...)`

**Fastify 执行顺序**：
```
onRequest（CORS 插件） → preParsing → preValidation → preHandler（workspaceId 检查） → handler
```
CORS 必须在 `onRequest` 阶段完成，否则 `preHandler` 的错误会导致预检失败。

> **另见**：第 13 节详述了 `app.enableCors()` 在 Fastify 下的根本时序问题及最终解决方案。

---

## 3. SSR 与客户端兼容

### 3.1 服务端渲染时 window 不存在
**现象**：VitePress build 或 SSR 时报 `window is not defined`
**原因**：`createDocmostService()` 使用了 `import.meta.env`（Vite 专属）和浏览器 API（`fetch`、`AbortController`），在 SSR 环境中不可用
**修复**：添加 `typeof window` 检查，SSR 时返回 `null`
```typescript
export function createDocmostService(): DocmostService | null {
  if (typeof window === 'undefined') {
    return null  // SSR 时不创建服务
  }
  const baseUrl = import.meta.env.VITE_DOCMOST_API_URL
  return baseUrl ? new DocmostService({ baseUrl }) : null
}
```

### 3.2 模块级初始化在 SSR 时执行
**现象**：`useDocmostSidebar.ts` 中模块级代码在 SSR 时执行，`createDocmostService()` 返回 `null`，后续客户端也无法使用
**修复**：延迟初始化，在首次访问时才创建服务实例
```typescript
// 延迟初始化（不在模块加载时立即创建）
let _service: DocmostService | null | undefined = undefined
function getService(): DocmostService | null {
  if (_service === undefined) {
    _service = createDocmostService()
  }
  return _service
}
```

### 3.3 `onMounted` 在 SSR 中不执行
**现象**：侧边栏数据依赖 `onMounted` 加载，SSR 时不会触发
**影响**：SSR 生成的 HTML 中侧边栏为空，客户端 hydrate 后才加载
**处理**：这是预期行为。Docmost 内容本身就是客户端动态加载的，不影响 SEO（Docmost 页面不参与 VitePress 构建）

---

## 4. Vue 响应式与 VitePress 数据流

### 4.1 computed 内读取 ref 不追踪
**现象**：用 `computed` 读取 `sidebarData` 但侧边栏不更新
**原因**：`computed` 内部调用了普通函数 `buildSidebarForRoute(path)`，该函数虽然访问了 `sidebarData.value`，但由于函数调用的上下文，Vue 的依赖追踪可能不够精确
**修复**：改用 `watch` 显式监听数据变化
```typescript
// 错误：computed 依赖追踪不可靠
const sidebarGroups = computed(() => buildSidebarForRoute(route.path))

// 正确：显式 watch 确保触发
const sidebarGroups = ref<SidebarItem[]>([])
watch(() => route.path, updateSidebar, { immediate: true })
watch(docmostLoaded, (loaded) => {
  if (loaded) updateSidebar()
})
```

### 4.2 Map 对象不触发 Vue 响应
**现象**：`ref(new Map())` 更新后视图不刷新
**原因**：Vue 3 对 `Map` 的响应式支持有限，`map.set()` 不一定触发更新
**修复**：使用普通对象 `Record<string, T>` 代替 `Map`
```typescript
// 错误
const sidebarData = ref<Map<string, DocmostSidebarNode[]>>(new Map())

// 正确
const sidebarData = ref<Record<string, DocmostSidebarNode[]>>({})
```

### 4.3 isAvailable 从布尔值变为 computed ref
**现象**：`if (hasDocmost)` 始终为 `true`（truthy），即使服务不可用
**原因**：`isAvailable` 是 `computed()` 返回的 ref 对象，对象本身永远是 truthy
**修复**：必须用 `.value` 访问
```typescript
// 错误
if (hasDocmost) { ... }  // computed ref 对象永远 truthy

// 正确
if (hasDocmost.value) { ... }
```

---

## 5. Docmost API 响应格式

### 5.1 响应包装层未解包
**现象**：API 返回数据但前端解析失败，找不到预期字段
**原因**：Docmost 使用 `TransformHttpResponseInterceptor` 统一包装响应为：
```json
{
  "data": { ... },    // 实际数据
  "success": true,
  "status": 200
}
```
前端直接使用 `response.json()` 得到的是包装对象，不是实际数据
**修复**：在 `DocmostService.post()` 中解包
```typescript
const json = await response.json()
return json.data !== undefined ? json.data : json
```

### 5.2 AI 端点 SSE 格式
**注意**：AI 问答端点直接写入 `res.raw`，绕过了 NestJS 的拦截器，所以**没有**响应包装。SSE 每行格式为：
```
data: {"content":"回答内容..."}\n\n
data: [DONE]\n\n
```
客户端需要逐行解析 `data:` 前缀并处理 `[DONE]` 结束标记。

---

## 6. 后端依赖与模块注入

### 6.1 SearchService 未导出
**现象**：`PublicWikiModule` 注入 `SearchService` 报 "can't resolve dependencies"
**原因**：`SearchModule` 只 providers 了 `SearchService` 但没有 exports
**修复**：在 `SearchModule` 中添加 `exports: [SearchService]`

### 6.2 AI 模块动态加载
**现象**：非 EE 环境下 `require('../../ee/ai/services/ai-search.service')` 失败
**处理**：用 `try/catch` 包裹，失败时 yield 错误 JSON 而不是抛异常
```typescript
async *aiAnswers(query, workspaceId): AsyncGenerator<string> {
  let AiSearchService;
  try {
    const aiModule = require('../../ee/ai/services/ai-search.service');
    AiSearchService = this.moduleRef.get(aiModule.AiSearchService, { strict: false });
  } catch (err) {
    yield JSON.stringify({ error: 'AI search is not available' });
    return;
  }
  // ...
}
```

### 6.3 PageRepo.findById 的 creator 字段
**现象**：TypeScript 报 `creator` 属性不存在于 `Page` 类型
**原因**：`findById` 通过 `includeCreator: true` 选项 JOIN 查询 creator，但返回类型是 `Page`，没有 `creator` 字段定义
**修复**：使用 `(page as any).creator` 绕过类型检查

---

## 7. 端口与环境配置

### 7.1 Wiki 与 Docmost 前端端口冲突
**现象**：`wiki` 和 `Docmost client` 都默认使用 5173 端口，同时启动时冲突
**修复**：VitePress 配置中指定端口
```typescript
// wiki/docs/.vitepress/config.ts
vite: {
  server: { port: 5175 }
}
```

### 7.2 环境变量文件位置
**注意**：VitePress 使用 Vite 加载环境变量，`envDir` 配置决定了 `.env` 文件的查找位置。当前配置 `envDir: process.cwd()`，指向 wiki 根目录。**必须确保 `.env` 文件在正确位置**，否则 `VITE_DOCMOST_API_URL` 读不到。

### 7.3 系统环境变量覆盖
**注意**：与 EE 重构时一样，系统环境变量会覆盖 `.env` 文件。在 Windows PowerShell 中可用 `$env:VITE_DOCMOST_API_URL="..."` 临时设置。

---

## 8. 附件公开访问

### 8.1 图片/文件无法显示
**现象**：Docmost 页面中的图片在 Wiki 中显示为 broken image
**原因**：Docmost 附件需要认证才能访问
**修复**：复用 `TokenService.generateAttachmentToken()` 生成临时签名 URL。处理流程参考 `ShareService.updatePublicAttachments()`：
1. 从 Prosemirror JSON 中提取所有附件 ID
2. 为每个附件生成签名 token
3. 替换 HTML 中的附件 URL，附加 token 参数
4. 移除评论标记（`removeMarkTypeFromDoc`）

---

## 9. 关键注意事项

### 9.1 安全性
- `WIKI_PUBLIC_SPACE_SLUGS` 为空时所有空间公开（自动发现模式），填值时仅公开白名单中的空间
- 附件 token 有时效性，过期后需重新加载页面
- 搜索和 AI 问答也严格限制在公开空间范围内
- `@AuthWorkspace()` 仍然有效，确保多工作区隔离

### 9.2 性能
- 侧边栏数据使用模块级缓存（`isLoaded` 标记），避免重复请求
- 搜索带 200ms 防抖
- AI 问答支持 AbortController 取消

### 9.3 VitePress 兼容性
- `router.onBeforePageLoad` 不是官方 API，版本升级时需要验证
- `route.data` 的字段需要与 VitePress 内部 `PageData` 接口兼容
- SSR 构建时 Docmost 动态内容不可用（预期行为）
- `relativePath` 必须以正确的 locale 前缀开头，否则 themeConfig 解析失败

### 9.4 Docmost 版本兼容性
- 基于 Docmost v0.25.3 开发
- 依赖 `PageRepo`、`SpaceRepo`、`TokenService`、`SearchService` 的内部 API
- `TransformHttpResponseInterceptor` 的响应包装格式需保持一致
- EE 模块的 `AiSearchService` 通过 `ModuleRef` 动态获取，非强依赖

---

## 10. 自动发现空间与动态导航

### 10.1 searchPublicPages 变量名冲突
**现象**：TypeScript 编译报 `Duplicate identifier 'query'`
**原因**：`searchPublicPages(query: string, ...)` 的参数名 `query` 与方法内的 Kysely 查询变量 `let query = this.db.selectFrom(...)` 同名
**修复**：将内部查询变量重命名为 `spaceQuery`
```typescript
// 错误：与方法参数 query: string 冲突
let query = this.db.selectFrom('spaces')...

// 正确
let spaceQuery = this.db.selectFrom('spaces')...
```

### 10.2 NavBar isActive 在 Docmost 路由不工作
**现象**：点击 Docmost 空间的导航项后，导航高亮不显示
**原因**：`isActive` 使用 `page.value.relativePath`（VitePress 静态 `.md` 文件路径），Docmost 动态路由没有对应的 `.md` 文件，`relativePath` 是路由拦截时伪造的值，不匹配实际 URL
**修复**：改用 `useRoute().path`（实际浏览器 URL 路径）
```typescript
// 错误：依赖 VitePress 静态文件路径
const currentPath = '/' + page.value.relativePath.replace(/\.md$/, '').replace(/index$/, '')

// 正确：使用实际 URL 路径
import { useRoute } from 'vitepress'
const route = useRoute()
const currentPath = route.path
```

### 10.3 WIKI_PUBLIC_SPACE_SLUGS 为空时的行为变更
**变更前**：slugs 为空 → `getPublicSpaces()` 返回空数组，`isSpacePublic()` 返回 `false`，所有空间不公开
**变更后**：slugs 为空 → 查询所有空间（自动发现模式），`isSpacePublic()` 返回 `true`
**影响范围**：`getPublicSpaces()`、`isSpacePublic()`、`searchPublicPages()` 三个方法
**注意**：如果需要不公开任何空间，不能简单留空 `WIKI_PUBLIC_SPACE_SLUGS`，需要设置为不存在的 slug（如 `WIKI_PUBLIC_SPACE_SLUGS=__none__`）

---

## 11. 特殊内容块渲染

### 11.1 processSpecialBlocks 首次导航不执行
**现象**：SPA 导航到 Docmost 页面时，Mermaid/KaTeX/Embed 不渲染，显示为原始文本或链接。手动刷新页面后正常。
**原因**：`loadPage()` 中 `isLoading.value = false` 放在 `finally` 块中，导致 `processSpecialBlocks()` 执行时 `isLoading` 仍为 `true`。模板中 `v-if="isLoading"` 优先级最高，页面内容块 `v-else-if="page"` 未渲染，`contentRef.value` 为 `null`。
```
执行顺序：
page.value = result     ← 数据已赋值
await nextTick()        ← 但 isLoading=true，内容块未渲染
processSpecialBlocks()  ← contentRef 为 null，跳过处理
finally: isLoading=false ← 内容块现在才渲染，但处理已结束
```
**修复**：将 `isLoading.value = false` 移到 `await nextTick()` 之前
```typescript
// 错误：isLoading 在 finally 中才变 false
try {
  page.value = result
  await nextTick()
  processSpecialBlocks(contentRef.value) // contentRef 为 null!
} finally {
  isLoading.value = false
}

// 正确：先关闭加载状态再处理 DOM
try {
  page.value = result
  isLoading.value = false  // ← 先让内容块渲染
  await nextTick()         // ← 等待 DOM 更新
  processSpecialBlocks(contentRef.value) // ← contentRef 有值
} catch {
  isLoading.value = false
}
```
**手动刷新能正常的原因**：`watch({ immediate: true })` 和 `onMounted` 同时触发两次 `loadPage()`。第一次的 `finally` 将 `isLoading` 设为 `false`，第二次执行时内容块已渲染，`contentRef` 有值。

### 11.2 Embed 嵌入内容只显示为链接
**现象**：Docmost 后台嵌入的 YouTube 视频、Google Sheets 在 Wiki 前台只显示为纯文本链接
**原因**：后端 `jsonToHtml()` 将 embed 节点序列化为 `<div data-type="embed"><a href="...">链接文本</a></div>`。Docmost 前端使用 React NodeView（`embed-view.tsx`）动态渲染为 `<iframe>`，但 Wiki 前台通过 `v-html` 直接注入 HTML，无法运行 React 组件
**修复**：在 `useContentProcessor.ts` 的 `processSpecialBlocks` 中添加 `processEmbeds()`，查找 `div[data-type="embed"]`，提取 `data-src` 属性，通过 provider URL 映射表转换为 iframe URL，创建 `<iframe>` 替换原 `<a>` 链接
```typescript
// embed provider URL 映射表需与 packages/editor-ext/src/lib/embed-provider.ts 保持同步
// 如果 Docmost 新增 embed provider，需同步更新 useContentProcessor.ts
```

---

## 12. Docmost 前端配置问题

### 12.1 getConfigValue 空字符串不回退到默认值
**现象**：Draw.io 编辑器双击后整个页面崩溃（"页面加载失败。发生了一个错误。"）；上传图片报错"文件超出了 0.0 KB 类型附件限制"
**原因**：`apps/client/src/lib/config.ts` 的 `getConfigValue` 使用 `??`（nullish coalescing）运算符。`.env` 文件中 `DRAWIO_URL=`、`FILE_UPLOAD_SIZE_LIMIT=` 等空值被 Vite `loadEnv` 读取为空字符串 `""`。空字符串不是 `null`/`undefined`，`??` 不触发回退到默认值。
```typescript
// 问题代码
return rawValue ?? defaultValue;
// "" ?? "50mb" → ""（空字符串不触发回退）
// "" ?? "https://embed.diagrams.net" → ""

// 修复
return rawValue || defaultValue;
// "" || "50mb" → "50mb"（空字符串触发回退）
```
**影响范围**：所有在 `.env` 中声明但留空的配置项：
| 配置项 | 默认值 | 空值导致的问题 |
|--------|--------|--------------|
| `DRAWIO_URL` | `https://embed.diagrams.net` | `react-drawio` 收到空 baseUrl，React 渲染崩溃 |
| `FILE_UPLOAD_SIZE_LIMIT` | `50mb` | `bytes("")` → `0`，所有文件上传被拒绝 |
| `FILE_IMPORT_SIZE_LIMIT` | `200mb` | 文件导入大小限制为 0 |

**根本修复**：将 `getConfigValue` 的 `??` 改为 `||`，一次性解决所有空字符串配置项问题。
**文件**：`apps/client/src/lib/config.ts:106`

---

## 13. CORS：`app.enableCors()` 在 Fastify 下的时序问题

### 13.1 删除空间后重新添加，Wiki 前台 CORS 报错
**现象**：删除空间后再添加新空间，打开 Wiki 前台控制台报错：
```
Access to fetch at 'http://localhost:3000/api/public-wiki/spaces' from origin 'http://localhost:5175'
has been blocked by CORS policy: Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```
**原因**：`app.enableCors()` 在 NestJS + Fastify 下内部调用 `this.register(@fastify/cors, options)` **没有 `await`**。CORS 插件的 `onRequest` 钩子注册时序可能晚于 `DomainMiddleware` 等中间件，导致 OPTIONS 预检请求在 CORS 头设置之前就被处理。
**修复**：直接在 Fastify 实例上 `await` 注册 `@fastify/cors`，确保 CORS 插件优先注册：
```typescript
// apps/server/src/main.ts
import fastifyCors from '@fastify/cors';

// 替换 app.enableCors({ origin: true, credentials: true })
const fastifyInstance = app.getHttpAdapter().getInstance();
await fastifyInstance.register(fastifyCors, {
  origin: true,
  credentials: true,
});
```
**关键点**：`await` 确保 CORS 插件的 `onRequest` 钩子在所有后续中间件之前注册。`ai/answers` SSE 端点仍需保留手动 CORS 头，因为它用 `res.raw.writeHead()` 绕过了 Fastify 响应管线。

---

## 14. AI 问答上下文问题

### 14.1 AI 回答不针对当前页面
**现象**：用户在页面 A 问"简要总结文档"，AI 回答的是页面 B 的内容
**原因**：前端 `aiAnswers(query)` 只发送 `{ query }` 给后端，后端用向量搜索匹配最相似的页面。泛化查询（如"总结文档"、"这篇文章讲了什么"）没有足够的语义信息定位到用户当前正在查看的页面
**修复**：前后端联动传递当前页面上下文——
1. **前端**：从 `route.path` 提取 `pageSlugId`（正则 `^\/(zh|en|vi)\/docs\/[^/]+\/([^/]+)`），传给 `aiAnswers(query, pageSlugId)`
2. **后端 DTO**：`PublicAiAnswerDto` 添加可选 `pageSlugId?: string`
3. **后端 Service**：`answerWithContext(query, workspaceId, pageSlugId?)` 先查当前页面 `text_content` 作为主上下文（4000字符），再用向量搜索补充上下文（去重当前页面），prompt 标注当前页面优先级

**修改文件链**：
```
前端: AIChat.vue → docmost.ts → { query, pageSlugId }
后端: public-wiki.dto.ts → public-wiki.controller.ts → public-wiki.service.ts → ai-search.service.ts
```

### 14.2 pages 表与 page_embeddings 表列名风格不同
**现象**：AI 回答报错 `column p.spaceId does not exist`
**原因**：`pages` 表使用 **snake_case** 列名（`space_id`, `workspace_id`, `slug_id`, `text_content`, `deleted_at`），而 `page_embeddings` 表使用 **camelCase** 列名（`"spaceId"`, `"workspaceId"`, `"pageId"`）。在手写 SQL 时容易混淆
**修复**：`ai-search.service.ts` 中对 `pages` 表使用 snake_case：
```sql
-- 错误（camelCase）
JOIN spaces s ON s.id = p."spaceId"
WHERE p."workspaceId" = ${workspaceId}

-- 正确（snake_case）
JOIN spaces s ON s.id = p.space_id
WHERE p.workspace_id = ${workspaceId}
```
**速查表**：

| 表 | 列名风格 | 示例 |
|---|---------|------|
| `pages` | snake_case | `space_id`, `workspace_id`, `slug_id`, `text_content`, `deleted_at`, `parent_page_id` |
| `spaces` | camelCase | `"workspaceId"` |
| `page_embeddings` | camelCase | `"pageId"`, `"spaceId"`, `"workspaceId"` |
| `users` | camelCase | `"workspaceId"` |

> **经验教训**：Docmost 数据库列名风格不统一。`pages` 表因历史迁移使用了 snake_case，其他大多数表使用 camelCase。写原始 SQL 时**务必先确认目标表的列名风格**，可通过 `\d table_name` 或查看对应的迁移文件确认。

---

## 15. AI 聊天会话隔离

### 15.1 所有页面共享同一个对话历史
**现象**：在文档 A 的 AI 聊天中问过问题，切换到文档 B 打开 AI 聊天，看到的仍然是文档 A 的对话
**原因**：`StorageKey.ChatHistory = 'cursor-docs-chat-history'` 是固定字符串，`loadHistory()` / `saveHistory()` 始终读写同一个 localStorage key，没有页面维度区分
**修复**：以路由路径构造动态 storage key：
```typescript
const getChatStorageKey = (): string => {
  return `${StorageKey.ChatHistory}:${route.path}`
  // 例：cursor-docs-chat-history:/zh/docs/general/abc123
}
```
同时添加 `watch(route.path)` 监听页面切换，自动加载对应会话。`loadHistory()` 新增 else 分支清空状态，确保新页面显示干净的欢迎界面。

---

## 16. Docmost 页面 Footer 与样式对齐

### 16.1 VitePress `.vp-doc h2` 自带 `border-top` 导致双线
**现象**：所有 h2 标题前面出现两条紧挨着的横线，静态 .md 和 Docmost 动态页面均受影响
**原因**：VitePress 默认主题 `vp-doc.css` 给 `.vp-doc h2` 定义了 `border-top: 1px solid var(--vp-c-divider); padding-top: 24px;`。同时 Docmost TipTap 在标题前输出 `<hr>` 分隔线，两者叠加产生双线。即便静态 .md 页面，如果 markdown.css 中对 h1/h2 也有 `border-bottom`，也会与相邻元素叠加
**修复**：在 `markdown.css` 中覆盖：
```css
.vp-doc h2 {
  border-top: none;
  padding-top: 0;
}
```
**文件**：`wiki/docs/.vitepress/theme/styles/markdown.css`

### 16.2 Docmost HTML 行高/间距与原版 .md 不一致
**现象**：Docmost 渲染的表格行高明显高于原版 .md 的表格，列表项间距也更大
**原因**：TipTap 编辑器输出的 HTML 结构与 VitePress markdown 渲染不同——TipTap 在 `<td>`、`<th>`、`<li>` 内部自动包裹 `<p>` 标签：
```html
<!-- TipTap 输出 -->
<td><p>mermaid</p></td>

<!-- VitePress markdown 输出 -->
<td>mermaid</td>
```
`.vp-doc p` 有 `margin: 16px 0; line-height: 28px;`，导致每个内嵌 `<p>` 额外增加 32px margin + 更大行高
**修复**：在 `DocmostContent.vue` 全局样式中消除嵌套 `<p>` 的多余间距：
```css
.docmost-html-content td p,
.docmost-html-content th p {
  margin: 0;
  line-height: inherit;
}

.docmost-html-content li > p {
  margin: 0;
}
```
**同时删除** `.docmost-html-content` 中与 `.vp-doc` 重复的通用元素样式（table、th/td、pre、code、hr、blockquote、img），让这些元素直接继承 `.vp-doc` 的样式，确保两套渲染一致
**文件**：`wiki/docs/.vitepress/theme/components/DocmostContent.vue`（样式部分）

### 16.3 Docmost 页面 Footer 增强
**需求**：原版仅显示"最后更新"日期，需要增加作者、编辑链接、上/下页导航
**实现**：
- **作者**：API 已返回 `creator` 字段（`includeCreator: true`），前端展示 `👤 作者: xxx`
- **编辑链接**：从 `VITE_DOCMOST_API_URL` 提取 origin，拼接 `/s/{spaceSlug}/p/{slugId}` 跳转 Docmost 编辑器
- **更新日期**：精确到秒（`YYYY/MM/DD HH:mm:ss`）
- **上/下页导航**：展平侧边栏树为有序列表，根据当前 slugId 找前后页，VitePress DocFooter 风格卡片式布局
- **多语言**：中/英/越南语标签支持

**布局**：
```
───────────────────────────────────────────
👤 作者: Leo   最后更新: 2026/02/25 14:51:13    ✏️ 编辑此页
───────────────────────────────────────────
┌──────────────┐      ┌──────────────┐
│ 上一页        │      │        下一页 │
│ VPN配置指南   │      │  图表使用指南 │
└──────────────┘      └──────────────┘
```
**文件**：`wiki/docs/.vitepress/theme/components/DocmostContent.vue`（模板 + 脚本部分）

---

## 17. 右侧导航面板重构与滚动定位修复

### 17.1 样式重构为 FastGPT 文档风格
**需求**：原版右侧导航为无边框、文字截断、无活跃指示器的简易目录，需重构为带边框容器 + 标题头 + 蓝色活跃指示器的风格
**修改**（`RightPanel.vue`）：
- **标题头**：新增 `.outline-header`，包含列表图标 SVG + "本页导航" 文字，下方细分割线
- **边框容器**：`.outline-wrapper` 添加 `border: 1px solid var(--c-border)` + `border-radius: var(--radius-lg)` + `background-color: var(--c-bg)`
- **活跃指示器**：`.outline-link` 添加 `border-left: 3px solid transparent` 占位，`.is-active` 时变为 `#2563eb` 蓝色（暗色模式 `#60a5fa`）
- **文字换行**：去掉 `white-space: nowrap` / `text-overflow: ellipsis`，允许长标题自然换行
- **层级缩进**：h3 的 `padding-left` 从 12px 增加到 28px
- **面板宽度**：200px → 220px
- **字体大小**：14px → 13px，行高 1.4，更紧凑
- **隐藏滚动条**（全浏览器覆盖）：`scrollbar-width: none`（Firefox）+ `-ms-overflow-style: none`（IE/Edge）+ `::-webkit-scrollbar { display: none }`（Chrome/Safari）

**联动修改**：
- `layout.css`：`padding-right` 从 236px 调整为 256px（220px 面板 + 36px 间距）
- `vars.css`：`--content-max-width` 从 768px 增加到 860px

### 17.2 scrollToHeader 使用 offsetTop 导致定位偏差
**现象**：点击目录第 4 项，页面滚动到第 3 项的位置
**原因**：`element.offsetTop` 返回相对于最近定位祖先（`offsetParent`）的偏移，而非文档绝对位置。嵌套在有 `position` 属性的容器内时，计算值偏小
**修复**：改用 `getBoundingClientRect().top + window.scrollY`
```typescript
// 错误：offsetTop 相对于 offsetParent
const top = element.offsetTop - 80

// 正确：getBoundingClientRect 相对于视口 + scrollY = 文档绝对位置
const top = element.getBoundingClientRect().top + window.scrollY - 80
```
`updateActiveId` 同理改为 `rect.top <= offset` 直接与视口偏移比较。

### 17.3 Scroll spy 在平滑滚动期间覆盖点击的激活项
**现象**：点击最后几项时，蓝色指示器短暂显示后跳回上一项
**原因**：`scrollToHeader` 触发平滑滚动 → 期间 `scroll` 事件不断触发 `updateActiveId` → 如果目标标题无法滚到 `offset` 阈值以内（页面底部标题，后面内容不足），scroll spy 会检测到上一个标题并覆盖 `activeId`
**修复**：引入 `isClickScrolling` 锁定机制 + scroll 事件静默检测：
```typescript
// 点击时立即锁定
const scrollToHeader = (id: string) => {
  activeId.value = id       // 立即设置
  isClickScrolling = true   // 锁定 scroll spy
  window.scrollTo({ top, behavior: 'smooth' })
  // 注意：不用固定 setTimeout 解锁（不可靠）
}

// scroll 事件处理：锁定期间只做静默检测
const onScroll = () => {
  if (isClickScrolling) {
    // 每次 scroll 重置计时器，直到滚动真正停止
    clearTimeout(scrollSettleTimer)
    scrollSettleTimer = setTimeout(() => {
      isClickScrolling = false
    }, 150)  // 150ms 无 scroll 事件 = 滚动结束
    return
  }
  updateActiveId()
}
```
**为什么固定 800ms 超时不可靠**：平滑滚动时长取决于滚动距离，长页面可能超过 800ms。超时后若滚动未完成，`updateActiveId` 会立即检测到错误的标题。

### 17.4 scrollIntoView 冒泡滚动页面
**现象**：滚动页面时激活项更新，面板自动滚动以保持可见，但页面会突然跳动
**原因**：`element.scrollIntoView()` 不仅滚动直接滚动容器（面板），还沿 DOM 树向上冒泡滚动所有可滚动祖先（包括 `window`），导致页面位置被篡改
**修复**：改为直接操作 `panel.scrollTop`，不触碰页面滚动：
```typescript
// 错误：冒泡滚动整个页面
activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

// 正确：只操作面板自身的 scrollTop
const panelRect = panel.getBoundingClientRect()
const elRect = activeEl.getBoundingClientRect()
if (elRect.top < panelRect.top) {
  panel.scrollTop += elRect.top - panelRect.top - 8
} else if (elRect.bottom > panelRect.bottom) {
  panel.scrollTop += elRect.bottom - panelRect.bottom + 8
}
```
**文件**：`wiki/docs/.vitepress/theme/components/RightPanel.vue`、`wiki/docs/.vitepress/theme/styles/layout.css`、`wiki/docs/.vitepress/theme/styles/vars.css`

---

## 18. 带锚点 URL 刷新导致页面 404

### 18.1 route.path 包含 hash 片段导致 API 404
**现象**：在带 `#anchor` 的 URL 上刷新页面（如 `/zh/docs/ibucos/RnLd8d8dbR#vhjiowxszysj`），报 `Docmost API 错误: 404 Not Found`。不带 hash 时正常
**原因**：VitePress 的 `route.path` 在页面刷新时可能包含 URL 的 `#hash` 片段。正则 `([^/]+)` 匹配除 `/` 外的所有字符（包括 `#`），导致 `slugId` 被解析为 `RnLd8d8dbR#vhjiowxszysj`，API 找不到此 ID 返回 404
**修复**：在所有 `route.path` 解析前剥离 hash：
```typescript
// DocmostContent.vue — routeParams 计算
const path = route.path.replace(/#.*$/, '')
const match = path.match(/^\/(zh|en|vi)\/docs\/([^/]+)\/([^/]+)/)

// DocmostContent.vue — watch 监听（避免 hash 变化触发重载）
watch(() => route.path.replace(/#.*$/, ''), () => { loadPage() })

// AIChat.vue — getCurrentPageSlugId
const path = route.path.replace(/#.*$/, '')
```
**影响文件**：`DocmostContent.vue`（routeParams + watch）、`AIChat.vue`（getCurrentPageSlugId）
