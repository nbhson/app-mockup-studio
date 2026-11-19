<script setup lang="ts">
// Inspector — right zone. Lets the user edit width / height / color / padding
// and common props of the selected component. Every change goes through the
// document store (command manager) → undoable, versionable.
//
// The Design tokens section edits the document theme globally: Tailwind
// utilities on the page read the CSS custom properties set by the canvas, and
// the renderer derives button/radius colors from the same theme.
import { computed, ref, watch } from "vue";
import type {
  Theme,
  UiDocument,
  UiStyles,
  ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { findNode } from "@ai-mockup-studio/ui-schema";
import { useDocumentStore } from "../../stores/document";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";

const doc = useDocumentStore();

const isResponsive = computed(() => doc.viewportMode !== "desktop");
const modeLabel = computed(() =>
  doc.viewportMode === "tablet" ? "Tablet" : "Mobile",
);
const activeOverride = computed<UiStyles | undefined>(() => {
  const mode = doc.viewportMode;
  if (mode === "desktop") return undefined;
  return doc.selectedNode?.responsive?.[mode];
});

/** Styles shown in the inspector: base styles + the active breakpoint. */
const effectiveStyles = computed<UiStyles>(() => ({
  ...(doc.selectedNode?.styles ?? {}),
  ...(activeOverride.value ?? {}),
}));

const width = ref<number | null>(null);
const height = ref<number | null>(null);
const padding = ref<number | null>(null);
const color = ref<string | null>(null);

// Watch the individual primitives, not the whole (fresh-object) computed:
// an unrelated document change (undo, AI patch, theme edit) used to reset
// in-progress typing in these inputs even when the selected node's values
// had not changed at all.
watch(
  [
    () => effectiveStyles.value.width,
    () => effectiveStyles.value.height,
    () => effectiveStyles.value.padding,
    () =>
      (effectiveStyles.value.color as string) ??
      (effectiveStyles.value.backgroundColor as string) ??
      null,
  ],
  ([w, h, p, c]) => {
    width.value = typeof w === "number" ? w : null;
    height.value = typeof h === "number" ? h : null;
    padding.value = typeof p === "number" ? p : null;
    color.value = c;
  },
  { immediate: true },
);

function hasOverride(key: keyof UiStyles): boolean {
  return activeOverride.value?.[key] !== undefined;
}

function commit(styles: Record<string, unknown>, description: string) {
  if (!doc.document || !doc.selectedId) return;
  const mode: ViewportMode = doc.viewportMode;
  // Desktop edits the base styles. Tablet/mobile edits write a breakpoint
  // override via dot paths, so the desktop layout stays untouched.
  const patches =
    mode === "desktop"
      ? [{ op: "style" as const, targetId: doc.selectedId, styles }]
      : [
          {
            op: "update" as const,
            targetId: doc.selectedId,
            changes: Object.fromEntries(
              Object.entries(styles).map(([key, value]) => [
                `responsive.${mode}.${key}`,
                value,
              ]),
            ),
          },
        ];
  // Reuse the shared patch application to build the next immutable document,
  // then hand it to the store (which records it as a command).
  const next = applyPatchBatch(doc.document, patches);
  doc.mutate(next, mode === "desktop" ? description : `${description} (${mode})`);
}

/** Remove one breakpoint override so the node inherits the desktop value. */
function clearOverride(key: keyof UiStyles) {
  const mode = doc.viewportMode;
  if (!doc.document || !doc.selectedId || mode === "desktop") return;
  if (!hasOverride(key)) return;

  const next = JSON.parse(JSON.stringify(doc.document)) as UiDocument;
  const node = findNode(next.root, doc.selectedId);
  const styles = node?.responsive?.[mode];
  if (!node || !styles) return;
  delete styles[key];
  if (Object.keys(styles).length === 0) delete node.responsive?.[mode];
  if (node.responsive && Object.keys(node.responsive).length === 0) {
    delete node.responsive;
  }
  doc.mutate(next, `Xóa override ${key} (${mode})`);
}

/** Empty input means "auto": REMOVE the style. `Number("")` is 0, and the
 *  old code committed 0 — collapsing the component instead of clearing it. */
function onNumeric(key: "width" | "height" | "padding", e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (raw === "") {
    if (doc.viewportMode === "desktop") {
      if (key === "width" && width.value === null) return;
      if (key === "height" && height.value === null) return;
      if (key === "padding" && padding.value === null) return;
      commit({ [key]: undefined }, `Bỏ ${key}`);
    } else if (hasOverride(key)) {
      clearOverride(key);
    }
    return;
  }
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  commit({ [key]: v }, `Sửa ${key}`);
}

function onWidth(e: Event) {
  onNumeric("width", e);
}

function onHeight(e: Event) {
  onNumeric("height", e);
}

function onPadding(e: Event) {
  onNumeric("padding", e);
}

function onColor(e: Event) {
  commit({ color: (e.target as HTMLInputElement).value }, "Sửa màu chữ");
}

// --- Design tokens (P2.7) ---------------------------------------------------

const theme = computed<Theme | null>(() => doc.document?.theme ?? null);

const colorTokens: { key: keyof Theme; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "border", label: "Border" },
];

