<script setup lang="ts">
// Miniature schematic previews for the component palette (P2.8). These are
// intentionally abstract skeletons rather than live renders: a real render
// would mount form controls inside a draggable button and trigger network
// requests (placehold.co images) for every palette item.
defineProps<{ type: string }>();
</script>

<template>
  <div
    class="mb-1 flex h-8 items-center justify-center overflow-hidden rounded border border-slate-100 bg-slate-50 px-1.5"
    aria-hidden="true"
  >
    <!-- layout.sidebar -->
    <div v-if="type === 'layout.sidebar'" class="flex h-5 w-full gap-0.5">
      <div class="w-1.5 rounded-sm bg-slate-300" />
      <div class="flex flex-1 flex-col justify-center gap-0.5">
        <div class="h-0.5 w-3/4 rounded bg-slate-200" />
        <div class="h-0.5 w-1/2 rounded bg-slate-200" />
      </div>
    </div>

    <!-- layout.navbar -->
    <div v-else-if="type === 'layout.navbar'" class="flex h-5 w-full flex-col justify-between">
      <div class="flex h-1.5 items-center gap-0.5 rounded-sm bg-slate-200 px-0.5">
        <div class="h-0.5 w-2 rounded bg-slate-400" />
        <div class="ml-auto flex gap-0.5">
          <div class="h-0.5 w-1.5 rounded bg-slate-300" />
          <div class="h-0.5 w-1.5 rounded bg-slate-300" />
        </div>
      </div>
      <div class="h-0.5 w-2/3 rounded bg-slate-100" />
    </div>

    <!-- layout.container / layout.section -->
    <div
      v-else-if="type === 'layout.container' || type === 'layout.section'"
      class="grid h-5 w-full grid-cols-2 gap-0.5 rounded-sm border border-dashed border-slate-300 p-0.5"
    >
      <div class="rounded-sm bg-slate-200" />
      <div class="rounded-sm bg-slate-100" />
    </div>

    <!-- layout.grid -->
    <div v-else-if="type === 'layout.grid'" class="grid h-5 w-full grid-cols-4 gap-0.5">
      <div class="rounded-sm bg-slate-200" />
      <div class="rounded-sm bg-slate-200" />
      <div class="rounded-sm bg-slate-200" />
      <div class="rounded-sm bg-slate-200" />
    </div>

    <!-- dashboard.header -->
    <div v-else-if="type === 'dashboard.header'" class="flex w-full flex-col gap-1">
      <div class="h-1.5 w-1/2 rounded bg-slate-400" />
      <div class="h-0.5 w-3/4 rounded bg-slate-200" />
    </div>

    <!-- dashboard.stats -->
    <div v-else-if="type === 'dashboard.stats'" class="grid w-full grid-cols-3 gap-0.5">
      <div class="h-4 rounded-sm border border-slate-200 bg-white" />
      <div class="h-4 rounded-sm border border-slate-200 bg-white" />
      <div class="h-4 rounded-sm border border-slate-200 bg-white" />
    </div>

    <!-- dashboard.chart -->
    <div v-else-if="type === 'dashboard.chart'" class="flex h-5 w-full items-end gap-0.5 rounded-sm border border-slate-200 bg-white p-0.5">
      <div class="h-2 w-full rounded-sm bg-blue-300" />
      <div class="h-3 w-full rounded-sm bg-blue-300" />
      <div class="h-1.5 w-full rounded-sm bg-blue-200" />
      <div class="h-4 w-full rounded-sm bg-blue-400" />
      <div class="h-2.5 w-full rounded-sm bg-blue-300" />
    </div>

    <!-- dashboard.table -->
    <div v-else-if="type === 'dashboard.table'" class="flex w-full flex-col gap-px overflow-hidden rounded-sm border border-slate-200 bg-white">
      <div class="h-1.5 bg-slate-100" />
      <div class="h-1 bg-slate-50" />
      <div class="h-1 bg-slate-50" />
      <div class="h-1 bg-slate-50" />
    </div>

    <!-- basic.button -->
    <div v-else-if="type === 'basic.button'" class="h-4 w-10 rounded bg-blue-500" />

    <!-- basic.input -->
    <div
      v-else-if="type === 'basic.input'"
      class="h-4 w-full rounded-sm border border-slate-300 bg-white px-1 py-1"
    >
      <div class="h-0.5 w-1/2 rounded bg-slate-200" />
    </div>

    <!-- basic.text -->
    <div v-else-if="type === 'basic.text'" class="flex w-full flex-col gap-0.5">
      <div class="h-0.5 w-full rounded bg-slate-300" />
      <div class="h-0.5 w-2/3 rounded bg-slate-200" />
    </div>

    <!-- basic.image -->
    <div v-else-if="type === 'basic.image'" class="flex h-5 w-full items-center justify-center rounded-sm bg-slate-200">
      <div class="h-2 w-3 rounded-t-full border border-slate-400 border-b-0" />
    </div>

    <!-- formal.card -->
    <div v-else-if="type === 'formal.card'" class="flex h-5 w-full flex-col gap-0.5 rounded-sm border border-slate-200 bg-white p-0.5">
      <div class="h-1 w-1/2 rounded bg-slate-300" />
      <div class="h-0.5 w-full rounded bg-slate-100" />
      <div class="h-0.5 w-3/4 rounded bg-slate-100" />
    </div>

    <!-- formal.form -->
    <div v-else-if="type === 'formal.form'" class="flex w-full flex-col gap-0.5 rounded-sm border border-slate-200 bg-white p-0.5">
      <div class="h-1 rounded-sm border border-slate-300" />
      <div class="h-1 rounded-sm border border-slate-300" />
      <div class="h-1 w-1/3 rounded-sm bg-blue-400" />
    </div>

    <!-- fallback -->
    <div v-else class="h-3 w-6 rounded-sm bg-slate-200" />
  </div>
</template>
