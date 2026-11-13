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

  async function list() {
    isLoading.value = true;
    try {
      projects.value = await api.get<ProjectDto[]>("/projects");
    } finally {
      isLoading.value = false;
    }
  }

  async function create(name: string, description?: string) {
    const project = await api.post<ProjectDto>("/projects", {
      name,
      description: description ?? "",
    });
    projects.value.unshift(project);
    return project;
  }

  async function update(id: string, input: UpdateProjectInput) {
    const project = await api.post<ProjectDto>(`/projects/${id}`, input);
    projects.value = projects.value.map((p) => (p.id === id ? project : p));
    return project;
  }

  async function duplicate(id: string) {
    const project = await api.post<ProjectDto>(`/projects/${id}/duplicate`);
    projects.value.unshift(project);
    return project;
  }

  async function remove(id: string) {
    await api.delete(`/projects/${id}`);
    projects.value = projects.value.filter((p) => p.id !== id);
  }

  return { projects, isLoading, list, create, update, duplicate, remove };
});
