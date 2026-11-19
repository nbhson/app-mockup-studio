<script setup lang="ts">
// Asset manager dialog (plan/12 GĐ 5.4). Upload an image, then either replace
// the selected Image node or insert a new one into the selected container.
import { onBeforeUnmount, ref, watch } from "vue";
import type { AssetDto } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import {
  ACCEPTED_ASSET_TYPES,
  assetSizeLabel,
  useAssetsStore,
} from "../../stores/assets";
import { buildNodeFromType } from "../../stores/editor";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();
const assets = useAssetsStore();
const fileInput = ref<HTMLInputElement | null>(null);
const actionError = ref<string | null>(null);

const accept = ACCEPTED_ASSET_TYPES.join(",");

function close() {
  actionError.value = null;
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      actionError.value = null;
      assets.error = null;
      window.addEventListener("keydown", onKeydown);
      if (doc.projectId) void assets.list(doc.projectId);
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !doc.projectId) return;
  assets.error = null;
  await assets.upload(doc.projectId, file);
}

async function onDelete(asset: AssetDto) {
  if (!doc.projectId) return;
  if (!window.confirm(`Xóa ảnh "${asset.fileName}"? Ảnh đang dùng trong mockup sẽ bị mất.`)) {
    return;
  }
  await assets.remove(doc.projectId, asset.id);
}

function useAsset(asset: AssetDto) {
  if (!doc.document) return;
  actionError.value = null;

  const selected = doc.selectedNode;
  try {
    if (selected && selected.type === "basic.image") {
      doc.applyPatches(
        [
          {
            op: "update",
            targetId: selected.id,
            changes: {
              "props.src": asset.url,
              "props.alt": asset.fileName,
            },
          },
        ],
        "Thay ảnh",
      );
    } else {
      const node = buildNodeFromType("basic.image");
      if (!node) throw new Error("Không tạo được component ảnh");
      node.props = { ...node.props, src: asset.url, alt: asset.fileName };
      const parentId =
        selected && selected.children !== undefined
          ? selected.id
          : doc.document.root.id;
      doc.applyPatches(
        [{ op: "add", parentId, node }],
        `Thêm ảnh ${asset.fileName}`,
      );
      doc.setSelection([node.id], node.id);
    }
    close();
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : "Không dùng được ảnh này";
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-[1.5px] p-4"
      @click.self="close"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assets-title"
        class="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="assets-title" class="text-sm font-semibold text-slate-800">
              Ảnh của dự án
            </h2>
            <p class="text-[11px] text-slate-400">
              PNG, JPEG, WebP, GIF · tối đa 2 MB
            </p>
          </div>
          <button
            class="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Đóng (Esc)"
            @click="close"
          >
            ✕
          </button>
        </div>

        <div class="border-b border-ds-border px-4 py-3">
          <div class="flex items-center gap-2">
            <button
              class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              :disabled="assets.isUploading || !doc.projectId"
              @click="fileInput?.click()"
            >
              {{ assets.isUploading ? "Đang tải lên…" : "Tải ảnh lên" }}
            </button>
            <span class="text-[11px] text-slate-400">
              Chọn một component Image để thay thế, hoặc ảnh sẽ được thêm vào container đang chọn.
            </span>
          </div>
          <input
            ref="fileInput"
            type="file"
            class="hidden"
            :accept="accept"
            @change="onFilesPicked"
          />
          <p
            v-if="assets.error"
            class="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-600"
          >
            {{ assets.error }}
          </p>
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-3">
          <p v-if="assets.isLoading" class="py-8 text-center text-sm text-slate-400">
            Đang tải ảnh…
          </p>
          <p
            v-else-if="assets.assets.length === 0"
            class="py-8 text-center text-sm text-slate-400"
          >
            Chưa có ảnh nào. Tải ảnh đầu tiên để dùng trong mockup.
          </p>
          <ul v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <li
              v-for="asset in assets.assets"
              :key="asset.id"
              class="overflow-hidden rounded-md border border-ds-border bg-white"
            >
              <img
                :src="asset.url"
                :alt="asset.fileName"
                class="h-20 w-full bg-slate-100 object-cover"
                loading="lazy"
              />
              <div class="space-y-1 px-2 py-1.5">
                <p class="truncate text-[11px] font-medium text-slate-700" :title="asset.fileName">
                  {{ asset.fileName }}
                </p>
                <div class="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{{ assetSizeLabel(asset.size) }}</span>
                  <div class="flex gap-2">
                    <button
                      class="font-medium text-blue-600 hover:underline"
                      title="Dùng ảnh này"
                      @click="useAsset(asset)"
                    >
                      Dùng
                    </button>
                    <button
                      class="text-red-500 hover:underline"
                      title="Xóa ảnh"
                      @click="onDelete(asset)"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <p v-if="actionError" class="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          {{ actionError }}
        </p>
        <p class="border-t border-ds-border px-4 py-2 text-[11px] text-slate-400">
          Ảnh được lưu trong cơ sở dữ liệu của dự án và xuất hiện khi export PNG/SVG.
        </p>
      </div>
    </div>
  </Teleport>
</template>
