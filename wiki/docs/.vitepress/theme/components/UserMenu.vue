<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const { currentUser, isAdmin, isAuthenticated, logout, hasCookie } = useAuth()
const showDropdown = ref(false)

const adminUrl = import.meta.env.VITE_ADMIN_URL || ''

async function handleLogout() {
  await logout()
  window.location.href = '/login'
}
</script>

<template>
  <div v-if="isAuthenticated" class="user-menu" @mouseenter="showDropdown = true" @mouseleave="showDropdown = false">
    <button class="user-menu-trigger" type="button">
      <img
        v-if="currentUser?.avatarUrl"
        :src="currentUser.avatarUrl"
        :alt="currentUser.name"
        class="user-avatar"
      />
      <span v-else class="user-avatar-fallback">
        {{ currentUser?.name?.charAt(0) || '?' }}
      </span>
    </button>
    <div v-show="showDropdown" class="user-dropdown">
      <div class="user-info">
        <span class="user-name">{{ currentUser?.name }}</span>
        <span class="user-email">{{ currentUser?.email }}</span>
      </div>
      <div class="user-dropdown-divider"></div>
      <a
        v-if="isAdmin && adminUrl"
        :href="adminUrl"
        target="_blank"
        class="user-dropdown-item"
      >
        后台管理
      </a>
      <button class="user-dropdown-item" @click="handleLogout">
        退出登录
      </button>
    </div>
  </div>
  <a v-else-if="hasCookie('authMarker')" href="#" class="login-button" style="opacity:0.5">
    ...
  </a>
  <a v-else href="/login" class="login-button">
    登录
  </a>
</template>

<style scoped>
.user-menu {
  position: relative;
}

.user-menu-trigger {
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
}

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
}

.user-avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #0089ff;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}

.user-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  padding-top: 8px;
  min-width: 200px;
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 100;
  padding: 8px 0;
}

.user-info {
  padding: 8px 16px;
}

.user-name {
  display: block;
  font-weight: 600;
  color: var(--c-text-1);
  font-size: 14px;
}

.user-email {
  display: block;
  font-size: 12px;
  color: var(--c-text-2);
  margin-top: 2px;
}

.user-dropdown-divider {
  height: 1px;
  background: var(--c-border);
  margin: 4px 0;
}

.user-dropdown-item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  font-size: 14px;
  color: var(--c-text-1);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
}

.user-dropdown-item:hover {
  background: var(--c-hover);
}

.login-button {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--c-text-1);
  text-decoration: none;
}

.login-button:hover {
  color: var(--c-text-2);
}
</style>
