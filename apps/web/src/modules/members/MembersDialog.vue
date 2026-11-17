<script setup lang="ts">
// Project members dialog (plan/07 4.5). Owners and admins manage who can view,
// edit or administer a project; viewers see the roster read-only.
import { onBeforeUnmount, ref, watch } from "vue";
import type {
  ProjectMemberDto,
  ProjectRole,
} from "@ai-mockup-studio/shared-types";
import {
  addProjectMember,
  listProjectMembers,
  removeProjectMember,
  roleBadgeClass,
  roleLabel,
  updateProjectMemberRole,
} from "../../services/members";

const props = defineProps<{ open: boolean; projectId: string | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const members = ref<ProjectMemberDto[]>([]);
const canManage = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

const addEmail = ref("");
const addRole = ref<Exclude<ProjectRole, "owner">>("viewer");

function close() {
  error.value = null;
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

async function load() {
  if (!props.projectId) return;
  loading.value = true;
  error.value = null;
  try {
    const response = await listProjectMembers(props.projectId);
    members.value = response.members;
    canManage.value = response.canManage;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tải được thành viên";
  } finally {
    loading.value = false;
  }
}

async function submitAdd() {
  if (!props.projectId) return;
  const email = addEmail.value.trim();
  if (!email) return;
  busy.value = "add";
  error.value = null;
  try {
    const member = await addProjectMember(props.projectId, {
      email,
      role: addRole.value,
    });
    members.value = [...members.value, member];
    addEmail.value = "";
    addRole.value = "viewer";
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không thêm được thành viên";
  } finally {
    busy.value = null;
  }
}

async function changeRole(member: ProjectMemberDto, role: string) {
  if (!props.projectId || member.role === "owner") return;
  busy.value = member.id;
  error.value = null;
  try {
    const updated = await updateProjectMemberRole(props.projectId, member.id, {
      role: role as Exclude<ProjectRole, "owner">,
    });
    members.value = members.value.map((m) =>
      m.id === updated.id ? updated : m,
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không đổi được vai trò";
  } finally {
    busy.value = null;
  }
}

async function remove(member: ProjectMemberDto) {
  if (!props.projectId || member.role === "owner") return;
  if (!window.confirm(`Xóa ${member.user.email} khỏi dự án?`)) return;
  busy.value = member.id;
  error.value = null;
  try {
    await removeProjectMember(props.projectId, member.id);
    members.value = members.value.filter((m) => m.id !== member.id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không xóa được thành viên";
  } finally {
    busy.value = null;
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
        aria-labelledby="members-title"
        class="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <header class="flex items-start justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="members-title" class="text-sm font-semibold text-slate-800">
              👥 Thành viên dự án
            </h2>
            <p class="mt-1 text-[11px] leading-snug text-slate-400">
              Owner quản lý tất cả. Admin thêm/xóa thành viên. Editor sửa nội
              dung. Viewer chỉ xem.
            </p>
          </div>
          <button
            class="rounded px-1.5 py-0.5 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Đóng"
            @click="close"
          >
            ✕
          </button>
        </header>

        <div v-if="error" class="border-b border-red-100 bg-red-50 px-4 py-2 text-[11px] text-red-600">
          {{ error }}
        </div>

        <div class="min-h-0 flex-1 overflow-auto p-4">
          <p v-if="loading" class="py-8 text-center text-xs text-slate-400">Đang tải…</p>
          <p
            v-else-if="members.length === 0"
            class="py-8 text-center text-xs text-slate-400"
          >
            Chưa có thành viên nào.
          </p>
          <ul v-else class="space-y-2">
            <li
              v-for="member in members"
              :key="member.id"
              class="flex items-center justify-between gap-3 rounded border border-ds-border bg-white px-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-xs font-medium text-slate-700">
                  {{ member.user.name || member.user.email }}
                </p>
                <p class="truncate text-[10px] text-slate-400">
                  {{ member.user.email }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span
                  v-if="!canManage || member.role === 'owner'"
                  class="rounded px-2 py-0.5 text-[10px] font-semibold"
                  :class="roleBadgeClass(member.role)"
                >
                  {{ roleLabel(member.role) }}
                </span>
                <select
                  v-else
                  class="rounded border border-ds-border bg-white px-1.5 py-1 text-[11px] text-slate-600 disabled:opacity-40"
                  :value="member.role"
                  :disabled="busy === member.id"
                  :aria-label="`Vai trò của ${member.user.email}`"
                  @change="changeRole(member, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  v-if="canManage && member.role !== 'owner'"
                  class="rounded px-1.5 py-1 text-[10px] text-red-500 hover:bg-red-50 disabled:opacity-40"
                  :disabled="busy === member.id"
                  :aria-label="`Xóa ${member.user.email}`"
                  @click="remove(member)"
                >
                  ✕
                </button>
              </div>
            </li>
          </ul>
        </div>

        <footer
          v-if="canManage"
          class="border-t border-ds-border bg-slate-50 px-4 py-3"
        >
          <p class="mb-2 text-[11px] font-medium text-slate-600">Thêm thành viên</p>
          <form class="flex gap-2" @submit.prevent="submitAdd">
            <input
              v-model="addEmail"
              type="email"
              required
              placeholder="email@example.com"
              class="min-w-0 flex-1 rounded border border-ds-border px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-400"
            />
            <select
              v-model="addRole"
              class="rounded border border-ds-border bg-white px-2 py-1.5 text-xs text-slate-600"
              aria-label="Vai trò"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit"
              class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="busy === 'add' || !addEmail.trim()"
            >
              {{ busy === "add" ? "…" : "Thêm" }}
            </button>
          </form>
          <p class="mt-2 text-[10px] leading-snug text-slate-400">
            Người dùng phải tồn tại trong hệ thống (email đã đăng ký).
          </p>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
