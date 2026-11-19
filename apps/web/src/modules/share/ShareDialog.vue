<script setup lang="ts">
// Share dialog (plan/07 4.7). Creates public/private preview links for the
// whole project, copies them and revokes them. Private links require a
// password that is hashed on the server and never returned to the client.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  CreateShareInput,
  ShareDto,
  ShareListResponse,
  ShareVisibility,
} from "@ai-mockup-studio/shared-types";
import { api } from "../../services/api";
import { copyText } from "../../services/clipboard";
import { useDocumentStore } from "../../stores/document";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const doc = useDocumentStore();

const shares = ref<ShareDto[]>([]);
const loading = ref(false);
const creating = ref(false);
const revokingId = ref<string | null>(null);
const error = ref<string | null>(null);
const copiedId = ref<string | null>(null);

const visibility = ref<ShareVisibility>("public");
const password = ref("");
const expiresInDays = ref<number | null>(null);

const projectId = computed(() => doc.projectId);

const expiryOptions: { value: number | null; label: string }[] = [
  { value: null, label: "Không hết hạn" },
  { value: 1, label: "1 ngày" },
  { value: 7, label: "7 ngày" },
  { value: 30, label: "30 ngày" },
];

const canCreate = computed(
  () => visibility.value === "public" || password.value.trim().length >= 4,
);

async function load() {
  if (!projectId.value) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await api.get<ShareListResponse>(
      `/projects/${projectId.value}/shares`,
    );
    shares.value = res.shares;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tải được danh sách link";
  } finally {
    loading.value = false;
  }
}

