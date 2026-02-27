/**
 * 代码复制功能 composable
 * 事件委托模式：在容器上监听 .code-copy-btn 点击
 *
 * 使用 watch 而非 onMounted 注册监听器，因为容器 DOM 可能在
 * 条件渲染（v-if / v-else-if）中延迟出现，onMounted 时 ref 为 null。
 */
import { watch, onUnmounted, type Ref } from 'vue'

export function useCodeCopy(containerRef: Ref<HTMLElement | null>) {
  const handleClick = (e: Event) => {
    const btn = (e.target as HTMLElement).closest('.code-copy-btn') as HTMLElement | null
    if (!btn) return

    const code = btn.getAttribute('data-code')
    if (!code) return

    navigator.clipboard.writeText(code).then(() => {
      const copyIcon = btn.querySelector('.copy-icon') as SVGElement | null
      const checkIcon = btn.querySelector('.check-icon') as SVGElement | null
      if (copyIcon && checkIcon) {
        copyIcon.style.display = 'none'
        checkIcon.style.display = 'block'
        setTimeout(() => {
          copyIcon.style.display = ''
          checkIcon.style.display = 'none'
        }, 2000)
      }
    })
  }

  // watch ref：DOM 出现时注册，消失时移除
  watch(containerRef, (newEl, oldEl) => {
    oldEl?.removeEventListener('click', handleClick)
    newEl?.addEventListener('click', handleClick)
  })

  onUnmounted(() => {
    containerRef.value?.removeEventListener('click', handleClick)
  })
}
