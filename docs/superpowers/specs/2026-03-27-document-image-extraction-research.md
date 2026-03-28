# 文档图片提取质量问题 — 调研上下文

> 生成时间：2026-03-27
> 目的：为独立调研代理提供完整问题上下文，寻找最佳解决方案

---

## 一、问题描述

### 核心症状

当用户上传 Word/PDF 文档到 Docmost AI Agent 时，MinerU 解析服务将**一张完整的应用截图拆碎为 20+ 个 UI 元素碎片**。每个按钮、标签、图标都变成一个独立的图片 item。

### 具体案例

原始 DOCX 包含约 4 张完整截图（Clash for Windows 和 Clash for Android 的 UI），但 MinerU 提取出 20 张图片：

```
images/31690165...jpg (64KB) — 完整截图 ✅
images/9f93a1ab...jpg (71KB) — 完整截图 ✅
images/4cfc2a45...jpg (65KB) — 完整截图 ✅
images/8bd8a2c3...jpg (22KB) — 较大截图 ✅
images/13217c01...jpg (14KB) — 中等截图 ⚠️
images/6445945b...jpg (11KB) — 中等截图 ⚠️
images/d030cdfb...jpg (4KB)  — 小图 ❌ 碎片
images/b18c627e...jpg (4KB)  — 小图 ❌ 碎片
images/dfcaaa82...jpg (1.3KB) — 极小 ❌ 碎片（单个 UI 元素）
... (12 more < 1KB each)
```

content_list 中的碎片示例：
```
[22] type=text text="自 日志"
[23] type=text text="设置"
[24] type=text text="? 帮助"
[28] type=image text=""   ← 单独一个配置入口图标
[31] type=image text=""   ← 单独一个线路选择图标
[35] type=image text=""   ← 单独一个自动更新开关
```

---

## 二、当前技术架构

### 文档解析管线

```
用户上传 DOCX/PDF
  → Agent extract_document 工具
    → asset_parser.parse_document()
      → MinerU Cloud API (https://mineru.net)
        → MinerU 内部: DOCX → LibreOffice 转 PDF → DocLayout-YOLO 布局检测
        → 返回 ZIP（full.md + content_list.json + images/）
      → mineru_parser.parse_mineru_zip()
        → 遍历 content_list 中的 type="image" 项
        → 从 ZIP 中提取对应图片字节
        → 返回 SourceImagePayload 列表
    → upgrade_source_image_assets() 上传图片到 Docmost
    → 返回文本 + 图片 URL 给 Agent
```

### MinerU API 当前参数

```python
{
    "files": [{"name": name}],
    "model_version": "vlm",
    "enable_formula": False,
    "enable_table": True,
    "is_ocr": is_ocr,
}
```

**MinerU API 没有暴露图片提取粒度控制参数。**

### 项目已有能力

- `imagehash` 库（pyproject.toml 已有）
- `Pillow` 库（已安装）
- Docling 库（项目中有但此路径未使用）
- VLM 图片描述能力（parse_assets.py 中已有）
- MD5 图片去重（parse_assets.py 中已有）

---

## 三、约束条件

1. **成本敏感** — 不能对每张碎片图调 VLM
2. **延迟敏感** — MinerU 解析已耗时 5-15s，不能再加太多
3. **可靠性** — 方案必须对各种文档类型稳健
4. **MinerU API 不可改** — 我们是调用方
5. **保留有意义图片** — 不能一刀切过滤

---

## 四、需要调研的问题

1. python-docx 能否直接提取 DOCX 嵌入图片？质量如何？
2. Docling 对同样 DOCX 的图片提取结果如何？
3. PyMuPDF 页面渲染的成本和质量？
4. 成熟的"文档图片智能过滤"开源方案？
5. MinerU content_list_v2.json 是否有更好的图片元数据（bbox）？
6. DOCX→PDF 转换质量：LibreOffice 是否是碎片化根因？
7. 组合方案可行性：MinerU 文本 + 原生库图片
8. 生产级管线（Unstructured.io、Reducto）的图片过滤策略
9. 文件大小/bbox 阈值过滤的最佳阈值是多少？
10. 是否存在不依赖 MinerU 图片提取的完整替代方案？
