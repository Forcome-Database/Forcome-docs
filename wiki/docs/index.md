---
layout: doc
title: Cursor Docs
---

<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vitepress'

// 根路径自动重定向到中文版本
onMounted(() => {
  const router = useRouter()
  router.go('/zh/')
})
</script>

# 正在跳转...

正在跳转到文档首页，如果没有自动跳转，请点击下方链接：

- [中文文档](/zh/)
- [English Docs](/en/)
- [日本語ドキュメント](/ja/)
