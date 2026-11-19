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
  <div class="mx-auto max-w-5xl px-6 py-10">
    <h1 class="text-2xl font-bold text-slate-900">Dự án của bạn</h1>
    <p class="mt-1 text-sm text-slate-500">
      Tạo một dự án để bắt đầu: AI sẽ vẽ mockup từ mô tả của bạn, sau đó bạn
      có thể chỉnh sửa qua hội thoại.
    </p>

    <form class="mt-6 flex flex-col gap-3 rounded-lg border border-ds-border bg-white p-4" @submit.prevent="onCreate">
      <input
        v-model="form.name"
        class="rounded-md border border-ds-border px-3 py-2 text-sm outline-none focus:border-blue-500"
        placeholder="Tên dự án (vd: CRM Dashboard)"
        maxlength="120"
        required
      />
      <input
        v-model="form.description"
        class="rounded-md border border-ds-border px-3 py-2 text-sm outline-none focus:border-blue-500"
        placeholder="Mô tả (tùy chọn)"
        maxlength="2000"
      />
      <button
        class="self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        :disabled="!form.name.trim()"
      >
        + Tạo dự án
      </button>
      <p
        v-if="projects.error"
        class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
        role="alert"
      >
        {{ projects.error }}
      </p>
    </form>

    <div class="mt-6">
      <p v-if="projects.isLoading" class="text-sm text-slate-400">Đang tải…</p>
      <p v-else-if="projects.projects.length === 0" class="text-sm text-slate-400">
        Chưa có dự án nào.
      </p>
      <ul v-else class="space-y-2">
        <li
          v-for="p in projects.projects"
          :key="p.id"
          class="flex items-center justify-between rounded-lg border border-ds-border bg-white px-4 py-3"
        >
          <button class="text-left" @click="router.push(`/workspace/${p.id}`)">
            <span class="font-medium text-slate-900">{{ p.name }}</span>
            <span v-if="p.description" class="block text-xs text-slate-500">{{ p.description }}</span>
          </button>
          <div class="flex shrink-0 items-center gap-3 text-xs">
            <button class="text-slate-500 hover:text-slate-800 hover:underline" @click="onRename(p)">
              Đổi tên
            </button>
            <button class="text-slate-500 hover:text-slate-800 hover:underline" @click="onDuplicate(p)">
              Nhân bản
            </button>
            <button class="text-red-500 hover:underline" @click="onDelete(p.id)">
              Xóa
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
