<script setup lang="ts">
// Workspace — the 4-zone editor layout (plan/06):
//   Left: Layers · Center: Canvas · Right: Properties · Bottom: AI Assistant
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import { useDocumentStore } from "../../stores/document";
import { useAiStore } from "../../stores/ai";
import LayersPanel from "../layers/LayersPanel.vue";
import CanvasView from "../canvas/CanvasView.vue";
import InspectorPanel from "../inspector/InspectorPanel.vue";
import AIAssistantPanel from "../ai-assistant/AIAssistantPanel.vue";

const route = useRoute();
const doc = useDocumentStore();
const ai = useAiStore();

onMounted(async () => {
  const projectId = String(route.params.projectId);
  await doc.load(projectId);
  ai.clearHistory();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex min-h-0 flex-1">
      <LayersPanel />
      <div class="min-w-0 flex-1"><CanvasView /></div>
      <InspectorPanel />
    </div>
    <AIAssistantPanel />
  </div>
</template>
