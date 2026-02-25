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

### 2.1 预检请求被 preHandler 拦截
**现象**：浏览器控制台报 `No 'Access-Control-Allow-Origin' header` 错误
**原因**：Docmost 的 `main.ts` 中 `app.enableCors()` 在 Fastify `preHandler` hook 之后注册。`preHandler` 检查 `req.raw.workspaceId`，OPTIONS 预检请求没有此字段，抛出 `NotFoundException`，导致预检失败且无 CORS 头
**修复**：两步修复——
1. 将 `app.enableCors()` 提前到 `preHandler` 之前注册
2. 将 `/api/public-wiki` 加入 `excludedPaths` 列表

```typescript
// apps/server/src/main.ts

// 1. CORS 必须在 preHandler 之前注册
app.enableCors({ origin: true, credentials: true });

// 2. preHandler 中排除公开 API 路径
const excludedPaths = [
  '/api/auth/setup',
  '/api/health',
  // ...
  '/api/public-wiki',   // ← 新增
];
```

**Fastify 执行顺序**：
```
onRequest（CORS 插件） → preParsing → preValidation → preHandler（workspaceId 检查） → handler
```
CORS 必须在 `onRequest` 阶段完成，否则 `preHandler` 的错误会导致预检失败。

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
- 所有公开 API 数据仅限于 `WIKI_PUBLIC_SPACE_SLUGS` 配置的空间
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
