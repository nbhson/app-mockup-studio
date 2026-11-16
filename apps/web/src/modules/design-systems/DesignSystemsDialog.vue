<script setup lang="ts">
// Design systems dialog (plan/07 4.8). Manage reusable token sets, import and
// export them as JSON, and apply one system to every page in the project.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Theme } from "@ai-mockup-studio/ui-schema";
import type { DesignSystemDto } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import {
  createDesignSystem,
  deleteDesignSystem,
  designSystemExportFilename,
  designSystemFromDocument,
  designSystemFromTheme,
  listDesignSystems,
  parseDesignSystemTokens,
  serializeDesignSystemTokens,
  updateDesignSystem,
} from "../../services/design-systems";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();

const systems = ref<DesignSystemDto[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const actionBusy = ref<string | null>(null);
const editingId = ref<string | null>(null);
const formName = ref("");
const formDescription = ref("");
const formTheme = ref<Theme>(defaultLightTheme());

const activeSystem = computed(
  () => systems.value.find((system) => system.id === doc.designSystemId) ?? null,
);

type ColorThemeKey =
  | "primary"
  | "primaryForeground"
  | "background"
  | "foreground"
  | "muted"
  | "mutedForeground"
  | "border";

const colorFields: { key: ColorThemeKey; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "primaryForeground", label: "Primary text" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "border", label: "Border" },
];

/** Swatches shown on every card in the list. */
const previewKeys: ColorThemeKey[] = [
  "primary",
  "background",
  "foreground",
  "border",
];

function defaultLightTheme(): Theme {
  return {
    mode: "light",
    primary: "#2563EB",
    primaryForeground: "#FFFFFF",
    background: "#FFFFFF",
    foreground: "#0F172A",
    muted: "#F1F5F9",
    mutedForeground: "#64748B",
    border: "#E2E8F0",
    fontFamily: "Inter",
    radius: 8,
  };
}

function close() {
  error.value = null;
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const response = await listDesignSystems();
    systems.value = response.designSystems;
    if (
      doc.designSystemId &&
      !systems.value.some((system) => system.id === doc.designSystemId)
    ) {
      doc.designSystemId = null;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tải được design system";
  } finally {
    loading.value = false;
  }
}

function openCreate(system?: DesignSystemDto) {
  editingId.value = system?.id ?? null;
  formName.value = system?.name ?? "New design system";
  formDescription.value = system?.description ?? "";
  formTheme.value = { ...(system?.theme ?? defaultLightTheme()) };
  error.value = null;
}

/** Prefill the form with the tokens of the mockup currently open. */
function openFromDocument() {
  const current = doc.document;
  if (!current) {
    error.value = "Chưa có mockup để tạo design system.";
    return;
  }
  const seed = designSystemFromDocument(current, current.name || "New design system");
  editingId.value = null;
  formName.value = seed.name;
  formDescription.value = seed.description ?? "";
  formTheme.value = { ...seed.theme };
  error.value = null;
}

