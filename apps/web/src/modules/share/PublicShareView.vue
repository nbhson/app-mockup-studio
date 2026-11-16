<script setup lang="ts">
// Public/private share viewer (plan/07 4.7). Read-only: renders the shared
// project's pages with the same resolved tree as the canvas, never mounts the
// editor or executes AI-provided code.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { resolveNode, type ResolvedElement } from "@ai-mockup-studio/ui-renderer";
import type { PublicShareResponse } from "@ai-mockup-studio/shared-types";
import { ApiError, api } from "../../services/api";
import SchemaNode from "../canvas/SchemaNode.vue";

type DeviceMode = "desktop" | "tablet" | "mobile";

const route = useRoute();

const share = ref<PublicShareResponse | null>(null);
const loading = ref(true);
const unlocking = ref(false);
const needsPassword = ref(false);
const password = ref("");
const passwordError = ref<string | null>(null);
const generalError = ref<string | null>(null);
const activeIndex = ref(0);
const device = ref<DeviceMode>("desktop");
const windowWidth = ref(window.innerWidth);

const devices: { id: DeviceMode; label: string; width: number | null }[] = [
  { id: "desktop", label: "Desktop", width: null },
  { id: "tablet", label: "Tablet", width: 768 },
  { id: "mobile", label: "Mobile", width: 390 },
];

const currentPage = computed(
  () => share.value?.pages[activeIndex.value] ?? null,
);

const resolved = computed<ResolvedElement | null>(() => {
  const page = currentPage.value;
  if (!page) return null;
  return resolveNode(page.document.root, page.document.theme, undefined, device.value);
});

const pageWidth = computed(() => {
  const page = currentPage.value;
  if (!page) return 1280;
  if (device.value === "tablet") return 768;
  if (device.value === "mobile") return 390;
  return page.document.viewport.width;
});

const scale = computed(() => {
  if (device.value !== "desktop" || !currentPage.value) return 1;
  const available = Math.max(320, windowWidth.value - 48);
  return Math.min(1, Math.max(0.1, available / pageWidth.value));
});

const pageThemeStyle = computed<Record<string, string>>(() => {
  const page = currentPage.value;
  if (!page) return {};
  const theme = page.document.theme;
  const style: Record<string, string> = {
    backgroundColor: theme.background,
    color: theme.foreground,
    fontFamily: theme.fontFamily,
    "--color-ds-primary": theme.primary,
    "--color-ds-background": theme.background,
    "--color-ds-foreground": theme.foreground,
    "--color-ds-muted": theme.muted,
    "--color-ds-muted-foreground": theme.mutedForeground,
    "--color-ds-border": theme.border,
  };
  return style;
});

const pageStyle = computed(() => {
  const page = currentPage.value;
  if (!page) return {};
  return {
    width: `${pageWidth.value}px`,
    minHeight: `${page.document.viewport.height}px`,
    zoom: String(scale.value),
    ...pageThemeStyle.value,
  };
});

async function load(withPassword?: string) {
  loading.value = !share.value;
  generalError.value = null;
  passwordError.value = null;
  try {
    const headers: Record<string, string> = {};
    if (withPassword) headers["x-share-password"] = withPassword;
    const res = await api.get<PublicShareResponse>(
      `/share/${encodeURIComponent(String(route.params.token))}`,
      { headers },
    );
    share.value = res;
    needsPassword.value = false;
    activeIndex.value = 0;
    password.value = "";
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 401) {
      needsPassword.value = true;
      if (withPassword) passwordError.value = e.message;
    } else {
      share.value = null;
      needsPassword.value = false;
      generalError.value =
        e instanceof ApiError
          ? e.message
          : "Không tải được link chia sẻ. Vui lòng thử lại.";
    }
  } finally {
    loading.value = false;
  }
}

async function unlock() {
  if (!password.value || unlocking.value) return;
  unlocking.value = true;
  await load(password.value);
  unlocking.value = false;
}

function onResize() {
  windowWidth.value = window.innerWidth;
}

onMounted(() => {
  window.addEventListener("resize", onResize);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  document.title = "AI Mockup Studio";
});

watch(
  () => route.params.token,
  () => {
    share.value = null;
    needsPassword.value = false;
    password.value = "";
    void load();
  },
);

watch(share, (value) => {
  if (value) document.title = `${value.projectName} · AI Mockup Studio`;
});
</script>

