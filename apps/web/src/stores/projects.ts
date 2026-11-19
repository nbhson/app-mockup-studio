import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  ProjectDto,
  UpdateProjectInput,
} from "@ai-mockup-studio/shared-types";
import { api } from "../services/api";

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref<ProjectDto[]>([]);
  const isLoading = ref(false);
  /** Last failed operation's message — surfaced as a banner in ProjectsView. */
  const error = ref<string | null>(null);

  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    error.value = null;
    try {
      return await fn();
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Có lỗi xảy ra";
      throw e;
    }
  }

  async function list() {
    isLoading.value = true;
    try {
      await guarded(async () => {
        projects.value = await api.get<ProjectDto[]>("/projects");
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function create(name: string, description?: string) {
    return guarded(async () => {
      const project = await api.post<ProjectDto>("/projects", {
        name,
        description: description ?? "",
      });
      projects.value.unshift(project);
      return project;
    });
  }

  async function update(id: string, input: UpdateProjectInput) {
    return guarded(async () => {
      const project = await api.post<ProjectDto>(`/projects/${id}`, input);
      projects.value = projects.value.map((p) => (p.id === id ? project : p));
      return project;
    });
  }

  async function duplicate(id: string) {
    return guarded(async () => {
      const project = await api.post<ProjectDto>(`/projects/${id}/duplicate`);
      projects.value.unshift(project);
      return project;
    });
  }

  async function remove(id: string) {
    return guarded(async () => {
      await api.delete(`/projects/${id}`);
      projects.value = projects.value.filter((p) => p.id !== id);
    });
  }

  return { projects, isLoading, error, list, create, update, duplicate, remove };
});
