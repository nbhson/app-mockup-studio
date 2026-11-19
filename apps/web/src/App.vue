<script setup lang="ts">
// Root shell: a simple top bar + routed content (projects / workspace).
// Public share links render their own read-only shell (no editor nav).
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const isPublicShare = computed(() => route.meta.public === true);
</script>

<template>
  <div class="h-full w-full flex flex-col">
    <header
      v-if="!isPublicShare"
      class="h-12 shrink-0 flex items-center justify-between border-b border-line bg-surface px-4"
    >
      <RouterLink to="/projects" class="brand" title="Mockup Studio — về danh sách dự án">
        <span class="brand-mark">AI</span>
        Mockup Studio
      </RouterLink>
      <nav class="flex items-center gap-1 text-sm" aria-label="Chính">
        <RouterLink to="/projects" class="nav-link" active-class="nav-link-active">
          Dự án
        </RouterLink>
      </nav>
    </header>

    <main class="min-h-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border-radius: 0.375rem;
  font-weight: 600;
  color: var(--color-ink);
}
.brand-mark {
  display: grid;
  height: 1.5rem;
  width: 1.5rem;
  place-items: center;
  border-radius: 0.375rem;
  background: var(--color-primary);
  font-size: 0.75rem;
  color: #fff;
  transition: transform var(--motion-duration-instant) var(--motion-ease-standard);
}
.brand:active .brand-mark {
  transform: scale(0.92);
}
.nav-link {
  border-radius: 0.375rem;
  padding: 0.375rem 0.625rem;
  font-weight: 500;
  color: var(--color-ink-muted);
  transition:
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard);
}
.nav-link:hover {
  background: var(--color-surface-hover);
  color: var(--color-ink);
}
.nav-link-active,
.nav-link-active:hover {
  background: var(--color-primary-soft);
  color: var(--color-primary-text);
}
</style>
