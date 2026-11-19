<script setup lang="ts">
// Component libraries dialog (plan/07 4.3). Browse reusable component
// libraries, publish the current selection as a new component, stamp stored
// components into the canvas, and export/import libraries as JSON files.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  AddLibraryComponentInput,
  ComponentLibraryDto,
  LibraryComponentDto,
} from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import {
  addLibraryComponent,
  createComponentLibrary,
  deleteComponentLibrary,
  importComponentLibrary,
  libraryExportFilename,
  listComponentLibraries,
  parseLibraryImport,
  removeLibraryComponent,
  serializeLibrary,
} from "../../services/component-libraries";
import { cloneWithNewIds } from "../canvas/clone-nodes";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();

const libraries = ref<ComponentLibraryDto[]>([]);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const actionBusy = ref<string | null>(null);

const selectedLibrary = computed(
  () => libraries.value.find((lib) => lib.id === selectedId.value) ?? null,
);

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
    const response = await listComponentLibraries();
    libraries.value = response.libraries;
    if (selectedId.value) {
      const stillThere = libraries.value.some((lib) => lib.id === selectedId.value);
      if (!stillThere) selectedId.value = null;
    }
    if (!selectedId.value && libraries.value.length > 0) {
      selectedId.value = libraries.value[0]!.id;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tải được thư viện component";
  } finally {
    loading.value = false;
  }
}

function openCreatePrompt() {
  const name = window.prompt("Tên thư viện component mới:");
  if (!name || !name.trim()) return;
  const description = window.prompt("Mô tả (tuỳ chọn):") ?? "";
  void createLibrary({ name: name.trim(), description });
}

async function createLibrary(input: { name: string; description?: string }) {
  actionBusy.value = "create";
  error.value = null;
  try {
    const lib = await createComponentLibrary(input);
    libraries.value = [...libraries.value, lib].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    selectedId.value = lib.id;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tạo được thư viện";
  } finally {
    actionBusy.value = null;
  }
}

async function removeLib(lib: ComponentLibraryDto) {
  if (!window.confirm(`Xóa thư viện "${lib.name}" và toàn bộ component?`)) return;
  actionBusy.value = lib.id;
  error.value = null;
  try {
    await deleteComponentLibrary(lib.id);
    libraries.value = libraries.value.filter((l) => l.id !== lib.id);
    if (selectedId.value === lib.id) selectedId.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không xóa được thư viện";
  } finally {
    actionBusy.value = null;
  }
}

function componentLabelFor(node: { type: string; props?: Record<string, unknown> }): string {
  const propLabel = node.props?.label ?? node.props?.text ?? node.props?.title;
  if (typeof propLabel === "string" && propLabel.trim()) {
    return propLabel.length > 24 ? `${propLabel.slice(0, 24)}…` : propLabel;
  }
  return node.type.replace(/^[a-z]+\./, "");
}

function categoryFromNode(node: { type: string }): string {
  return node.type.split(".")[0] ?? "custom";
}

/** Publish the currently selected canvas node into a chosen library. */
async function publishCurrentSelection(libId: string) {
  const node = doc.selectedNode;
  if (!node) {
    error.value = "Chọn một component trên canvas trước.";
    return;
  }
  const input: AddLibraryComponentInput = {
    type: node.type,
    label: componentLabelFor(node as { type: string; props?: Record<string, unknown> }),
    category: categoryFromNode(node),
    schema: node,
  };
  actionBusy.value = `pub:${libId}`;
  error.value = null;
  try {
    const created = await addLibraryComponent(libId, input);
    const lib = libraries.value.find((l) => l.id === libId);
    if (lib) lib.components = [...lib.components, created];
    selectedId.value = libId;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không lưu được component";
  } finally {
    actionBusy.value = null;
  }
}

/** Stamp a library component into the current page with fresh node ids. */
function stampComponent(comp: LibraryComponentDto) {
  if (!doc.document) return;
  const schema = comp.schema as Parameters<typeof cloneWithNewIds>[0][number];
  const [copy] = cloneWithNewIds([{ ...schema }]);
  if (!copy) return;
  const parentId = doc.document.root.id;
  doc.applyPatches([{ op: "add", parentId, node: copy }], `Chèn ${comp.label}`);
  close();
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
      const payload = parseLibraryImport(String(reader.result ?? ""));
      void (async () => {
        actionBusy.value = "import";
        try {
          const lib = await importComponentLibrary(payload);
          libraries.value = [...libraries.value, lib].sort((a, b) =>
            a.name.localeCompare(b.name),
          );
          selectedId.value = lib.id;
        } catch (e) {
          error.value = e instanceof Error ? e.message : "Không import được thư viện";
        } finally {
          actionBusy.value = null;
        }
      })();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Không đọc được file thư viện";
    }
  };
  reader.onerror = () => {
    error.value = "Không đọc được tệp JSON.";
  };
  reader.readAsText(file);
}

