<script setup lang="ts">
import { onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import type { ProjectDto } from "@ai-mockup-studio/shared-types";
import { useProjectsStore } from "../../stores/projects";

const router = useRouter();
const projects = useProjectsStore();
const form = reactive({ name: "", description: "" });

onMounted(() => {
  void projects.list().catch(() => undefined);
});

/** "vừa xong / N phút / N giờ / N ngày trước" — relative freshness on cards. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

/** Initials for the card avatar (max 2 chars, Vietnamese-diacritic safe). */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

async function onCreate() {
  if (!form.name.trim()) return;
  try {
    const project = await projects.create(form.name.trim(), form.description.trim());
    form.name = "";
    form.description = "";
    router.push(`/workspace/${project.id}`);
  } catch {
    // store records `error`; the banner below shows it
  }
}

async function onRename(project: ProjectDto) {
  const name = window.prompt("Tên dự án mới", project.name)?.trim();
  if (!name || name === project.name) return;
  try {
    await projects.update(project.id, { name });
  } catch {
    void projects.list().catch(() => undefined);
  }
}

async function onDuplicate(project: ProjectDto) {
  try {
    const copy = await projects.duplicate(project.id);
    router.push(`/workspace/${copy.id}`);
  } catch {
    // error banner
  }
}

async function onDelete(id: string) {
  if (!window.confirm("Xóa dự án này?")) return;
  try {
    await projects.remove(id);
  } catch {
    // error banner
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
    <h1 class="text-2xl font-bold text-ink">Dự án của bạn</h1>
    <p class="mt-1 text-sm text-ink-muted">
      Tạo một dự án để bắt đầu: AI sẽ vẽ mockup từ mô tả của bạn, sau đó bạn
      có thể chỉnh sửa qua hội thoại.
    </p>

    <form
      class="mt-6 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      @submit.prevent="onCreate"
    >
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-soft">
          Tên dự án <span class="text-danger-text" aria-hidden="true">*</span>
        </span>
        <input
          v-model="form.name"
          class="field-input"
          placeholder="vd: CRM Dashboard"
          maxlength="120"
          required
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-ink-soft">
          Mô tả <span class="text-ink-muted">(tùy chọn)</span>
        </span>
        <input
          v-model="form.description"
          class="field-input"
          placeholder="Mục tiêu, đối tượng, phong cách…"
          maxlength="2000"
        />
      </label>
      <button class="btn btn-primary sm:mb-px" :disabled="!form.name.trim()">
        <span aria-hidden="true" class="text-base leading-none">+</span>
        Tạo dự án
      </button>
      <p
        v-if="projects.error"
        class="fade-in rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger-text sm:col-span-3"
        role="alert"
      >
        {{ projects.error }}
      </p>
    </form>

    <section class="mt-6" aria-label="Danh sách dự án" aria-live="polite">
      <!-- Loading: skeleton cards (shimmer stops under prefers-reduced-motion) -->
      <div
        v-if="projects.isLoading"
        class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div
          v-for="n in 6"
          :key="n"
          class="rounded-lg border border-line bg-surface p-4"
        >
          <div class="flex items-center gap-3">
            <div class="skeleton h-9 w-9 rounded-md" />
            <div class="min-w-0 flex-1 space-y-2">
              <div class="skeleton h-3.5 w-2/3" />
              <div class="skeleton h-3 w-1/3" />
            </div>
          </div>
          <div class="skeleton mt-4 h-3 w-full" />
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else-if="projects.projects.length === 0"
        class="fade-in rounded-lg border border-dashed border-line bg-surface-muted px-6 py-12 text-center"
      >
        <div
          class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-xl"
          aria-hidden="true"
        >
          📦
        </div>
        <p class="mt-3 text-sm font-semibold text-ink">Chưa có dự án nào</p>
        <p class="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          Nhập tên dự án vào form phía trên — AI sẽ dựng mockup đầu tiên cho bạn
          chỉ với một câu mô tả.
        </p>
      </div>

      <!-- Project cards -->
      <ul v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li
          v-for="(p, i) in projects.projects"
          :key="p.id"
          class="rise-in card-hover flex flex-col rounded-lg border border-line bg-surface p-4"
          :style="{ '--i': Math.min(i, 8) }"
        >
          <button
            class="flex min-w-0 flex-1 items-start gap-3 text-left"
            :title="`Mở dự án ${p.name}`"
            @click="router.push(`/workspace/${p.id}`)"
          >
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-soft text-xs font-semibold text-primary-text"
              aria-hidden="true"
            >
              {{ initials(p.name) }}
            </span>
            <span class="min-w-0">
              <span class="block truncate font-medium text-ink">{{ p.name }}</span>
              <span
                v-if="p.description"
                class="mt-0.5 line-clamp-2 block text-xs text-ink-muted"
                >{{ p.description }}</span
              >
              <span class="mt-1 block text-[11px] text-ink-muted">
                Sửa {{ timeAgo(p.updatedAt) }}
              </span>
            </span>
          </button>
          <div class="mt-3 flex items-center gap-1 border-t border-line pt-2 text-xs">
            <button class="tb-btn" @click="onRename(p)">Đổi tên</button>
            <button class="tb-btn" @click="onDuplicate(p)">Nhân bản</button>
            <button class="tb-btn tb-btn-danger ml-auto" @click="onDelete(p.id)">
              Xóa
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
