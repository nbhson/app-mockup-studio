import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  AssetDto,
  AssetListResponse,
} from "@ai-mockup-studio/shared-types";
import { api } from "../services/api";

// plan/12 GĐ 5.4 — project assets. Byte-size/MIME rules mirror the API so the
// user gets an immediate message instead of a failed upload round-trip.
export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Không đọc được tệp"));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function assetSizeLabel(bytes: number): string {
  return formatSize(bytes);
}

export const useAssetsStore = defineStore("assets", () => {
  const assets = ref<AssetDto[]>([]);
  const isLoading = ref(false);
  const isUploading = ref(false);
  const error = ref<string | null>(null);

  async function list(projectId: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await api.get<AssetListResponse>(
        `/projects/${projectId}/assets`,
      );
      assets.value = res.assets;
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : "Không tải được danh sách ảnh";
    } finally {
      isLoading.value = false;
    }
  }

  async function upload(projectId: string, file: File): Promise<AssetDto | null> {
    error.value = null;
    if (!ACCEPTED_ASSET_TYPES.includes(file.type as never)) {
      error.value = "Chỉ hỗ trợ PNG, JPEG, WebP hoặc GIF (không hỗ trợ SVG).";
      return null;
    }
    if (file.size > MAX_ASSET_BYTES) {
      error.value = `Ảnh vượt quá ${formatSize(MAX_ASSET_BYTES)}.`;
      return null;
    }

    isUploading.value = true;
    try {
      const dataUrl = await readAsDataUrl(file);
      const asset = await api.post<AssetDto>(
        `/projects/${projectId}/assets`,
        {
          fileName: file.name,
          mimeType: file.type,
          dataBase64: dataUrl.replace(/^data:[^;]+;base64,/, ""),
        },
      );
      assets.value = [asset, ...assets.value];
      return asset;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Tải ảnh lên thất bại";
      return null;
    } finally {
      isUploading.value = false;
    }
  }

  async function remove(projectId: string, assetId: string) {
    error.value = null;
    try {
      await api.delete(`/projects/${projectId}/assets/${assetId}`);
      assets.value = assets.value.filter((asset) => asset.id !== assetId);
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Không xóa được ảnh";
    }
  }

  function reset() {
    assets.value = [];
    error.value = null;
    isLoading.value = false;
    isUploading.value = false;
  }

  return {
    assets,
    isLoading,
    isUploading,
    error,
    list,
    upload,
    remove,
    reset,
  };
});