function exportLib(lib: ComponentLibraryDto) {
  error.value = null;
  const name = libraryExportFilename(lib.name);
  const url = URL.createObjectURL(
    new Blob([serializeLibrary(lib)], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function removeComp(comp: LibraryComponentDto) {
  if (!selectedId.value) return;
  actionBusy.value = comp.id;
  error.value = null;
  try {
    const result = await removeLibraryComponent(selectedId.value, comp.id);
    const lib = libraries.value.find((l) => l.id === selectedId.value);
    if (lib) lib.components = result.library.components;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không xóa được component";
  } finally {
    actionBusy.value = null;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
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
        aria-labelledby="component-libraries-title"
        class="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <aside class="flex w-72 shrink-0 flex-col border-r border-ds-border bg-slate-50">
          <div class="border-b border-ds-border p-3">
            <h2 id="component-libraries-title" class="text-sm font-semibold text-slate-800">
              Component libraries
            </h2>
            <p class="mt-1 text-[11px] leading-snug text-slate-400">
              Lưu trữ và chia sẻ component dùng lại giữa các dự án.
            </p>
          </div>

          <div class="flex flex-wrap gap-1 border-b border-ds-border p-2">
            <button
              class="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="actionBusy !== null"
              @click="openCreatePrompt"
            >
              + Thư viện mới
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
          </div>

          <div v-if="error" class="border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-600">
            {{ error }}
          </div>

          <div class="min-h-0 flex-1 overflow-auto p-2">
            <p v-if="loading" class="px-2 py-8 text-center text-xs text-slate-400">
              Đang tải…
            </p>
            <p v-else-if="libraries.length === 0" class="px-2 py-8 text-center text-xs leading-snug text-slate-400">
              Chưa có thư viện nào.
              <br />
              Tạo thư viện hoặc import file JSON.
            </p>
            <div
              v-for="lib in libraries"
              :key="lib.id"
              class="mb-1 rounded border p-2"
              :class="
                selectedId === lib.id
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-ds-border bg-white'
              "
              @click="selectedId = lib.id"
            >
              <div class="flex items-center justify-between gap-1">
                <p class="truncate text-xs font-semibold text-slate-700">{{ lib.name }}</p>
                <button
                  class="shrink-0 rounded px-1 text-[10px] text-red-500 hover:bg-red-50"
                  :disabled="actionBusy === lib.id"
                  @click.stop="removeLib(lib)"
                >
                  ✕
                </button>
              </div>
              <p class="mt-0.5 line-clamp-1 text-[10px] text-slate-400">
                {{ lib.description?.trim() || `${lib.components.length} components` }}
              </p>
            </div>
          </div>
        </aside>

        <main class="flex min-w-0 flex-1 flex-col">
          <template v-if="selectedLibrary">
            <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
              <div>
                <h3 class="text-sm font-semibold text-slate-800">
                  {{ selectedLibrary.name }}
                </h3>
                <p class="text-[11px] text-slate-400">
                  {{ selectedLibrary.components.length }} components
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  :disabled="!doc.selectedNode || actionBusy !== null"
                  :title="doc.selectedNode ? `Lưu component đang chọn` : 'Chọn 1 component trên canvas'"
                  @click="publishCurrentSelection(selectedLibrary.id)"
                >
                  {{
                    actionBusy === `pub:${selectedLibrary.id}`
                      ? "…"
                      : "＋ Lưu vùng chọn"
                  }}
                </button>
                <button
                  class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  @click="exportLib(selectedLibrary)"
                >
                  Export
                </button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-3">
              <p
                v-if="selectedLibrary.components.length === 0"
                class="px-2 py-8 text-center text-xs leading-snug text-slate-400"
              >
                Chưa có component.
                <br />
                Chọn một component trên canvas rồi bấm "＋ Lưu vùng chọn".
              </p>
              <div
                v-for="comp in selectedLibrary.components"
                :key="comp.id"
                class="mb-2 rounded border border-ds-border bg-white p-3"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-xs font-semibold text-slate-700">
                      {{ comp.label }}
                    </p>
                    <p class="mt-0.5 text-[10px] text-slate-400">
                      {{ comp.type }} · {{ comp.category }}
                    </p>
                    <div v-if="comp.tags.length" class="mt-1 flex flex-wrap gap-1">
                      <span
                        v-for="tag in comp.tags"
                        :key="tag"
                        class="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500"
                      >
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1">
                    <button
                      class="rounded bg-blue-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                      :disabled="!doc.document || actionBusy !== null"
                      :title="'Chèn vào trang hiện tại'"
                      @click="stampComponent(comp)"
                    >
                      Chèn
                    </button>
                    <button
                      class="rounded px-1.5 py-1 text-[10px] text-red-500 hover:bg-red-50 disabled:opacity-40"
                      :disabled="actionBusy === comp.id"
                      @click="removeComp(comp)"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div class="mt-2 h-12 overflow-hidden rounded border border-slate-100 bg-slate-50 px-2 py-1 font-mono text-[9px] text-slate-400">
                  preview:{{ comp.type }}
                </div>
              </div>
            </div>
          </template>

          <div
            v-else
            class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
          >
            <span class="text-3xl">🧱</span>
            <p class="text-sm font-medium text-slate-600">Chọn một thư viện component</p>
            <p class="max-w-sm text-[11px] text-slate-400">
              Tạo thư viện, lưu component từ canvas, rồi chèn vào bất kỳ trang nào
              trong dự án của bạn.
            </p>
          </div>
        </main>
      </div>
    </div>
  </Teleport>
</template>