<template>
  <div class="flex h-full flex-col bg-slate-100">
    <header class="flex h-12 shrink-0 items-center gap-3 border-b border-ds-border bg-white px-4">
      <div class="flex items-center gap-2 font-semibold text-slate-900">
        <span class="grid h-6 w-6 place-items-center rounded-md bg-blue-600 text-xs text-white">AI</span>
        <span class="hidden sm:inline">Mockup Studio</span>
      </div>
      <span class="h-4 w-px bg-slate-200" />
      <span class="min-w-0 truncate text-sm font-medium text-slate-700">
        {{ share?.projectName ?? "Bản xem trước" }}
      </span>
      <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Chỉ xem
      </span>
      <span
        v-if="share?.visibility === 'private'"
        class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
      >
        Riêng tư
      </span>

      <div v-if="share" class="ml-auto flex items-center gap-1">
        <button
          v-for="item in devices"
          :key="item.id"
          class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
          :class="
            device === item.id
              ? 'bg-blue-50 text-blue-700'
              : 'text-slate-500 hover:bg-slate-100'
          "
          :aria-pressed="device === item.id"
          @click="device = item.id"
        >
          {{ item.label }}
        </button>
      </div>
    </header>

    <nav
      v-if="share && share.pages.length > 1"
      class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-ds-border bg-white/80 px-3 text-xs"
    >
      <button
        v-for="(page, index) in share.pages"
        :key="page.slug"
        class="shrink-0 rounded px-2 py-1 font-medium transition-colors"
        :class="
          index === activeIndex
            ? 'bg-blue-50 text-blue-700'
            : 'text-slate-500 hover:bg-slate-100'
        "
        :aria-current="index === activeIndex ? 'page' : undefined"
        @click="activeIndex = index"
      >
        {{ page.name }}
      </button>
    </nav>

    <main class="min-h-0 flex-1 overflow-auto p-6">
      <div v-if="loading" class="mx-auto mt-24 w-fit text-sm text-slate-500">
        Đang tải bản xem trước…
      </div>

      <div
        v-else-if="generalError"
        class="mx-auto mt-24 max-w-sm rounded-lg border border-red-100 bg-white p-6 text-center shadow-sm"
      >
        <p class="text-2xl">🔒</p>
        <h1 class="mt-2 text-sm font-semibold text-slate-800">
          Không mở được link
        </h1>
        <p class="mt-1 text-xs text-slate-500">{{ generalError }}</p>
      </div>

      <div
        v-else-if="needsPassword && !share"
        class="mx-auto mt-24 max-w-sm rounded-lg border border-ds-border bg-white p-6 shadow-sm"
      >
        <h1 class="text-sm font-semibold text-slate-800">Link riêng tư</h1>
        <p class="mt-1 text-xs text-slate-500">
          Nhập mật khẩu để xem bản xem trước của dự án.
        </p>
        <form class="mt-4 flex flex-col gap-2" @submit.prevent="unlock">
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="Mật khẩu"
            class="w-full rounded-md border border-ds-border px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <p v-if="passwordError" class="text-xs text-red-500">{{ passwordError }}</p>
          <button
            type="submit"
            class="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="unlocking || !password"
          >
            {{ unlocking ? "Đang mở…" : "Xem bản xem trước" }}
          </button>
        </form>
      </div>

      <div v-else-if="share && !currentPage" class="mx-auto mt-24 w-fit text-sm text-slate-500">
        Dự án chưa có trang nào để hiển thị.
      </div>

      <div v-else-if="currentPage" class="mx-auto w-fit">
        <div
          data-page
          class="relative bg-white shadow-sm"
          :style="pageStyle"
        >
          <SchemaNode v-if="resolved" :element="resolved" :selectable="false" />
        </div>
      </div>
    </main>

    <footer
      v-if="share"
      class="flex h-8 shrink-0 items-center justify-between border-t border-ds-border bg-white px-4 text-[10px] text-slate-400"
    >
      <span>{{ share.pages.length }} trang · chia sẻ bằng AI Mockup Studio</span>
      <span v-if="share.expiresAt">Hết hạn {{ new Date(share.expiresAt).toLocaleDateString("vi-VN") }}</span>
      <span v-else>Không hết hạn</span>
    </footer>
  </div>
</template>