function close() {
  error.value = null;
  emit("close");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = null;
      copiedId.value = null;
      visibility.value = "public";
      password.value = "";
      expiresInDays.value = null;
      window.addEventListener("keydown", onKeydown);
      void load();
    } else {
      window.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function shareUrl(share: ShareDto): string {
  return `${window.location.origin}${share.path}`;
}

async function create() {
  if (!projectId.value || creating.value) return;
  if (!canCreate.value) {
    error.value = "Mật khẩu cần ít nhất 4 ký tự.";
    return;
  }

  creating.value = true;
  error.value = null;
  try {
    const body: CreateShareInput = {
      visibility: visibility.value,
      ...(visibility.value === "private" ? { password: password.value } : {}),
      ...(expiresInDays.value ? { expiresInDays: expiresInDays.value } : {}),
    };
    const share = await api.post<ShareDto>(
      `/projects/${projectId.value}/shares`,
      body,
    );
    shares.value = [share, ...shares.value];
    password.value = "";
    await copy(share);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không tạo được link chia sẻ";
  } finally {
    creating.value = false;
  }
}

async function copy(share: ShareDto) {
  error.value = null;
  const ok = await copyText(shareUrl(share));
  if (!ok) {
    error.value = "Trình duyệt không cho phép copy tự động.";
    return;
  }
  copiedId.value = share.id;
  setTimeout(() => {
    if (copiedId.value === share.id) copiedId.value = null;
  }, 1500);
}

async function revoke(share: ShareDto) {
  if (!projectId.value || revokingId.value) return;
  const kind = share.visibility === "private" ? "riêng tư" : "công khai";
  if (
    !window.confirm(
      `Thu hồi link ${kind}? Link sẽ ngừng hoạt động ngay lập tức.`,
    )
  ) {
    return;
  }

  revokingId.value = share.id;
  error.value = null;
  try {
    const res = await api.delete<ShareListResponse>(
      `/projects/${projectId.value}/shares/${share.id}`,
    );
    shares.value = res.shares;
    if (copiedId.value === share.id) copiedId.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Không thu hồi được link";
  } finally {
    revokingId.value = null;
  }
}

function openShare(share: ShareDto) {
  window.open(shareUrl(share), "_blank", "noopener,noreferrer");
}

function formatDate(iso: string | null): string {
  if (!iso) return "Không hết hạn";
  return new Date(iso).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
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
        aria-labelledby="share-title"
        class="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
      >
        <div class="flex items-center justify-between border-b border-ds-border px-4 py-3">
          <div>
            <h2 id="share-title" class="text-sm font-semibold text-slate-800">
              Chia sẻ bản xem trước
            </h2>
            <p class="text-[11px] text-slate-400">
              Link chỉ xem, không cho phép sửa · toàn bộ trang của dự án
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

        <div class="min-h-0 flex-1 overflow-auto px-4 py-4">
          <section class="rounded-lg border border-ds-border bg-slate-50/70 p-3">
            <h3 class="text-xs font-semibold text-slate-700">Tạo link mới</h3>
            <div class="mt-2 flex flex-wrap items-end gap-3">
              <div>
                <span class="mb-1 block text-[11px] font-medium text-slate-500">
                  Quyền truy cập
                </span>
                <div class="flex overflow-hidden rounded-md border border-ds-border bg-white">
                  <button
                    class="px-3 py-1.5 text-xs font-medium transition-colors"
                    :class="
                      visibility === 'public'
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-50'
                    "
                    :aria-pressed="visibility === 'public'"
                    @click="visibility = 'public'"
                  >
                    Công khai
                  </button>
                  <button
                    class="border-l border-ds-border px-3 py-1.5 text-xs font-medium transition-colors"
                    :class="
                      visibility === 'private'
                        ? 'bg-amber-50 text-amber-700'
                        : 'text-slate-500 hover:bg-slate-50'
                    "
                    :aria-pressed="visibility === 'private'"
                    @click="visibility = 'private'"
                  >
                    Riêng tư
                  </button>
                </div>
              </div>

              <label v-if="visibility === 'private'" class="min-w-40 flex-1">
                <span class="mb-1 block text-[11px] font-medium text-slate-500">
                  Mật khẩu (≥ 4 ký tự)
                </span>
                <input
                  v-model="password"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Mật khẩu của link"
                  class="w-full rounded-md border border-ds-border bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-400"
                />
              </label>

              <label>
                <span class="mb-1 block text-[11px] font-medium text-slate-500">
                  Hết hạn sau
                </span>
                <select
                  v-model="expiresInDays"
                  class="rounded-md border border-ds-border bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400"
                >
                  <option v-for="option in expiryOptions" :key="String(option.value)" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <button
                class="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                :disabled="creating || !canCreate"
                @click="create"
              >
                {{ creating ? "Đang tạo…" : "Tạo link" }}
              </button>
            </div>
            <p
              v-if="visibility === 'private'"
              class="mt-2 text-[11px] text-amber-700"
            >
              Người xem phải nhập mật khẩu. Mật khẩu chỉ lưu dạng hash, không thể xem lại.
            </p>
          </section>

          <p v-if="error" class="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
            {{ error }}
          </p>

          <section class="mt-4">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-semibold text-slate-700">
                Link đang hoạt động
              </h3>
              <span v-if="loading" class="text-[11px] text-slate-400">Đang tải…</span>
            </div>

            <p
              v-if="!loading && shares.length === 0"
              class="mt-2 rounded-md border border-dashed border-ds-border px-3 py-6 text-center text-xs text-slate-400"
            >
              Chưa có link chia sẻ nào. Tạo link ở trên để gửi bản xem trước.
            </p>

            <ul v-else class="mt-2 divide-y divide-ds-border rounded-lg border border-ds-border">
              <li
                v-for="share in shares"
                :key="share.id"
                class="flex flex-wrap items-center gap-2 px-3 py-2.5"
              >
                <span
                  class="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  :class="
                    share.visibility === 'private'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  "
                >
                  {{ share.visibility === "private" ? "Riêng tư" : "Công khai" }}
                </span>
                <span v-if="share.hasPassword" class="text-[11px] text-slate-400" title="Cần mật khẩu">
                  🔒
                </span>

                <div class="min-w-0 flex-1">
                  <p class="truncate font-mono text-[11px] text-slate-600" :title="shareUrl(share)">
                    {{ shareUrl(share) }}
                  </p>
                  <p class="text-[10px] text-slate-400">
                    {{ formatDate(share.expiresAt) }} · {{ share.viewCount }} lượt xem
                    <template v-if="share.lastViewedAt">
                      · gần nhất {{ formatDate(share.lastViewedAt) }}
                    </template>
                  </p>
                </div>

                <div class="flex items-center gap-1">
                  <button
                    class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    @click="copy(share)"
                  >
                    {{ copiedId === share.id ? "Đã copy ✓" : "Copy" }}
                  </button>
                  <button
                    class="rounded border border-ds-border px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    @click="openShare(share)"
                  >
                    Mở
                  </button>
                  <button
                    class="rounded px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                    :disabled="revokingId === share.id"
                    @click="revoke(share)"
                  >
                    {{ revokingId === share.id ? "…" : "Thu hồi" }}
                  </button>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <div class="flex items-center justify-between border-t border-ds-border px-4 py-2">
          <p class="text-[11px] text-slate-400">
            Link công khai không cần đăng nhập; link riêng tư yêu cầu mật khẩu.
          </p>
          <button
            class="rounded border border-ds-border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            @click="close"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
