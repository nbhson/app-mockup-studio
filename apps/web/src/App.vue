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
      class="h-12 shrink-0 flex items-center justify-between border-b border-ds-border bg-white px-4"
    >
      <div class="flex items-center gap-2 font-semibold text-slate-900">
        <span class="grid h-6 w-6 place-items-center rounded-md bg-blue-600 text-xs text-white">AI</span>
        Mockup Studio
      </div>
      <nav class="flex items-center gap-1 text-sm text-slate-500">
        <RouterLink to="/projects" class="rounded px-2 py-1 hover:bg-slate-100">
          Dự án
        </RouterLink>
      </nav>
    </header>

    <main class="min-h-0 flex-1">
      <RouterView />
    </main>
  </div>
</template>
