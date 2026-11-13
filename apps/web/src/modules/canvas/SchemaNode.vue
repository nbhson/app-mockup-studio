<script setup lang="ts">
// SchemaNode — recursive renderer over ResolvedElement (from ui-renderer).
// This is the Vue side of "Schema → Component". It only mounts DOM based on
// structured data; it NEVER executes code coming from AI (plan/01 security).
import { computed, ref } from "vue";
import type { ResolvedElement } from "@ai-mockup-studio/ui-renderer";

const props = defineProps<{ element: ResolvedElement; selectable?: boolean }>();
const emit = defineEmits<{
  (e: "select", payload: { id: string; additive: boolean }): void;
  (e: "drop-on", id: string): void;
}>();

const isDragOver = ref(false);
const canDrop = computed(
  () => Boolean(props.selectable) && props.element.isContainer,
);

function hasMockupDrag(e: DragEvent): boolean {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return (
    types.includes("application/x-mockup-component") ||
    types.includes("application/x-mockup-node")
  );
}

function onDragOver(e: DragEvent) {
  if (!canDrop.value || !hasMockupDrag(e)) return;
  e.preventDefault();
  e.stopPropagation();
  const types = Array.from(e.dataTransfer?.types ?? []);
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = types.includes("application/x-mockup-node")
      ? "move"
      : "copy";
  }
  isDragOver.value = true;
}

function onDragLeave(e: DragEvent) {
  const next = e.relatedTarget as Node | null;
  if (next && (e.currentTarget as HTMLElement).contains(next)) return;
  isDragOver.value = false;
}

function onDrop(e: DragEvent) {
  if (!canDrop.value) return;
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
  emit("drop-on", props.element.id);
}

function px(v: unknown): string | undefined {
  if (typeof v === "number") return `${v}px`;
  if (typeof v === "string") return v;
  return undefined;
}

function styleFor(el: ResolvedElement): Record<string, string> {
  const s: Record<string, string> = {};
  const raw = el.styles as Record<string, unknown>;
  if (raw.width !== undefined) s.width = px(raw.width)!;
  if (raw.height !== undefined) s.height = px(raw.height)!;
  if (raw.minWidth !== undefined) s.minWidth = px(raw.minWidth)!;
  if (raw.minHeight !== undefined) s.minHeight = px(raw.minHeight)!;
  if (raw.padding !== undefined) s.padding = px(raw.padding)!;
  if (raw.margin !== undefined) s.margin = px(raw.margin)!;
  if (raw.gap !== undefined) s.gap = px(raw.gap)!;
  if (raw.display) s.display = String(raw.display);
  if (raw.flex !== undefined) s.flex = String(raw.flex);
  if (raw.flexDirection) s.flexDirection = String(raw.flexDirection);
  if (raw.flexWrap) s.flexWrap = String(raw.flexWrap);
  if (raw.flexShrink !== undefined) s.flexShrink = String(raw.flexShrink);
  if (raw.alignItems) s.alignItems = String(raw.alignItems);
  if (raw.justifyContent) s.justifyContent = String(raw.justifyContent);
  if (raw.backgroundColor) s.backgroundColor = String(raw.backgroundColor);
  if (raw.color) s.color = String(raw.color);
  if (raw.fontSize !== undefined) s.fontSize = px(raw.fontSize)!;
  if (raw.fontWeight !== undefined) s.fontWeight = String(raw.fontWeight);
  if (raw.borderRadius !== undefined) s.borderRadius = px(raw.borderRadius)!;
  if (raw.borderColor) s.borderColor = String(raw.borderColor);
  if (raw.borderWidth !== undefined) s.borderWidth = `${raw.borderWidth}px`;
  if (raw.opacity !== undefined) s.opacity = String(raw.opacity);
  return s;
}

const style = computed(() => styleFor(props.element));

const isContainer = computed(() => props.element.isContainer);
const hasUnknown = computed(() => !props.element.known);

function onClick(e: MouseEvent) {
  emit("select", {
    id: props.element.id,
    additive: e.ctrlKey || e.metaKey,
  });
}
</script>