async function saveForm() {
  const name = formName.value.trim();
  if (!name) {
    error.value = "Design system cần có tên.";
    return;
  }

  const busyId = editingId.value ?? "create";
  actionBusy.value = busyId;
  error.value = null;
  try {
    if (editingId.value) {
      const updated = await updateDesignSystem(editingId.value, {
        name,
        description: formDescription.value.trim(),
        theme: { ...formTheme.value },
      });
      systems.value = systems.value.map((system) =>
        system.id === updated.id ? updated : system,
      );
    } else {
      const input = designSystemFromTheme(
        formTheme.value,
        name,
        formDescription.value,
      );
      const created = await createDesignSystem(input);
      systems.value = [...systems.value, created].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
    editingId.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không lưu được design system";
  } finally {
    actionBusy.value = null;
  }
}

function cancelForm() {
  editingId.value = null;
  error.value = null;
}

async function apply(system: DesignSystemDto) {
  if (!doc.projectId) return;
  actionBusy.value = system.id;
  error.value = null;
  try {
    await doc.applyDesignSystem(system.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không áp dụng được design system";
  } finally {
    actionBusy.value = null;
  }
}

async function detach() {
  if (!doc.projectId) return;
  actionBusy.value = doc.designSystemId ?? "detach";
  error.value = null;
  try {
    await doc.applyDesignSystem(null);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không gỡ được design system";
  } finally {
    actionBusy.value = null;
  }
}

async function remove(system: DesignSystemDto) {
  if (!window.confirm(`Xóa design system "${system.name}"?`)) return;
  actionBusy.value = system.id;
  error.value = null;
  try {
    const response = await deleteDesignSystem(system.id);
    systems.value = response.designSystems;
    if (doc.designSystemId === system.id) doc.designSystemId = null;
    if (editingId.value === system.id) cancelForm();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không xóa được design system";
  } finally {
    actionBusy.value = null;
  }
}

function exportSystem(system: DesignSystemDto) {
  error.value = null;
  const name = designSystemExportFilename(system.name);
  const url = URL.createObjectURL(
    new Blob([serializeDesignSystemTokens(system)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  error.value = null;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseDesignSystemTokens(
        String(reader.result ?? ""),
        file.name.replace(/\.json$/i, ""),
      );
      editingId.value = null;
      formName.value = parsed.name;
      formDescription.value = parsed.description ?? "";
      formTheme.value = { ...parsed.theme };
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Không đọc được file token";
    }
  };
  reader.onerror = () => {
    error.value = "Không đọc được tệp JSON.";
  };
  reader.readAsText(file);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
      cancelForm();
      window.addEventListener("keydown", onKeydown);
      void load();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-systems-title"
        class="flex h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <aside class="flex w-80 shrink-0 flex-col border-r border-ds-border bg-slate-50">
          <div class="border-b border-ds-border p-3">
            <h2 id="design-systems-title" class="text-sm font-semibold text-slate-800">
              Design systems
            </h2>
            <p class="mt-1 text-[11px] leading-snug text-slate-400">
              Token dùng chung cho project. Áp dụng sẽ cập nhật theme của tất cả
              trang.
            </p>
          </div>

          <div class="flex flex-wrap gap-1 border-b border-ds-border p-2">
            <button
              class="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="!doc.document"
              @click="openFromDocument"
            >
              + Từ mockup
            </button>
            <label
              class="cursor-pointer rounded border border-ds-border bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            >
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                class="hidden"
                @change="onImportFile"
              />
            </label>
            <button
              class="rounded border border-ds-border bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              :disabled="loading"
              @click="load"
            >
              Làm mới
            </button>
          </div>

          <div v-if="error" class="border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            {{ error }}
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-2">
            <p v-if="loading" class="px-2 py-8 text-center text-xs text-slate-400">
              Đang tải…
            </p>
            <p v-else-if="systems.length === 0" class="px-2 py-8 text-center text-xs leading-snug text-slate-400">
              Chưa có design system.
              <br />
              Tạo một bộ từ mockup hoặc import file JSON.
            </p>
            <div
              v-for="system in systems"
              :key="system.id"
              class="mb-2 rounded border border-ds-border bg-white p-2"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-xs font-semibold text-slate-700">
                    {{ system.name }}
                  </p>
                  <p class="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-400">
                    {{ system.description ?? `${system.theme.mode} · ${system.theme.fontFamily}` }}
                  </p>
                </div>
                <span
                  v-if="doc.designSystemId === system.id"
                  class="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700"
                >
                  active
                </span>
              </div>

              <div class="mt-2 flex gap-1">
                <span
                  v-for="key in previewKeys"
                  :key="key"
                  class="h-5 flex-1 rounded border border-slate-200"
                  :style="{ backgroundColor: system.theme[key] }"
                  :title="`${key}: ${system.theme[key]}`"
                />
              </div>

              <div class="mt-2 flex flex-wrap items-center gap-1">
                <button
                  class="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  :disabled="!doc.projectId || actionBusy === system.id"
                  @click="apply(system)"
                >
                  {{ actionBusy === system.id ? "…" : "Áp dụng" }}
                </button>
                <button
                  v-if="doc.designSystemId === system.id"
                  class="rounded border border-ds-border px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  :disabled="actionBusy !== null"
                  @click="detach"
                >
                  Gỡ
                </button>
                <button
                  class="rounded border border-ds-border px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
                  @click="openCreate(system)"
                >
                  Sửa
                </button>
                <button
                  class="rounded border border-ds-border px-2 py-1 text-[10px] text-slate-600 hover:bg-slate-50"
                  @click="exportSystem(system)"
                >
                  Export
                </button>
                <button
                  class="ml-auto rounded px-1.5 py-1 text-[10px] text-red-500 hover:bg-red-50"
                  :disabled="actionBusy === system.id"
                  @click="remove(system)"
                >
                  Xóa
                </button>
              </div>
            </div>
          </div>

          <div class="border-t border-ds-border p-2 text-[10px] text-slate-400">
            <span v-if="activeSystem">Đang áp dụng: {{ activeSystem.name }}</span>
            <span v-else>Project dùng theme riêng của từng document.</span>
          </div>
        </aside>

        <main class="flex min-w-0 flex-1 flex-col">
          <div
            v-if="!editingId && !formName"
            class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
          >
            <span class="text-3xl">🎛️</span>
            <p class="text-sm font-medium text-slate-600">
              Chọn một design system để chỉnh token
            </p>
            <p class="max-w-sm text-[11px] text-slate-400">
              Bạn có thể export token sang JSON để chia sẻ team hoặc import một bộ
              token khác rồi áp dụng cho toàn bộ các trang.
            </p>
          </div>

          <template v-else>
            <div class="border-b border-ds-border px-4 py-3">
              <h3 class="text-sm font-semibold text-slate-800">
                {{ editingId ? "Chỉnh design system" : "Design system mới" }}
              </h3>
              <p class="text-[11px] text-slate-400">
                Lưu token trước, sau đó bấm Apply để cập nhật toàn bộ project.
              </p>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <label class="text-[11px] text-slate-500">
                  Tên
                  <input
                    v-model="formName"
                    maxlength="120"
                    class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
                <label class="text-[11px] text-slate-500 sm:col-span-2">
                  Mô tả
                  <input
                    v-model="formDescription"
                    maxlength="2000"
                    class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-400"
                  />
                </label>
                <label class="text-[11px] text-slate-500">
                  Mode
                  <select
                    v-model="formTheme.mode"
                    class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs"
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label class="text-[11px] text-slate-500">
                  Radius
                  <input
                    v-model.number="formTheme.radius"
                    type="number"
                    min="0"
                    max="40"
                    class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs"
                  />
                </label>
                <label class="text-[11px] text-slate-500 sm:col-span-2">
                  Font family
                  <input
                    v-model="formTheme.fontFamily"
                    maxlength="120"
                    class="mt-1 w-full rounded border border-ds-border px-2 py-1 text-xs"
                  />
                </label>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-2">
                <label
                  v-for="field in colorFields"
                  :key="field.key"
                  class="text-[11px] text-slate-500"
                >
                  {{ field.label }}
                  <div class="mt-1 flex gap-1">
                    <input
                      :value="formTheme[field.key]"
                      type="color"
                      class="h-8 w-10 rounded border border-ds-border"
                      @change="
                        formTheme[field.key] = ($event.target as HTMLInputElement).value
                      "
                    />
                    <input
                      v-model="formTheme[field.key]"
                      class="min-w-0 flex-1 rounded border border-ds-border px-2 py-1 font-mono text-[10px]"
                    />
                  </div>
                </label>
              </div>

              <div class="mt-4 rounded-lg border border-ds-border p-4">
                <div
                  class="rounded p-3"
                  :style="{
                    backgroundColor: formTheme.background,
                    color: formTheme.foreground,
                    fontFamily: formTheme.fontFamily,
                  }"
                >
                  <p class="text-sm font-semibold">Bảng xem trước token</p>
                  <p class="mt-1 text-xs" :style="{ color: formTheme.mutedForeground }">
                    Secondary text · {{ formTheme.mode }} mode · radius {{ formTheme.radius }}px
                  </p>
                  <div class="mt-3 flex gap-2">
                    <button
                      class="rounded px-3 py-1 text-xs font-medium"
                      :style="{
                        backgroundColor: formTheme.primary,
                        color: formTheme.primaryForeground,
                        borderRadius: `${formTheme.radius}px`,
                      }"
                    >
                      Primary
                    </button>
                    <span
                      class="rounded px-3 py-1 text-xs"
                      :style="{
                        border: `1px solid ${formTheme.border}`,
                        backgroundColor: formTheme.muted,
                        color: formTheme.mutedForeground,
                        borderRadius: `${formTheme.radius}px`,
                      }"
                    >
                      Muted
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div class="flex items-center justify-end gap-2 border-t border-ds-border px-4 py-3">
              <button
                class="rounded border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                @click="cancelForm"
              >
                Hủy
              </button>
              <button
                class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                :disabled="!formName.trim() || actionBusy !== null"
                @click="saveForm"
              >
                {{ editingId ? "Lưu token" : "Tạo design system" }}
              </button>
            </div>
          </template>
        </main>
      </div>
    </div>
  </Teleport>
</template>
