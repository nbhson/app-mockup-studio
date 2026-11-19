<script setup lang="ts">
// Workspace — the 4-zone editor layout (plan/06):
//   Left: Layers · Center: Canvas · Right: Properties · Bottom: AI Assistant
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useDocumentStore } from "../../stores/document";
import { useAiStore } from "../../stores/ai";
import { api } from "../../services/api";
import LayersPanel from "../layers/LayersPanel.vue";
import CanvasView from "../canvas/CanvasView.vue";
import InspectorPanel from "../inspector/InspectorPanel.vue";
import AIAssistantPanel from "../ai-assistant/AIAssistantPanel.vue";

const route = useRoute();
const doc = useDocumentStore();
const ai = useAiStore();

async function loadProject(projectId: string) {
  try {
    await doc.load(projectId);
    ai.clearHistory();
  } catch {
    // A failed load is surfaced via `doc.loadError` (banner below); catching
    // here keeps `void loadProject(...)` from becoming an unhandled rejection.
  }
}

/**
 * Best-effort flush when the tab is closed/hidden with unsaved edits, so a
 * killed autosave window never silently discards work. A plain fetch (not
 * sendBeacon) because the API expects the JSON content-type header; fully
 * fire-and-forget and never throws during unload.
 */
function flushOnPageHide() {
  try {
    if (!doc.isDirty || !doc.projectId || !doc.document) return;
    // A save already in flight will finish on its own; a conflicted one must
    // not overwrite the collaborator's newer version from a dying tab.
    if (doc.isSaving || doc.saveConflict) return;
    // Page-scoped whenever a page is open — the project-level endpoint would
    // land on the project-wide active page, which another tab may have moved.
    const path = doc.currentPageId
      ? `/projects/${doc.projectId}/pages/${doc.currentPageId}`
      : `/projects/${doc.projectId}/document`;
    void api
      .post(path, { document: doc.document, baseVersion: doc.baseVersion })
      .catch(() => undefined);
  } catch {
    // Unload hooks must never throw; losing this flush just falls back to
    // the normal autosave window behaviour.
  }
}

onMounted(() => {
  void loadProject(String(route.params.projectId));
  window.addEventListener("pagehide", flushOnPageHide);
});

onBeforeUnmount(() => {
  window.removeEventListener("pagehide", flushOnPageHide);
});

// The same route record is reused when switching projects (e.g. duplicate),
// so onMounted alone would keep showing the previous document.
watch(
  () => route.params.projectId,
  (projectId, previous) => {
    if (typeof projectId === "string" && projectId !== previous) {
      void loadProject(projectId);
    }
  },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <div
      v-if="doc.loadError"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800"
      role="alert"
    >
      <span>⚠️ Không tải được dự án: {{ doc.loadError }}</span>
      <button
        class="shrink-0 rounded border border-red-300 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-100"
        @click="loadProject(String(route.params.projectId))"
      >
        Thử lại
      </button>
    </div>
    <div class="flex min-h-0 flex-1">
      <LayersPanel />
      <div class="min-w-0 flex-1"><CanvasView /></div>
      <InspectorPanel />
    </div>
    <AIAssistantPanel />
  </div>
</template>
