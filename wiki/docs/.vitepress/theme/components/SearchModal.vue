<script setup lang="ts">
/**
 * 搜索模态框组件
 * 全屏模态搜索框，支持键盘导航、VitePress 本地搜索集成
 * 
 * 需求: 5.1-5.10, 8.6
 */
import { ref, watch, onMounted, onUnmounted, nextTick, shallowRef, markRaw } from 'vue'
import { useRouter, useData } from 'vitepress'
import MiniSearch from 'minisearch'
import SearchIcon from './icons/SearchIcon.vue'
import CloseIcon from './icons/CloseIcon.vue'

// 定义事件
const emit = defineEmits<{
  (e: 'close'): void
}>()

// 搜索结果项接口
interface SearchResultItem {
  id: string
  title: string
  titles: string[]
  text?: string
  link: string
}

// 获取 VitePress 数据和路由
const { localeIndex } = useData()
const router = useRouter()

// 搜索状态
const query = ref('')
const results = ref<SearchResultItem[]>([])
const selectedIndex = ref(-1)
const isLoading = ref(false)
const showNoResults = ref(false)
const isIndexReady = ref(false)

// DOM 引用
const inputRef = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)

// MiniSearch 实例
const searchIndex = shallowRef<MiniSearch<any> | null>(null)

/**
 * 初始化搜索索引
 */
const initSearchIndex = async () => {
  try {
    // 尝试动态导入搜索索引
    // @ts-ignore - VitePress 内部虚拟模块
    const searchIndexModule = await import('@localSearchIndex')
    const indexData = searchIndexModule.default
    
    if (indexData && indexData[localeIndex.value]) {
      const data = await indexData[localeIndex.value]()
      
      searchIndex.value = markRaw(
        MiniSearch.loadJSON(data.default, {
          fields: ['title', 'titles', 'text'],
          storeFields: ['title', 'titles'],
          searchOptions: {
            fuzzy: 0.2,
            prefix: true,
            boost: { title: 4, text: 2, titles: 1 }
          }
        })
      )
      isIndexReady.value = true
    }
  } catch (error) {
    console.warn('搜索索引加载失败:', error)
    isIndexReady.value = false
  }
}

/**
 * 执行搜索（需求 5.4）
 */
const performSearch = () => {
  if (!searchIndex.value || !query.value.trim()) {
    results.value = []
    selectedIndex.value = -1
    showNoResults.value = false
    return
  }

  isLoading.value = true

  try {
    const searchResults = searchIndex.value.search(query.value).slice(0, 16)
    
    results.value = searchResults.map((result: any) => ({
      id: result.id,
      title: result.title || '',
      titles: result.titles || [],
      text: result.text,
      link: result.id
    }))

    selectedIndex.value = results.value.length > 0 ? 0 : -1
    showNoResults.value = query.value.length > 0 && results.value.length === 0
  } catch (error) {
    console.error('搜索出错:', error)
    results.value = []
    selectedIndex.value = -1
  } finally {
    isLoading.value = false
  }
}

/**
 * 选择上一个结果（需求 5.7）
 */
const selectPrev = () => {
  if (results.value.length === 0) return
  selectedIndex.value = selectedIndex.value <= 0 
    ? results.value.length - 1 
    : selectedIndex.value - 1
  scrollToSelected()
}

/**
 * 选择下一个结果（需求 5.7）
 */
const selectNext = () => {
  if (results.value.length === 0) return
  selectedIndex.value = selectedIndex.value >= results.value.length - 1 
    ? 0 
    : selectedIndex.value + 1
  scrollToSelected()
}

/**
 * 滚动到选中项
 */
const scrollToSelected = () => {
  nextTick(() => {
    const selectedEl = resultsRef.value?.querySelector('.search-result-item.is-selected')
    selectedEl?.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * 跳转到选中结果（需求 5.8）
 */
const goToSelected = () => {
  if (selectedIndex.value >= 0 && selectedIndex.value < results.value.length) {
    const result = results.value[selectedIndex.value]
    router.go(result.link)
    emit('close')
  }
}

/**
 * 处理键盘事件
 */
const handleKeydown = (e: KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      selectPrev()
      break
    case 'ArrowDown':
      e.preventDefault()
      selectNext()
      break
    case 'Enter':
      e.preventDefault()
      goToSelected()
      break
    case 'Escape':
      e.preventDefault()
      emit('close')
      break
  }
}

/**
 * 处理结果项点击
 */
const handleResultClick = (result: SearchResultItem) => {
  router.go(result.link)
  emit('close')
}

/**
 * 重置搜索
 */
const resetSearch = () => {
  query.value = ''
  results.value = []
  selectedIndex.value = -1
  showNoResults.value = false
  inputRef.value?.focus()
}

// 监听搜索关键词变化，防抖执行搜索
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(performSearch, 200)
})

// 组件挂载时初始化
onMounted(async () => {
  await initSearchIndex()
  nextTick(() => inputRef.value?.focus())

  // 计算滚动条宽度，防止页面抖动
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
  if (scrollbarWidth > 0) {
    document.documentElement.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`)
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarWidth}px`
    // 同时给 fixed 定位的导航栏添加 padding
    const navbar = document.querySelector('.navbar') as HTMLElement
    if (navbar) {
      navbar.style.paddingRight = `${scrollbarWidth}px`
    }
  }
})