function commitTheme(partial: Partial<Theme>, description: string) {
  if (!doc.document) return;
  doc.mutate(
    {
      ...doc.document,
      theme: { ...doc.document.theme, ...partial },
    },
    description,
  );
}

function onThemeColor(key: keyof Theme, e: Event) {
  const value = (e.target as HTMLInputElement).value.trim();
  if (!value) return;
  commitTheme({ [key]: value } as Partial<Theme>, "Đổi design token");
}

function onRadius(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v) || v < 0) return;
  commitTheme({ radius: v }, "Đổi bo góc");
}

function onFontFamily(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim();
  if (!v) return;
  commitTheme({ fontFamily: v }, "Đổi font chữ");
}

function onMode(e: Event) {
  const mode = (e.target as HTMLSelectElement).value === "dark" ? "dark" : "light";
  if (mode === "dark") {
    commitTheme(
      {
        mode,
        background: "#0F172A",
        foreground: "#F8FAFC",
        muted: "#1E293B",
        mutedForeground: "#94A3B8",
        border: "#334155",
      },
      "Đổi theme tối",
    );
  } else {
    commitTheme(
      {
        mode,
        background: "#FFFFFF",
        foreground: "#0F172A",
        muted: "#F1F5F9",
        mutedForeground: "#64748B",
        border: "#E2E8F0",
      },
      "Đổi theme sáng",
    );
  }
}
</script>

