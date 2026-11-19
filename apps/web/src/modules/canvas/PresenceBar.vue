<script setup lang="ts">
// Live collaborator avatars (plan/07 4.4). Connects to the API presence
// WebSocket for the open project and reconnects with backoff.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { PresenceUserDto } from "@ai-mockup-studio/shared-types";
import { useDocumentStore } from "../../stores/document";
import {
  avatarClass,
  currentUserEmail,
  initials,
  parsePresenceMessage,
  presenceLabel,
  presenceUrl,
} from "../../services/presence";

const props = defineProps<{ projectId: string | null }>();

const users = ref<PresenceUserDto[]>([]);
const connected = ref(false);
const doc = useDocumentStore();
/** A collaborator changed the open page while we have unsaved edits. */
const pendingRemote = ref(false);

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let disposed = false;

function disconnect() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const current = socket;
  socket = null;
  if (current) {
    current.onopen = null;
    current.onmessage = null;
    current.onclose = null;
    current.onerror = null;
    current.close();
  }
}

function connect() {
  disconnect();
  if (disposed || !props.projectId) {
    connected.value = false;
    users.value = [];
    return;
  }
  const ws = new WebSocket(presenceUrl(props.projectId, currentUserEmail()));
  socket = ws;
  ws.onopen = () => {
    connected.value = true;
    retryDelay = 1000;
  };
  ws.onmessage = (event) => {
    const message = parsePresenceMessage(String(event.data));
    if (message?.type === "presence") {
      users.value = message.users;
      return;
    }
    // The server broadcasts every save so open editors can rebase instead of
    // hitting a 409 on their next autosave. This used to be received and
    // silently dropped.
    if (message?.type === "document:updated") {
      if (message.pageId !== doc.currentPageId) return;
      if (
        doc.lastSavedAt &&
        new Date(message.updatedAt) <= doc.lastSavedAt
      ) {
        return; // our own save echo
      }
      if (doc.isSaving) return; // the response will settle baseVersion shortly
      if (!doc.isDirty) {
        void doc.reloadLatest();
      } else {
        pendingRemote.value = true;
      }
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    connected.value = false;
    users.value = [];
    if (!disposed && props.projectId) {
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15_000);
    }
  };
}

watch(
  () => props.projectId,
  () => {
    retryDelay = 1000;
    pendingRemote.value = false;
    connect();
  },
  { immediate: true },
);

watch(
  () => doc.currentPageId,
  () => {
    pendingRemote.value = false;
  },
);

onBeforeUnmount(() => {
  disposed = true;
  disconnect();
});

const visibleUsers = computed(() => users.value.slice(0, 4));
const overflow = computed(() => Math.max(0, users.value.length - 4));
const tooltip = computed(() =>
  users.value.length
    ? users.value
        .map((user) => `${user.name || user.email} (${user.role})`)
        .join("\n")
    : "Chưa có ai khác đang mở dự án",
);
</script>

<template>
  <div
    v-if="projectId"
    class="flex items-center gap-1.5"
    :title="tooltip"
    aria-live="polite"
  >
    <div class="flex -space-x-1.5">
      <span
        v-for="user in visibleUsers"
        :key="user.id"
        class="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-white"
        :class="avatarClass(user.email)"
        :title="`${user.name || user.email} (${user.role})`"
      >
        {{ initials(user.name || user.email) }}
      </span>
      <span
        v-if="overflow"
        class="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 text-[9px] font-semibold text-white ring-2 ring-white"
      >
        +{{ overflow }}
      </span>
    </div>
    <span
      class="text-[10px]"
      :class="connected ? 'text-emerald-600' : 'text-slate-400'"
    >
      {{ presenceLabel(connected, users) }}
    </span>
    <button
      v-if="pendingRemote"
      class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200"
      title="Người khác vừa lưu trang này. Bấm để tải bản mới (mọi sửa đổi chưa lưu của bạn sẽ bị bỏ)."
      @click="pendingRemote = false; void doc.reloadLatest()"
    >
      ⚠ Có bản cập nhật mới — tải lại
    </button>
  </div>
</template>