// 组件卸载时清理
onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
  document.documentElement.style.removeProperty('--scrollbar-width')
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
  // 恢复导航栏
  const navbar = document.querySelector('.navbar') as HTMLElement
  if (navbar) {
    navbar.style.paddingRight = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="search-modal-overlay" @click.self="emit('close')">
      <div class="search-modal" role="dialog" aria-modal="true" aria-label="搜索文档">
        <!-- 搜索输入区域 -->
        <div class="search-input-wrapper">
          <SearchIcon :size="18" class="search-input-icon" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            class="search-input"
            placeholder="搜索文档..."
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="64"
            aria-label="搜索文档"
            aria-describedby="search-tips"
            :aria-activedescendant="selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined"
            @keydown="handleKeydown"
          />
          <div class="search-input-actions">
            <button 
              v-if="query" 
              class="search-clear-btn" 
              type="button" 
              aria-label="清除搜索" 
              @click="resetSearch"
            >
              <CloseIcon :size="14" />
            </button>
            <kbd class="search-kbd" aria-hidden="true">ESC</kbd>
          </div>
        </div>

        <!-- 搜索结果列表 -->
        <div 
          ref="resultsRef" 
          class="search-results" 
          v-if="results.length > 0"
          role="listbox"
          aria-label="搜索结果"
        >
          <a
            v-for="(result, index) in results"
            :key="result.id"
            :href="result.link"
            class="search-result-item"
            :class="{ 'is-selected': index === selectedIndex }"
            role="option"
            :aria-selected="index === selectedIndex"
            @click.prevent="handleResultClick(result)"
            @mouseenter="selectedIndex = index"
          >
            <div class="result-titles">
              <span class="result-title-icon">#</span>
              <template v-for="(title, titleIndex) in result.titles" :key="titleIndex">
                <span class="result-breadcrumb">{{ title }}</span>
                <span class="result-separator">›</span>
              </template>
              <span class="result-title">{{ result.title }}</span>
            </div>
          </a>
        </div>

        <!-- 无结果提示 -->
        <div class="search-no-results" v-else-if="showNoResults">
          <p>未找到 "<strong>{{ query }}</strong>" 相关结果</p>
        </div>

        <!-- 加载中/索引未就绪提示 -->
        <div class="search-loading" v-else-if="!isIndexReady">
          <p>搜索功能正在初始化...</p>
        </div>

        <!-- 初始提示（需求 5.10） -->
        <div id="search-tips" class="search-tips" v-else-if="!query && isIndexReady">
          <p class="search-tips-text">输入关键词搜索文档</p>
        </div>

        <!-- 底部快捷键提示 -->
        <footer class="search-footer" aria-hidden="true">
          <div class="search-shortcuts">
            <span class="shortcut-item"><kbd>↑</kbd><kbd>↓</kbd><span>导航</span></span>
            <span class="shortcut-item"><kbd>Enter</kbd><span>选择</span></span>
            <span class="shortcut-item"><kbd>ESC</kbd><span>关闭</span></span>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.search-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--z-modal);
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
}

.search-modal {
  width: 100%;
  max-width: 600px;
  margin: 0 var(--spacing-4);
  background-color: var(--c-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: min(70vh, 500px);
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--c-border);
  transition: border-color var(--transition-fast);
}

.search-input-wrapper:focus-within {
  border-bottom-color: var(--c-accent);
}

.search-input-icon { flex-shrink: 0; color: var(--c-text-3); }

.search-input {
  flex: 1;
  min-width: 0;
  padding: var(--spacing-2) 0;
  font-size: var(--font-size-base);
  color: var(--c-text-1);
  background: transparent;
  border: none;
  outline: none;
}

.search-input::placeholder { color: var(--c-text-4); }

.search-input-actions { display: flex; align-items: center; gap: var(--spacing-2); }

.search-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background-color: var(--c-bg-mute);
  color: var(--c-text-3);
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.search-clear-btn:hover { background-color: var(--c-hover); color: var(--c-text-1); }

.search-kbd {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  background-color: var(--c-bg-mute);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  color: var(--c-text-3);
}

.search-results { flex: 1; overflow-y: auto; padding: var(--spacing-2); }

.search-result-item {
  display: block;
  padding: var(--spacing-3) var(--spacing-4);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--c-text-2);
  transition: background-color var(--transition-fast);
  cursor: pointer;
}

.search-result-item:hover,
.search-result-item.is-selected { background-color: var(--c-bg-mute); }

.result-titles {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-1);
  font-size: var(--font-size-sm);
  line-height: 1.5;
}

.result-title-icon { color: var(--c-accent); font-weight: var(--font-weight-medium); opacity: 0.7; }
.result-breadcrumb { color: var(--c-text-3); }
.result-separator { color: var(--c-text-4); font-size: var(--font-size-xs); }
.result-title { color: var(--c-text-1); font-weight: var(--font-weight-medium); }

.search-result-item.is-selected .result-title-icon,
.search-result-item.is-selected .result-title { color: var(--c-accent); }

.search-no-results,
.search-loading,
.search-tips {
  padding: var(--spacing-8) var(--spacing-4);
  text-align: center;
  color: var(--c-text-3);
  font-size: var(--font-size-sm);
}

.search-no-results strong { color: var(--c-text-2); }

.search-footer {
  padding: var(--spacing-3) var(--spacing-4);
  border-top: 1px solid var(--c-border);
  background-color: var(--c-bg-soft);
}

.search-shortcuts {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-6);
  font-size: var(--font-size-xs);
  color: var(--c-text-3);
}

.shortcut-item { display: flex; align-items: center; gap: var(--spacing-1); }

.shortcut-item kbd {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  background-color: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  min-width: 20px;
  text-align: center;
}

@media (max-width: 639px) {
  .search-modal-overlay { padding-top: 0; align-items: stretch; }
  .search-modal { max-width: none; margin: 0; border-radius: 0; max-height: 100vh; height: 100%; }
  .search-shortcuts { gap: var(--spacing-4); }
}
</style>
