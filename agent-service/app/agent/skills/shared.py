"""Shared TipTap format rules — syntax constraints, content quality, and critical constraints.

These rules apply to ALL agent skills (creation and editing alike). They define:
- Syntax-level constraints: callouts, tables, headings, code blocks, images, links, collapsibles
- Content quality rules: mandatory and forbidden patterns
- Critical constraints: image URLs, technical terms, active voice
"""

TIPTAP_FORMAT_RULES = """\
## Markdown Format for TipTap

Output is auto-converted: Markdown → HTML → ProseMirror JSON → TipTap editor.

### Callout Blocks

:::info
Helpful tips, context, or background information.
:::

:::success
Positive outcomes, confirmations, or completed actions.
:::

:::warning
Cautions, potential issues, or important reminders.
:::

:::danger
Critical warnings, destructive actions, or security risks.
:::

### Images

```markdown
![Descriptive alt text from VLM](exact-docmost-url)
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data     | Data     | Data     |
```

Use tables for: comparisons, configuration parameters, download links, any 2+ column data.
NEVER use bullet lists to simulate table structure.

### Headings

- `# Title` — Exactly ONE per document
- `## Section` — Major sections
- `### Subsection` — Steps or sub-topics
- NEVER skip levels: `#` → `###` is forbidden

### Code Blocks

Always specify language for syntax highlighting:
````markdown
```python
code here
```
````

### Collapsible Sections (FAQ, advanced details)

```html
<details>
<summary>Click to expand</summary>
Detailed content here...
</details>
```

### Links

```markdown
[Descriptive link text](https://example.com)
```

NEVER use raw URLs without link text.

## Content Quality Rules

### MANDATORY
- Preserve ALL factual content from source — zero information loss on rewrites
- Restructure and ENHANCE presentation — don't just copy-paste
- Use specific data, commands, URLs, and actionable instructions
- Write like an experienced professional sharing practical knowledge
- Default to Chinese unless user explicitly requests another language

### FORBIDDEN
- OCR noise or UI menu text artifacts (e.g., "自 日志 设置 ? 帮助 A 关于")
- Images without meaningful alt text (use VLM descriptions from `describe_images`)
- Placeholder text of any kind
- Starting paragraphs with "在当今..." or "随着...的发展"
- Formulaic transitions: '首先/其次/最后', '综上所述', '值得注意的是'
- Corporate buzzwords: '赋能', '抓手', '落地', '闭环', '链路', '沉淀', '对齐'
- Repeating the same sentence structure 3+ times in a row

## Critical Constraints (MUST FOLLOW)

1. Every image URL returned by `extract_document` MUST appear in your final Markdown output.
   Missing even one image URL is a critical quality defect.

2. Use VLM descriptions from `describe_images` as alt text. Place each image
   IMMEDIATELY AFTER the text it illustrates — never stack all images at the end.

3. Technical terms, commands, version numbers, and URLs must be preserved exactly.
   Never change `apt-get install` to `安装软件` or alter version strings.

4. Active voice always: "Click the button" not "The button should be clicked".
"""
