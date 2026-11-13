import { defineStore } from "pinia";
import { ref, computed, watch, onScopeDispose } from "vue";
import type {
  UiDocument,
  UiPatch,
  UiNode,
  ViewportMode,
} from "@ai-mockup-studio/ui-schema";
import { findNode } from "@ai-mockup-studio/ui-schema";
import { applyPatchBatch } from "@ai-mockup-studio/ui-renderer";
import type {
  DocumentResponse,
  VersionListResponse,
  VersionSummaryDto,
} from "@ai-mockup-studio/shared-types";
import { api } from "../services/api";

// ---------------------------------------------------------------------------
// Document Store — the single source of truth for the editable mockup.
// (plan/09 8.2: Document State vs Editor State vs AI State are kept separate.)
//
// Every mutation goes through a "command" = a patch batch + a snapshot, which
// gives us undo/redo for free via the past/future stacks.
// ---------------------------------------------------------------------------

export interface CommandEntry {
  description: string;
  after: UiDocument;
  before: UiDocument;
}

export const useDocumentStore = defineStore("document", () => {
  const projectId = ref<string | null>(null);
  const document = ref<UiDocument | null>(null);
  const isLoading = ref(false);
  const isDirty = ref(false);
  const isSaving = ref(false);
  const saveError = ref<string | null>(null);
  const lastSavedAt = ref<Date | null>(null);

  // Version history (GĐ 5.2): metadata list + restore state.
  const versions = ref<VersionSummaryDto[]>([]);
  const versionsLoading = ref(false);
  const versionsError = ref<string | null>(null);
  const isRestoring = ref(false);

  const past = ref<CommandEntry[]>([]);
  const future = ref<CommandEntry[]>([]);

  // Revision guard: if the user keeps editing while a save is in flight, the
  // response is stale — keep the document dirty and schedule another save.
  let editRevision = 0;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelAutosave() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  }

  function scheduleAutosave(delay = 1200) {
    cancelAutosave();
    if (!isDirty.value || !projectId.value) return;
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      void save();
    }, delay);
  }

  function markDirty() {
    editRevision += 1;
    isDirty.value = true;
  }

  const canUndo = computed(() => past.value.length > 0);
  const canRedo = computed(() => future.value.length > 0);

  /** Editor state (separate from document): selection, zoom, viewport. */
  const selectedId = ref<string | null>(null);
  const viewportMode = ref<ViewportMode>("desktop");

  const selectedNode = computed<UiNode | null>(() => {
    if (!document.value || !selectedId.value) return null;
    return findNode(document.value.root, selectedId.value) ?? null;
  });

  function setProject(id: string) {
    projectId.value = id;
  }

  async function load(project: string) {
    cancelAutosave();
    isLoading.value = true;
    try {
      projectId.value = project;
      const res = await api.get<{
        document: UiDocument | null;
        updatedAt: string;
      }>(`/projects/${project}/document`);
      document.value = res.document;
      selectedId.value = null;
      past.value = [];
      future.value = [];
      lastSavedAt.value = res.document ? new Date(res.updatedAt) : null;
      isDirty.value = false;
      saveError.value = null;
      versions.value = [];
      versionsError.value = null;
      editRevision = 0;
    } finally {
      isLoading.value = false;
    }
  }

  /** Reset to an entirely new/imported document (e.g. AI generation). */
  function setDocument(doc: UiDocument) {
    if (document.value) {
      past.value.push({
        description: "Tạo mới (AI)",
        before: document.value,
        after: doc,
      });
      future.value = [];
    }
    document.value = doc;
    selectedId.value = null;
    markDirty();
  }

  /** Apply a validated patch batch through the command manager. */
  function applyPatches(patches: UiPatch[], description = "Chỉnh sửa") {
    if (!document.value) return;
    const before = document.value;
    const after = applyPatchBatch(before, patches);
    past.value.push({ description, before, after });
    future.value = [];
    document.value = after;
    markDirty();
  }

  /** Direct mutation used by the inspector — wrapped as a command too. */
  function mutate(next: UiDocument, description: string) {
    if (!document.value) return;
    past.value.push({ description, before: document.value, after: next });
    future.value = [];
    document.value = next;
    markDirty();
  }

  function undo() {
    const entry = past.value.pop();
    if (!entry) return;
    future.value.push(entry);
    document.value = entry.before;
    markDirty();
  }

  function redo() {
    const entry = future.value.pop();
    if (!entry) return;
    past.value.push(entry);
    document.value = entry.after;
    markDirty();
  }

  async function save() {
    if (!projectId.value || !document.value) return;
    if (isSaving.value) {
      // A save is already in flight — retry shortly after it completes.
      scheduleAutosave(400);
      return;
    }
    isSaving.value = true;
    saveError.value = null;
    const rev = editRevision;
    try {
      await api.post(`/projects/${projectId.value}/document`, {
        document: document.value,
      });
      lastSavedAt.value = new Date();
      if (editRevision === rev) {
        isDirty.value = false;
      } else {
        // New edits landed while saving; keep dirty and save again.
        scheduleAutosave(200);
      }
    } catch (e) {
      saveError.value = e instanceof Error ? e.message : "Save failed";
    } finally {
      isSaving.value = false;
    }
  }

  // --- Version history -----------------------------------------------------

  async function loadVersions() {
    if (!projectId.value) return;
    versionsLoading.value = true;
    versionsError.value = null;
    try {
      const res = await api.get<VersionListResponse>(
        `/projects/${projectId.value}/versions`,
      );
      versions.value = res.versions;
    } catch (e) {
      versionsError.value =
        e instanceof Error ? e.message : "Không tải được lịch sử";
    } finally {
      versionsLoading.value = false;
    }
  }

  /** Restore a server-side snapshot. The pre-restore state is snapshotted too. */
  async function restoreVersion(versionId: string) {
    if (!projectId.value || isRestoring.value) return;
    isRestoring.value = true;
    versionsError.value = null;
    cancelAutosave();
    try {
      // Persist unsaved local edits first so the restore does not lose them.
      if (isDirty.value) {
        await save();
        if (isDirty.value) {
          throw new Error(saveError.value ?? "Không lưu được trạng thái hiện tại");
        }
      }
      const res = await api.post<DocumentResponse>(
        `/projects/${projectId.value}/versions/${versionId}/restore`,
      );
      document.value = res.document;
      selectedId.value = null;
      past.value = [];
      future.value = [];
      isDirty.value = false;
      lastSavedAt.value = new Date(res.updatedAt);
      editRevision += 1;
      await loadVersions();
    } catch (e) {
      versionsError.value =
        e instanceof Error ? e.message : "Không khôi phục được bản này";
      throw e;
    } finally {
      isRestoring.value = false;
    }
  }

  // Autosave 1.2s after the last mutation (requests are debounced).
  watch(document, () => {
    if (isDirty.value) scheduleAutosave();
  });
  onScopeDispose(cancelAutosave);

  return {
    projectId,
    document,
    isLoading,
    isDirty,
    isSaving,
    saveError,
    lastSavedAt,
    versions,
    versionsLoading,
    versionsError,
    isRestoring,
    canUndo,
    canRedo,
    selectedId,
    viewportMode,
    selectedNode,
    setProject,
    load,
    setDocument,
    applyPatches,
    mutate,
    undo,
    redo,
    save,
    loadVersions,
    restoreVersion,
  };
});
