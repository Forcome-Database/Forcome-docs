<script setup lang="ts">
/**
 * 语言切换下拉菜单组件
 * 支持中文、英文、日文切换
 * 
 * 需求: 16.2-16.6
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useData, useRouter } from 'vitepress'
import ChevronIcon from './icons/ChevronIcon.vue'

// 支持的语言列表
const languages = [
  { code: 'zh', name: '简体中文', path: '/zh/' },
  { code: 'en', name: 'English', path: '/en/' },
  { code: 'vi', name: 'Tiếng Việt', path: '/vi/' }
]

// 下拉菜单状态
const isOpen = ref(false)
const dropdownRef = ref<HTMLElement | null>(null)

// 获取 VitePress 数据
const { lang, localeIndex } = useData()
const router = useRouter()

// 当前语言
const currentLang = computed(() => {
  const found = languages.find(l => l.code === lang.value || l.code === localeIndex.value)
  return found || languages[0]
})

// 切换下拉菜单
const toggleDropdown = () => {
  isOpen.value = !isOpen.value
}

// 关闭下拉菜单
const closeDropdown = () => {
  isOpen.value = false
}

// 切换语言
const switchLang = (langItem: typeof languages[0]) => {
  if (langItem.code === currentLang.value.code) {
    closeDropdown()
    return
  }
  
  // 获取当前路径
  const currentPath = window.location.pathname
  
  // 提取不带语言前缀的路径部分
  let pathWithoutLang = currentPath
  
  // 检查并移除所有可能的语言前缀
  for (const l of languages) {
    if (currentPath.startsWith(l.path)) {
      pathWithoutLang = currentPath.slice(l.path.length - 1) // 保留开头的 /
      break
    }
  }
  
  // 构建新路径: /en/ + /guide/quickstart = /en/guide/quickstart
  const newPath = langItem.path.slice(0, -1) + pathWithoutLang
  
  // 导航到新路径
  router.go(newPath)
  closeDropdown()
}

// 点击外部关闭下拉菜单
const handleClickOutside = (event: MouseEvent) => {
  if (dropdownRef.value && !dropdownRef.value.contains(event.target as Node)) {
    closeDropdown()
  }
}

// 键盘导航
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeDropdown()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="dropdownRef" class="lang-switch">
    <button
      class="lang-switch-button"
      type="button"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      aria-label="切换语言"
      aria-controls="lang-dropdown"
      @click.stop="toggleDropdown"
    >
      <span class="lang-text">{{ currentLang.name }}</span>
      <ChevronIcon 
        :size="14" 
        class="lang-chevron" 
        :class="{ 'is-open': isOpen }"
      />
    </button>

    <!-- 下拉菜单 -->
    <Transition name="dropdown">
      <ul 
        v-if="isOpen" 
        class="lang-dropdown"
        role="listbox"
        aria-label="选择语言"
        id="lang-dropdown"
      >
        <li
          v-for="langItem in languages"
          :key="langItem.code"
        >
          <button
            class="lang-option"
            :class="{ 'is-active': langItem.code === currentLang.code }"
            role="option"
            :aria-selected="langItem.code === currentLang.code"
            @click="switchLang(langItem)"
          >
            {{ langItem.name }}
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
.lang-switch {
  position: relative;
}

.lang-switch-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-md);
  color: var(--c-text-2);
  background-color: transparent;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: 
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.lang-switch-button:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.lang-switch-button:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.lang-text {
  white-space: nowrap;
}

.lang-chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.lang-chevron.is-open {
  transform: rotate(180deg);
}

/* 下拉菜单 */
.lang-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: var(--z-tooltip);
  min-width: 120px;
  padding: var(--spacing-1);
  background-color: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  list-style: none;
  margin: 0;
}

.lang-dropdown li {
  margin: 0;
  padding: 0;
}

.lang-option {
  display: block;
  width: 100%;
  padding: var(--spacing-2) var(--spacing-3);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--c-text-2);
  background-color: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: 
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.lang-option:hover {
  background-color: var(--c-hover);
  color: var(--c-text-1);
}

.lang-option:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: -2px;
}

.lang-option.is-active {
  color: var(--c-accent);
  font-weight: var(--font-weight-medium);
}

/* 下拉动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: 
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 小屏幕隐藏语言切换 */
@media (max-width: 639px) {
  .lang-switch {
    display: none;
  }
}
</style>
