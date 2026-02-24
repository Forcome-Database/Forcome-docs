/**
 * 侧边栏状态管理 Composable
 * 提供侧边栏宽度状态、移动端开关、拖拽调整功能
 * 支持 localStorage 持久化和跨标签页同步
 * 
 * 需求: 4.1-4.8
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'
import { storage } from '../services/storage'
import { StorageKey, type SidebarSizeConfig } from '../types'

/** 侧边栏尺寸配置常量 */
const SIDEBAR_CONFIG: SidebarSizeConfig = {
  defaultWidth: 220,
  minWidth: 180,
  maxWidth: 320
}

/** 移动端断点（px） */
const MOBILE_BREAKPOINT = 1024

/**
 * 侧边栏状态管理 Hook
 * 
 * @param config 可选的尺寸配置
 * @returns 侧边栏状态和操作方法
 * 
 * @example
 * ```ts
 * const { 
 *   width, 
 *   isOpen, 
 *   isDragging,
 *   isMobile,
 *   startDrag, 
 *   toggle, 
 *   open, 
 *   close 
 * } = useSidebar()
 * 
 * // 在模板中使用
 * // :style="{ width: `${width}px` }"
 * // @mousedown="startDrag"
 * ```
 */
export function useSidebar(config: Partial<SidebarSizeConfig> = {}) {
  // 合并配置
  const sizeConfig: SidebarSizeConfig = {
    ...SIDEBAR_CONFIG,
    ...config
  }

  // 侧边栏宽度（桌面端）
  const width = ref(sizeConfig.defaultWidth)
  
  // 移动端侧边栏是否打开
  const isOpen = ref(false)
  
  // 是否正在拖拽
  const isDragging = ref(false)
  
  // 是否为移动端视图
  const isMobile = ref(false)

  // 拖拽起始状态
  let dragStartX = 0
  let dragStartWidth = 0

  /**
   * 限制宽度在有效范围内（需求 4.4, 4.5）
   */
  const clampWidth = (value: number): number => {
    return Math.min(sizeConfig.maxWidth, Math.max(sizeConfig.minWidth, value))
  }

  /**
   * 设置侧边栏宽度
   * @param newWidth 新宽度值
   */
  const setWidth = (newWidth: number) => {
    width.value = clampWidth(newWidth)
  }

  /**
   * 开始拖拽（需求 4.1, 4.2, 4.3）
   * 支持鼠标和触摸事件
   */
  const startDrag = (e: MouseEvent | TouchEvent) => {
    // 阻止默认行为和文本选择
    e.preventDefault()
    
    isDragging.value = true
    dragStartX = 'touches' in e ? e.touches[0].clientX : e.clientX
    dragStartWidth = width.value

    // 添加拖拽中的 body 样式，防止文本选择
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    // 绑定移动和结束事件
    document.addEventListener('mousemove', onDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.addEventListener('touchmove', onDragMove, { passive: false })
    document.addEventListener('touchend', onDragEnd)
  }

  /**
   * 拖拽移动处理（需求 4.3）
   */
  const onDragMove = (e: MouseEvent | TouchEvent) => {
    if (!isDragging.value) return

    // 阻止触摸事件的默认滚动行为
    if ('touches' in e) {
      e.preventDefault()
    }

    const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const delta = currentX - dragStartX
    const newWidth = clampWidth(dragStartWidth + delta)
    
    width.value = newWidth
  }

  /**
   * 拖拽结束处理（需求 4.6）
   */
  const onDragEnd = () => {
    if (!isDragging.value) return

    isDragging.value = false

    // 恢复 body 样式
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    // 移除事件监听
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('touchmove', onDragMove)
    document.removeEventListener('touchend', onDragEnd)

    // 保存宽度到 localStorage（需求 4.6）
    saveWidth()
  }

  /**
   * 保存宽度到 localStorage
   */
  const saveWidth = () => {
    storage.set(StorageKey.SidebarWidth, width.value)
  }

  /**
   * 从 localStorage 加载宽度（需求 4.7）
   */
  const loadWidth = () => {
    const saved = storage.get<number>(StorageKey.SidebarWidth)
    if (saved !== null && typeof saved === 'number') {
      width.value = clampWidth(saved)
    }
  }

  /**
   * 打开移动端侧边栏
   */
  const open = () => {
    isOpen.value = true
    // 防止背景滚动，计算滚动条宽度防止页面抖动
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
      document.body.style.overflow = 'hidden'
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }
  }

  /**
   * 关闭移动端侧边栏
   */
  const close = () => {
    isOpen.value = false
    // 恢复背景滚动
    if (typeof document !== 'undefined') {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }

  /**
   * 切换移动端侧边栏
   */
  const toggle = () => {
    if (isOpen.value) {
      close()
    } else {
      open()
    }
  }

  /**
   * 检测是否为移动端视图
   */
  const checkMobile = () => {
    if (typeof window === 'undefined') return
    
    const wasMobile = isMobile.value
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT

    // 从移动端切换到桌面端时，关闭侧边栏抽屉
    if (wasMobile && !isMobile.value && isOpen.value) {
      close()
    }
  }

  /**
   * 处理窗口大小变化
   */
  const handleResize = () => {
    checkMobile()
  }

  /**
   * 处理跨标签页存储变化
   */
  const handleStorageChange = (event: StorageEvent) => {
    if (event.key === StorageKey.SidebarWidth && event.newValue) {
      try {
        const newWidth = JSON.parse(event.newValue) as number
        if (typeof newWidth === 'number') {
          width.value = clampWidth(newWidth)
        }
      } catch {
        // 解析失败时忽略
      }
    }
  }

  // 监听宽度变化，自动保存（防抖）
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  watch(width, () => {
    // 拖拽过程中不保存，等拖拽结束再保存
    if (isDragging.value) return
    
    // 防抖保存
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
      saveWidth()
    }, 300)
  })

  // 组件挂载时初始化
  onMounted(() => {
    // 加载保存的宽度
    loadWidth()

    // 检测移动端
    checkMobile()

    // 监听窗口大小变化
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize)
      window.addEventListener('storage', handleStorageChange)
    }
  })

  // 组件卸载时清理
  onUnmounted(() => {
    // 清理拖拽事件
    document.removeEventListener('mousemove', onDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.removeEventListener('touchmove', onDragMove)
    document.removeEventListener('touchend', onDragEnd)

    // 清理窗口事件
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('storage', handleStorageChange)
    }

    // 清理防抖定时器
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }

    // 恢复 body 样式
    if (typeof document !== 'undefined') {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  })

  return {
    // 状态
    /** 侧边栏宽度（px） */
    width,
    /** 移动端侧边栏是否打开 */
    isOpen,
    /** 是否正在拖拽 */
    isDragging,
    /** 是否为移动端视图 */
    isMobile,

    // 配置
    /** 尺寸配置 */
    config: sizeConfig,

    // 方法
    /** 设置宽度 */
    setWidth,
    /** 开始拖拽 */
    startDrag,
    /** 打开移动端侧边栏 */
    open,
    /** 关闭移动端侧边栏 */
    close,
    /** 切换移动端侧边栏 */
    toggle
  }
}

/**
 * 侧边栏拖拽手柄样式类名
 * 用于组件中添加拖拽视觉反馈（需求 4.8）
 */
export const SIDEBAR_DRAG_HANDLE_CLASS = 'sidebar-resize-handle'

/**
 * 获取侧边栏 CSS 变量
 * 用于动态设置侧边栏宽度
 */
export function getSidebarCSSVars(width: number): Record<string, string> {
  return {
    '--sidebar-width-current': `${width}px`
  }
}
