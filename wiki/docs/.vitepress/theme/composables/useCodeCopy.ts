/**
 * 代码复制功能 composable
 * 事件委托模式：在消息列表容器上监听 .code-copy-btn 点击
 */
import { onMounted, onUnmounted, type Ref } from 'vue'

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

  onMounted(() => {
    containerRef.value?.addEventListener('click', handleClick)
  })

  onUnmounted(() => {
    containerRef.value?.removeEventListener('click', handleClick)
  })
}
