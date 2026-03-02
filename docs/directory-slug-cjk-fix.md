# Directory/Topic Slug 中文名称支持修复

## 问题现象

创建目录（Directory）或主题（Topic）时，使用中文名称会报错：
> A directory with this slug already exists in this space

第一个中文目录可以创建成功，但后续所有中文名称的目录都无法创建。

## 根因分析

项目使用 `@sindresorhus/slugify` v1.1.0 将名称转换为 URL-safe 的 slug。该库**不支持 CJK 字符**，会将中文/日文/韩文全部丢弃：

| 输入 | slugify 输出 | 说明 |
|------|-------------|------|
| `"金蝶"` | `""` | 纯中文 → 空字符串 |
| `"测试目录"` | `""` | 纯中文 → 空字符串 |
| `"AI工具"` | `"ai"` | 只保留 ASCII 部分 |
| `"hello世界"` | `"hello"` | 只保留 ASCII 部分 |

所有纯中文名称都生成相同的空字符串 `""`，数据库有 `(slug, space_id)` 唯一约束，因此第二个中文目录必然冲突。

## 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **nanoid 回退** | 零新依赖、全语言通用、改动最小 | CJK 的 slug 不可读 | 通用 |
| **pinyin 转写** | 中文 slug 可读（金蝶→jin-die） | 只适用中文，增加依赖 | 纯中文项目 |
| **transliteration 库** | 多语言转写 | 增加重依赖 | 多语言项目 |
| **用户手动指定 slug** | 完全可控 | 需要 UI 改动 | 长期优化 |

## 采用方案：nanoid 回退

当 `slugify()` 返回空字符串时，用项目已有的 `nanoIdGen()`（10 位小写字母数字）生成随机 slug。

**理由**：
- 项目已有 `nanoid` 依赖（Page 的 `slugId` 就是此方案）
- 对现有 Latin 名称行为无影响
- 全语言通用（中文、日文、韩文、阿拉伯文等）
- 改动极小（每处仅一行）

## 修改文件

### 1. `apps/server/src/core/directory/directory.service.ts`

```typescript
// 新增导入
import { nanoIdGen } from '../../common/helpers/nanoid.utils';

// 创建时（第 34 行）
- const slug = slugify(dto.name);
+ const slug = slugify(dto.name) || nanoIdGen();

// 更新时（第 66 行）
- const newSlug = slugify(dto.name);
+ const newSlug = slugify(dto.name) || nanoIdGen();
```

### 2. `apps/server/src/core/topic/topic.service.ts`

```typescript
// 新增导入
import { nanoIdGen } from '../../common/helpers/nanoid.utils';

// 创建时（第 47 行）
- const slug = slugify(dto.name);
+ const slug = slugify(dto.name) || nanoIdGen();

// 更新时（第 77 行）
- const newSlug = slugify(dto.name);
+ const newSlug = slugify(dto.name) || nanoIdGen();
```

## 修复效果

| 输入名称 | 修复前 slug | 修复后 slug |
|---------|------------|------------|
| `"tools"` | `"tools"` | `"tools"`（不变） |
| `"AI工具"` | `"ai"` | `"ai"`（不变） |
| `"金蝶"` | `""`（冲突） | `"a3b5c8d9e2"`（随机唯一） |
| `"测试目录"` | `""`（冲突） | `"x7y2z4w1m9"`（随机唯一） |

## 相关文件

| 文件 | 用途 |
|------|------|
| `apps/server/src/common/helpers/nanoid.utils.ts` | `nanoIdGen` 定义（10 位小写字母数字） |
| `apps/server/src/database/migrations/20260228T120000-directories-topics.ts` | 表结构，`(slug, space_id)` 唯一约束 |
| `apps/server/src/database/repos/directory/directory.repo.ts` | `slugExists()` 大小写不敏感检查 |