<template>
  <div
    :data-node-id="element.id"
    :data-type="element.type"
    class="relative"
    :class="isDragOver ? 'ring-2 ring-inset ring-blue-400' : ''"
    :style="style"
    @click.stop="onClick"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- button -->
    <button
      v-if="element.type === 'basic.button'"
      class="rounded-md font-medium text-sm"
      :style="style"
      :disabled="Boolean(element.props.disabled)"
    >
      {{ element.props.label }}
    </button>

    <!-- input -->
    <input
      v-else-if="element.type === 'basic.input'"
      class="w-full rounded-md border border-ds-border px-3 text-sm"
      :style="style"
      :placeholder="String(element.props.placeholder ?? '')"
    />

    <!-- image -->
    <img
      v-else-if="element.type === 'basic.image'"
      :src="String(element.props.src ?? '')"
      :alt="String(element.props.alt ?? '')"
      :style="style"
      class="w-full object-cover"
    />

    <!-- dashboard header -->
    <div v-else-if="element.type === 'dashboard.header'" :style="style" class="select-none">
      <div class="font-bold" :style="{ fontSize: px(element.styles.fontSize), color: element.styles.color as string }">
        {{ element.props.title }}
      </div>
      <div v-if="element.props.subtitle" class="text-sm text-slate-500">
        {{ element.props.subtitle }}
      </div>
    </div>

    <!-- stats -->
    <div v-else-if="element.type === 'dashboard.stats'" :style="style" class="grid gap-3">
      <div
        v-for="(item, i) in (element.props.items as string[]).slice(0, 4)"
        :key="i"
        class="rounded-lg border border-ds-border bg-white p-3"
      >
        <div class="text-xs text-slate-500">{{ item }}</div>
        <div class="mt-1 text-xl font-bold text-slate-900">
          {{ (element.props.values as string[] | undefined)?.[i] ?? "—" }}
        </div>
      </div>
    </div>

    <!-- chart (static placeholder for MVP) -->
    <div v-else-if="element.type === 'dashboard.chart'" :style="style" class="flex flex-col rounded-lg border border-ds-border bg-white p-3">
      <span class="text-xs text-slate-500">{{ element.props.title }}</span>
      <div class="mt-2 flex flex-1 items-end gap-1">
        <div v-for="(h, i) in [40, 65, 50, 80, 60, 90, 55]" :key="i" class="w-full rounded-sm bg-blue-500" :style="{ height: `${h}%` }" />
      </div>
    </div>

    <!-- table -->
    <table v-else-if="element.type === 'dashboard.table'" :style="style" class="w-full rounded-lg border border-ds-border text-sm">
      <thead>
        <tr class="bg-slate-50 text-left">
          <th v-for="(h, i) in (element.props.headers as string[])" :key="i" class="px-3 py-2 font-medium text-slate-500">{{ h }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, ri) in (element.props.rows as unknown[][])" :key="ri" class="border-t border-ds-border">
          <td v-for="(c, ci) in row" :key="ci" class="px-3 py-2">{{ c }}</td>
        </tr>
      </tbody>
    </table>

    <!-- text -->
    <div v-else-if="element.type === 'basic.text'" :style="style" class="select-none">
      {{ element.props.text }}
    </div>

    <!-- generic container: re-render children recursively -->
    <template v-else-if="isContainer">
      <SchemaNode
        v-for="child in element.children"
        :key="child.id"
        :element="child"
        :selectable="selectable"
        @select="onSelect => emit('select', onSelect)"
        @drop-on="onDropOn => emit('drop-on', onDropOn)"
      />
    </template>

    <!-- unknown type placeholder (never crashes) -->
    <div v-else-if="hasUnknown" :style="style" class="rounded border border-dashed border-orange-300 bg-orange-50 p-2 text-xs text-orange-600">
      {{ element.type }} <em>(chưa hỗ trợ)</em>
    </div>
  </div>
</template>

<style scoped>
/* selection outline is handled by the parent canvas overlay */
</style>
