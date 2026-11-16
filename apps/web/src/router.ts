import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/projects" },
    {
      path: "/projects",
      name: "projects",
      component: () => import("./modules/projects/ProjectsView.vue"),
    },
    {
      path: "/workspace/:projectId",
      name: "workspace",
      component: () => import("./modules/workspace/WorkspaceView.vue"),
    },
    {
      path: "/share/:token",
      name: "share",
      component: () => import("./modules/share/PublicShareView.vue"),
      meta: { public: true },
    },
  ],
});
