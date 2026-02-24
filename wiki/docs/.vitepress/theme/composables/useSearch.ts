/**
 * 搜索状态管理 Composable
 * 提供搜索状态、⌘K/Ctrl+K 快捷键、键盘导航
 * 
 * 需求: 5.1-5.10, 8.6
 */

import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'

/** 搜索结果项 */
export interface SearchResultItem {
  /** 唯一标识 */
  id: string
  /** 页面标题 */
  title: string
  /** 面包屑标题 */
  titles: string[]
  /** 匹配内容 */
  text?: string
  /** 链接地址 */
  link: string
}

/** 搜索状态 */
export interface SearchState {
  /** 搜索关键词 */
  query: string
  /** 搜索结果 */
  results: SearchResultItem[]
  /** 当前选中索引 */
  selectedIndex: number
  /** 是否加载中 */
  isLoading: boolean
  /** 是否显示无结果提示 */
  showNoResults: boolean
}

/**
 * 搜索状态管理 Hook
 * 
 * @returns 搜索状态和操作方法
 * 
 * @example
 * ```ts
 * const { 
 *   isOpen, 
 *   query, 
 *   results, 
 *   selectedIndex,
 *   open, 
 *   close, 
 *   search,
 *   selectNext,
 *   selectPrev,
 *   goToSelected
 * } = useSearch()
 * ```
 */
export function useSearch() {
  // 搜索框是否打开
  const isOpen = ref(false)
  
  // 搜索关键词
  const query = ref('')
  
  // 搜索结果
  const results = ref<SearchResultItem[]>([])
  
  // 当前选中索引
  const selectedIndex = ref(-1)
  
  // 是否加载中
  const isLoading = ref(false)
  
  // 是否显示无结果提示
  const showNoResults = ref(false)

  // 搜索输入框引用（用于自动聚焦）
  const inputRef = ref<HTMLInputElement | null>(null)

  /**
   * 打开搜索框（需求 5.1, 5.2）
   */
  const open = () => {
    isOpen.value = true
    // 防止背景滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden'
    }
    // 自动聚焦输入框（需求 5.3）
    nextTick(() => {
      inputRef.value?.focus()
    })
  }

  /**
   * 关闭搜索框（需求 5.5, 5.6）
   */
  const close = () => {
    isOpen.value = false
    // 恢复背景滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = ''
    }
    // 重置状态
    resetSearch()
  }

  /**
   * 切换搜索框
   */
  const toggle = () => {
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }

  /**
   * 重置搜索状态
   */
  const resetSearch = () => {
    query.value = ''
    results.value = []
    selectedIndex.value = -1
    showNoResults.value = false
  }

  /**
   * 选择上一个结果（需求 5.7）
   */
  const selectPrev = () => {
    if (results.value.length === 0) return
    
    if (selectedIndex.value <= 0) {
      selectedIndex.value = results.value.length - 1
    } else {
      selectedIndex.value--
    }
    scrollToSelected()
  }

  /**
   * 选择下一个结果（需求 5.7）
   */
  const selectNext = () => {
    if (results.value.length === 0) return
    
    if (selectedIndex.value >= results.value.length - 1) {
      selectedIndex.value = 0
    } else {
      selectedIndex.value++
    }
    scrollToSelected()
  }

  /**
   * 滚动到选中项
   */
  const scrollToSelected = () => {
    nextTick(() => {
      const selectedEl = document.querySelector('.search-result-item.is-selected')
      selectedEl?.scrollIntoView({ block: 'nearest' })
    })
  }

  /**
   * 跳转到选中结果（需求 5.8）
   */
  const goToSelected = (): string | null => {
    if (selectedIndex.value >= 0 && selectedIndex.value < results.value.length) {
      const result = results.value[selectedIndex.value]
      close()
      return result.link
    }
    return null
  }

  /**
   * 设置选中索引
   */
  const setSelectedIndex = (index: number) => {
    if (index >= -1 && index < results.value.length) {
      selectedIndex.value = index
    }
  }

  /**
   * 设置搜索输入框引用
   */
  const setInputRef = (el: HTMLInputElement | null) => {
    inputRef.value = el
  }

  /**
   * 更新搜索结果
   */
  const setResults = (newResults: SearchResultItem[]) => {
    results.value = newResults
    // 有结果时选中第一个
    selectedIndex.value = newResults.length > 0 ? 0 : -1
    showNoResults.value = query.value.length > 0 && newResults.length === 0
  }

  /**
   * 设置加载状态
   */
  const setLoading = (loading: boolean) => {
    isLoading.value = loading
  }

  // 监听搜索关键词变化，重置选中索引
  watch(query, () => {
    showNoResults.value = false
  })

  // ===== 快捷键处理 =====

  /**
   * 处理全局快捷键（需求 5.1）
   */
  const handleGlobalKeydown = (e: KeyboardEvent) => {
    // ⌘K / Ctrl+K 打开搜索
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      toggle()
    }
  }

  /**
   * 处理搜索框内的键盘事件
   */
  const handleSearchKeydown = (e: KeyboardEvent) => {
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
        const link = goToSelected()
        if (link && typeof window !== 'undefined') {
          window.location.href = link
        }
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
    }
  }

  // 组件挂载时注册全局快捷键
  onMounted(() => {
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', handleGlobalKeydown)
    }
  })

  // 组件卸载时移除全局快捷键
  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleGlobalKeydown)
    }
    // 确保恢复滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = ''
    }
  })

  return {
    // 状态
    /** 搜索框是否打开 */
    isOpen,
    /** 搜索关键词 */
    query,
    /** 搜索结果 */
    results,
    /** 当前选中索引 */
    selectedIndex,
    /** 是否加载中 */
    isLoading,
    /** 是否显示无结果提示 */
    showNoResults,

    // 方法
    /** 打开搜索框 */
    open,
    /** 关闭搜索框 */
    close,
    /** 切换搜索框 */
    toggle,
    /** 重置搜索 */
    resetSearch,
    /** 选择上一个 */
    selectPrev,
    /** 选择下一个 */
    selectNext,
    /** 跳转到选中项 */
    goToSelected,
    /** 设置选中索引 */
    setSelectedIndex,
    /** 设置输入框引用 */
    setInputRef,
    /** 设置搜索结果 */
    setResults,
    /** 设置加载状态 */
    setLoading,
    /** 处理搜索框键盘事件 */
    handleSearchKeydown
  }
}

/**
 * 获取操作系统对应的快捷键修饰符
 */
export function getModifierKey(): string {
  if (typeof navigator === 'undefined') return '⌘'
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'
}