<template>
  <aside class="flex h-full w-64 flex-col border-l border-line bg-surface">
    <div class="panel-title shrink-0 border-b border-line px-3 py-2">
      Properties
    </div>

    <div class="panel-scroll min-h-0 flex-1 overflow-auto p-3">
      <p v-if="!doc.selectedNode" class="text-sm text-ink-muted">
        Chọn một component trên canvas để chỉnh thuộc tính.
      </p>

      <div v-else>
        <div class="mb-3">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium text-ink">{{ doc.selectedNode.type }}</span>
            <span
              v-if="doc.selectedNode.locked"
              class="rounded border border-warning-border bg-warning-soft px-1.5 py-0.5 text-[10px] font-medium text-warning-text"
            >
              đã khóa
            </span>
            <span
              v-if="doc.selectedNode.hidden"
              class="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-ink-soft"
            >
              đang ẩn
            </span>
          </div>
          <div class="text-xs text-ink-muted">id: {{ doc.selectedNode.id }}</div>
        </div>

        <div
          v-if="isResponsive"
          class="mb-3 rounded-md border border-warning-border bg-warning-soft px-2 py-1.5 text-[11px] leading-4 text-warning-text"
        >
          Đang chỉnh <strong>{{ modeLabel }}</strong>: thay đổi được lưu thành
          override breakpoint, desktop giữ nguyên.
        </div>

        <div class="space-y-3 text-sm">
          <label class="block">
            <span class="mb-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>Width (px)</span>
              <button
                v-if="isResponsive"
                type="button"
                class="rounded px-1 text-[10px] disabled:cursor-default"
                :class="
                  hasOverride('width')
                    ? 'text-warning-text hover:bg-warning-soft'
                    : 'text-ink-muted'
                "
                :disabled="!hasOverride('width')"
                :title="
                  hasOverride('width')
                    ? 'Xóa override, quay về giá trị desktop'
                    : 'Đang kế thừa giá trị desktop'
                "
                @click.prevent.stop="clearOverride('width')"
              >
                {{ hasOverride("width") ? "override ×" : "kế thừa" }}
              </button>
            </span>
            <input
              :value="width ?? ''"
              type="number"
              class="field-input"
              placeholder="auto"
              @change="onWidth"
            />
          </label>

          <label class="block">
            <span class="mb-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>Height (px)</span>
              <button
                v-if="isResponsive"
                type="button"
                class="rounded px-1 text-[10px] disabled:cursor-default"
                :class="
                  hasOverride('height')
                    ? 'text-warning-text hover:bg-warning-soft'
                    : 'text-ink-muted'
                "
                :disabled="!hasOverride('height')"
                :title="
                  hasOverride('height')
                    ? 'Xóa override, quay về giá trị desktop'
                    : 'Đang kế thừa giá trị desktop'
                "
                @click.prevent.stop="clearOverride('height')"
              >
                {{ hasOverride("height") ? "override ×" : "kế thừa" }}
              </button>
            </span>
            <input
              :value="height ?? ''"
              type="number"
              class="field-input"
              placeholder="auto"
              @change="onHeight"
            />
          </label>

          <label class="block">
            <span class="mb-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>Padding (px)</span>
              <button
                v-if="isResponsive"
                type="button"
                class="rounded px-1 text-[10px] disabled:cursor-default"
                :class="
                  hasOverride('padding')
                    ? 'text-warning-text hover:bg-warning-soft'
                    : 'text-ink-muted'
                "
                :disabled="!hasOverride('padding')"
                :title="
                  hasOverride('padding')
                    ? 'Xóa override, quay về giá trị desktop'
                    : 'Đang kế thừa giá trị desktop'
                "
                @click.prevent.stop="clearOverride('padding')"
              >
                {{ hasOverride("padding") ? "override ×" : "kế thừa" }}
              </button>
            </span>
            <input
              :value="padding ?? ''"
              type="number"
              class="field-input"
              placeholder="auto"
              @change="onPadding"
            />
          </label>

          <div v-if="color">
            <span class="mb-1 flex items-center justify-between gap-2 text-xs text-ink-soft">
              <span>Color</span>
              <button
                v-if="isResponsive"
                type="button"
                class="rounded px-1 text-[10px] disabled:cursor-default"
                :class="
                  hasOverride('color')
                    ? 'text-warning-text hover:bg-warning-soft'
                    : 'text-ink-muted'
                "
                :disabled="!hasOverride('color')"
                :title="
                  hasOverride('color')
                    ? 'Xóa override, quay về giá trị desktop'
                    : 'Đang kế thừa giá trị desktop'
                "
                @click.prevent.stop="clearOverride('color')"
              >
                {{ hasOverride("color") ? "override ×" : "kế thừa" }}
              </button>
            </span>
            <input
              :value="color"
              type="color"
              class="h-8 w-full rounded-md border border-line"
              @change="onColor"
            />
          </div>
        </div>
      </div>

      <div v-if="theme" class="mt-4 border-t border-line pt-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="panel-title">Design tokens</span>
          <span class="text-[10px] text-ink-muted">áp dụng toàn cục</span>
        </div>

        <label class="mb-2 block">
          <span class="mb-1 block text-xs text-ink-soft">Theme</span>
          <select
            :value="theme.mode"
            class="field-input"
            @change="onMode"
          >
            <option value="light">Sáng</option>
            <option value="dark">Tối</option>
          </select>
        </label>

        <div class="mb-2 grid grid-cols-2 gap-2">
          <label
            v-for="token in colorTokens"
            :key="token.key"
            class="block"
            :title="`${token.label}: ${theme[token.key]}`"
          >
            <span class="mb-1 block text-[10px] text-ink-soft">{{ token.label }}</span>
            <span class="flex items-center gap-1">
              <input
                :value="theme[token.key]"
                type="color"
                class="h-6 w-6 shrink-0 cursor-pointer rounded border border-line bg-white p-0"
                @change="onThemeColor(token.key, $event)"
              />
              <input
                :value="theme[token.key]"
                type="text"
                spellcheck="false"
                class="field-input field-input-sm min-w-0 flex-1 font-mono"
                @change="onThemeColor(token.key, $event)"
              />
            </span>
          </label>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="mb-1 block text-xs text-ink-soft">Radius (px)</span>
            <input
              :value="theme.radius"
              type="number"
              min="0"
              class="field-input"
              @change="onRadius"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-soft">Font</span>
            <input
              :value="theme.fontFamily"
              type="text"
              class="field-input field-input-sm text-xs"
              @change="onFontFamily"
            />
          </label>
        </div>
      </div>
    </div>
  </aside>
</template>
