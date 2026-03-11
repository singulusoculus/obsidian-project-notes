<script lang="ts">
  import { fromStore } from "svelte/store";
  import type {
    ProjectTimingFilterOption,
    ProjectMetadataKey,
    ProjectGridColumn,
    ProjectNote,
    ProjectSortField,
    TaskDateField,
    ProjectTask,
    TaskPriorityFilterOption,
    TaskSortField,
    TaskStatusFilterOption,
    TaskTimingFilterOption,
    TaskState,
    ViewVariant,
  } from "../lib/types";
  import {
    BINARY_TASK_STATUS_OPTIONS,
    FILTER_NONE_TOKEN,
    PROJECT_NO_PRIORITY_TOKEN,
    PROJECT_TIMING_OPTIONS,
    TASK_GRID_COLUMNS,
    TASK_PRIORITY_METADATA,
    TASK_PRIORITY_ORDER,
    TASK_TIMING_OPTIONS,
    TRI_STATE_TASK_STATUS_OPTIONS,
  } from "../lib/constants";
  import type { ProjectViewStore } from "../lib/stores/projectViewStore";
  import ColumnPicker from "./shared/ColumnPicker.svelte";
  import GridTable from "./shared/GridTable.svelte";
  import SearchInput from "./shared/SearchInput.svelte";
  import SavedViewPicker from "./shared/SavedViewPicker.svelte";

  type ProjectPriorityFilterOption = string | typeof PROJECT_NO_PRIORITY_TOKEN;
  const TASK_PRIORITY_OPTIONS: TaskPriorityFilterOption[] = [...TASK_PRIORITY_ORDER, "none"];

  const TASK_DATE_TOKEN_REGEX = /(?:⏳|🛫|📅|✅)\s*\d{4}-\d{2}-\d{2}/gu;
  const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/gu;
  const MARKDOWN_EXTERNAL_LINK_REGEX = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)]+)\)/giu;
  const EXTERNAL_URL_REGEX = /\b(?:https?:\/\/|mailto:)[^\s<>()]+/giu;

  interface CellSegment {
    text: string;
    linkReference: string | null;
    target: string | null;
    externalUrl: string | null;
  }

  let { viewStore, variant } = $props<{ viewStore: ProjectViewStore; variant: ViewVariant }>();

  const state = $derived.by(() => fromStore(viewStore.state).current);

  let showStatusPicker = $state(false);
  let showPriorityPicker = $state(false);
  let showProjectTimingPicker = $state(false);
  let showTaskPriorityPicker = $state(false);
  let showProjectTaskStatusPicker = $state(false);
  let showTaskStatusPicker = $state(false);
  let showTaskTimingPicker = $state(false);
  let statusPickerWrap = $state<HTMLDivElement | null>(null);
  let priorityPickerWrap = $state<HTMLDivElement | null>(null);
  let projectTimingPickerWrap = $state<HTMLDivElement | null>(null);
  let taskPriorityPickerWrap = $state<HTMLDivElement | null>(null);
  let projectTaskStatusPickerWrap = $state<HTMLDivElement | null>(null);
  let taskStatusPickerWrap = $state<HTMLDivElement | null>(null);
  let taskTimingPickerWrap = $state<HTMLDivElement | null>(null);

  const statusOptions = $derived.by(() => {
    const values = new Set(state.statuses);
    if (state.projects.some((project) => project.statusIsUnknown)) {
      values.add("Unknown");
    }
    return Array.from(values);
  });
  const projectPriorityOptions = $derived.by(() => [...state.priorities, PROJECT_NO_PRIORITY_TOKEN] satisfies ProjectPriorityFilterOption[]);

  const taskStatusOptions = $derived.by(() =>
    state.triStateCheckboxes ? TRI_STATE_TASK_STATUS_OPTIONS : BINARY_TASK_STATUS_OPTIONS
  );
  const selectedProjectTaskStatusSet = $derived.by(
    () => new Set(state.projectTaskStatusFilter.filter((status) => taskStatusOptions.includes(status)))
  );
  const selectedProjectTimingSet = $derived.by(
    () => new Set(state.projectTimingFilter.filter((status) => PROJECT_TIMING_OPTIONS.includes(status)))
  );
  const selectedTaskStatusSet = $derived.by(
    () => new Set(state.taskStatusFilter.filter((status) => taskStatusOptions.includes(status)))
  );
  const selectedTaskPrioritySet = $derived.by(
    () => new Set(state.taskPriorityFilter.filter((priority) => TASK_PRIORITY_OPTIONS.includes(priority)))
  );
  const selectedTaskTimingSet = $derived.by(
    () => new Set(state.taskTimingFilter.filter((status) => TASK_TIMING_OPTIONS.includes(status)))
  );

  const filteredProjects = $derived.by(() => {
    if (allProjectTimingSelected()) {
      return state.projects;
    }

    const selected = selectedProjectTimings();
    if (selected.size === 0) {
      return [];
    }

    return state.projects.filter((project) => {
      const timing = projectTimingStatuses(project);
      return timing.some((status) => selected.has(status));
    });
  });

  const sortedTasksByProject = $derived.by(() => {
    const result = new Map<string, ProjectTask[]>();
    for (const project of filteredProjects) {
      const tasks = [...project.tasks].sort((left, right) => {
        if (left.checked !== right.checked) {
          return left.checked ? 1 : -1;
        }

        if (left.finishedDate && right.finishedDate) {
          return right.finishedDate.localeCompare(left.finishedDate);
        }

        return left.line - right.line;
      });

      result.set(project.path, tasks);
    }
    return result;
  });

  const orderedProjectPickerColumns = $derived.by(() => {
    const availableById = new Map(state.availableProjectGridColumns.map((column) => [column.id, column]));
    const orderedIds = state.projectColumnOrderIds.length > 0
      ? state.projectColumnOrderIds
      : state.availableProjectGridColumns.map((column) => column.id);

    return orderedIds
      .map((id) => availableById.get(id))
      .filter((column): column is ProjectGridColumn => column !== undefined);
  });

  const projectColumnPickerItems = $derived.by(() =>
    orderedProjectPickerColumns.map((column) => ({
      id: column.id,
      label: column.label,
      visible: isProjectColumnVisible(column.id),
      hideable: column.id !== "project",
    }))
  );

  const projectTableColumns = $derived.by(() =>
    state.projectGridColumns.map((column) => ({
      id: column.id,
      label: column.label,
      sortable: Boolean(column.sortField),
      sortKey: column.sortField ?? "",
    }))
  );

  const orderedTaskColumns = $derived.by(() => {
    const byId = new Map(state.availableTaskGridColumns.map((column) => [column.id, column]));
    const order = state.taskColumnOrderIds.length > 0
      ? state.taskColumnOrderIds
      : state.availableTaskGridColumns.map((column) => column.id);
    return order
      .map((id) => byId.get(id))
      .filter((column): column is (typeof state.availableTaskGridColumns)[number] => column !== undefined);
  });

  const visibleTaskColumns = $derived.by(() => state.taskGridColumns);

  const taskColumnPickerItems = $derived.by(() =>
    orderedTaskColumns.map((column) => ({
      id: column.id,
      label: column.label,
      visible: state.taskGridColumns.some((visible) => visible.id === column.id),
      hideable: column.hideable !== false,
    }))
  );

  const sortedTasks = $derived.by(() => {
    const rows = state.tasks.filter((task) => shouldShowTaskInTasksView(task));
    rows.sort((left, right) => {
      const direction = state.taskSortDirection === "asc" ? 1 : -1;
      return direction * compareTasks(left, right);
    });
    return rows;
  });

  $effect(() => {
    if (!showStatusPicker && !showPriorityPicker && !showProjectTimingPicker && !showTaskPriorityPicker && !showProjectTaskStatusPicker && !showTaskStatusPicker && !showTaskTimingPicker) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        isInside(target, statusPickerWrap) ||
        isInside(target, priorityPickerWrap) ||
        isInside(target, projectTimingPickerWrap) ||
        isInside(target, taskPriorityPickerWrap) ||
        isInside(target, projectTaskStatusPickerWrap) ||
        isInside(target, taskStatusPickerWrap) ||
        isInside(target, taskTimingPickerWrap)
      ) {
        return;
      }

      closeFilterPickers();
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeFilterPickers();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  });

  function closeFilterPickers(): void {
    showStatusPicker = false;
    showPriorityPicker = false;
    showProjectTimingPicker = false;
    showTaskPriorityPicker = false;
    showProjectTaskStatusPicker = false;
    showTaskStatusPicker = false;
    showTaskTimingPicker = false;
  }

  function isInside(target: EventTarget | null, container: HTMLElement | null): boolean {
    return target instanceof Node && container?.contains(target) === true;
  }

  function toggleExpand(path: string): void {
    viewStore.toggleProjectExpanded(path);
  }

  function hasExpandableTasks(project: ProjectNote): boolean {
    return project.tasks.some((task) => task.state !== "checked");
  }

  function taskStatusForTask(task: ProjectTask): TaskStatusFilterOption {
    if (task.state === "checked") {
      return "Done";
    }

    if (task.state === "in-progress") {
      return state.triStateCheckboxes ? "Doing" : "To Do";
    }

    return "To Do";
  }

  function localIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function relativeLocalIsoDate(daysFromToday: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + daysFromToday);
    return localIsoDate(date);
  }

  function isTerminalProjectStatus(status: string | undefined): boolean {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized === "done" || normalized === "cancelled" || normalized === "canceled";
  }

  function plannedStartDate(scheduledDate: string | null, startDate: string | null): string | null {
    return scheduledDate ?? startDate;
  }

  function taskTimingStatuses(task: ProjectTask): TaskTimingFilterOption[] {
    const timing: TaskTimingFilterOption[] = [];
    const today = relativeLocalIsoDate(0);
    const tomorrow = relativeLocalIsoDate(1);
    const projectStatus = state.projectStatusByPath[task.projectPath];
    const timingStartDate = plannedStartDate(task.scheduledDate, task.startDate);

    if (
      !task.checked &&
      !isTerminalProjectStatus(projectStatus) &&
      timingStartDate &&
      task.dueDate &&
      timingStartDate <= today &&
      today <= task.dueDate
    ) {
      timing.push("Current");
    }

    if (task.scheduledDate && !task.startDate && today > task.scheduledDate) {
      timing.push("Off Schedule");
    }

    if (task.dueDate === today) {
      timing.push("Due");
    }

    if (task.dueDate && today > task.dueDate) {
      timing.push("Overdue");
    }

    if (timingStartDate === tomorrow) {
      timing.push("Tomorrow");
    }

    if (timingStartDate && timingStartDate > tomorrow) {
      timing.push("Future");
    }

    if (!timingStartDate && !task.dueDate) {
      timing.push("Needs Timing");
    }

    return timing;
  }

  function projectTimingStatuses(project: ProjectNote): TaskTimingFilterOption[] {
    const timing: TaskTimingFilterOption[] = [];
    const today = relativeLocalIsoDate(0);
    const tomorrow = relativeLocalIsoDate(1);
    const terminalStatus = isTerminalProjectStatus(project.status) || Boolean(project.finishDate);
    const timingStartDate = plannedStartDate(project.scheduledDate, project.startDate);

    if (
      !terminalStatus &&
      timingStartDate &&
      project.dueDate &&
      timingStartDate <= today &&
      today <= project.dueDate
    ) {
      timing.push("Current");
    }

    if (!terminalStatus && project.scheduledDate && !project.startDate && today > project.scheduledDate) {
      timing.push("Off Schedule");
    }

    if (!terminalStatus && project.dueDate === today) {
      timing.push("Due");
    }

    if (!terminalStatus && project.dueDate && today > project.dueDate) {
      timing.push("Overdue");
    }

    if (!terminalStatus && timingStartDate === tomorrow) {
      timing.push("Tomorrow");
    }

    if (!terminalStatus && timingStartDate && timingStartDate > tomorrow) {
      timing.push("Future");
    }

    if (!terminalStatus && !timingStartDate && !project.dueDate) {
      timing.push("Needs Timing");
    }

    return timing;
  }

  function shouldShowTask(task: ProjectTask): boolean {
    return selectedProjectTaskStatusSet.has(taskStatusForTask(task));
  }

  function shouldShowTaskInTasksView(task: ProjectTask): boolean {
    if (!shouldShowTask(task)) {
      return false;
    }

    if (!shouldShowTaskPriority(task)) {
      return false;
    }

    if (allTaskTimingSelected()) {
      return true;
    }

    const timing = taskTimingStatuses(task);
    if (timing.length === 0) {
      return false;
    }

    return timing.some((status) => selectedTaskTimings().has(status));
  }

  function shouldShowTaskPriority(task: ProjectTask): boolean {
    if (allTaskPrioritiesSelected()) {
      return true;
    }

    const selected = selectedTaskPriorities();
    if (selected.size === 0) {
      return false;
    }

    if (!task.priority) {
      return selected.has("none");
    }

    return selected.has(task.priority);
  }

  function sortByProjectColumn(field: ProjectSortField): void {
    const nextDirection = state.sortBy === field && state.sortDirection === "asc" ? "desc" : "asc";
    viewStore.setSort(field, nextDirection);
  }

  function handleProjectSort(sortKey: string): void {
    sortByProjectColumn(sortKey as ProjectSortField);
  }

  function sortByTaskColumn(field: TaskSortField): void {
    const nextDirection =
      state.taskSortBy === field && state.taskSortDirection === "asc" ? "desc" : "asc";
    viewStore.setTaskSort(field, nextDirection);
  }

  function handleTaskSort(sortKey: string): void {
    sortByTaskColumn(sortKey as TaskSortField);
  }

  function checkboxVisualState(node: HTMLInputElement, taskState: TaskState): { update: (nextState: TaskState) => void } {
    applyCheckboxVisual(node, taskState);

    return {
      update(nextState: TaskState): void {
        applyCheckboxVisual(node, nextState);
      },
    };
  }

  function nextTaskState(task: ProjectTask): TaskState {
    if (!state.triStateCheckboxes) {
      return task.state === "checked" ? "unchecked" : "checked";
    }

    if (task.state === "unchecked") {
      return "in-progress";
    }

    if (task.state === "in-progress") {
      return "checked";
    }

    return "unchecked";
  }

  function applyCheckboxVisual(node: HTMLInputElement, taskState: TaskState): void {
    node.dataset.taskState = taskState;
    node.checked = taskState === "checked";
    node.indeterminate = taskState === "in-progress";
    if (taskState === "in-progress") {
      node.setAttribute("aria-checked", "mixed");
    } else {
      node.setAttribute("aria-checked", taskState === "checked" ? "true" : "false");
    }
  }

  function handleTaskCheckboxClick(event: MouseEvent, task: ProjectTask): void {
    event.preventDefault();
    const nextState = nextTaskState(task);
    const target = event.currentTarget;
    if (target instanceof HTMLInputElement) {
      applyCheckboxVisual(target, nextState);
    }
    void viewStore.setTaskState(task.id, nextState);
  }

  function toggleStatusPicker(): void {
    showStatusPicker = !showStatusPicker;
    if (showStatusPicker) {
      showPriorityPicker = false;
      showProjectTimingPicker = false;
      showTaskPriorityPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function togglePriorityPicker(): void {
    showPriorityPicker = !showPriorityPicker;
    if (showPriorityPicker) {
      showStatusPicker = false;
      showProjectTimingPicker = false;
      showTaskPriorityPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function toggleProjectTimingPicker(): void {
    showProjectTimingPicker = !showProjectTimingPicker;
    if (showProjectTimingPicker) {
      showStatusPicker = false;
      showPriorityPicker = false;
      showTaskPriorityPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function toggleTaskPriorityPicker(): void {
    showTaskPriorityPicker = !showTaskPriorityPicker;
    if (showTaskPriorityPicker) {
      showStatusPicker = false;
      showPriorityPicker = false;
      showProjectTimingPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function toggleProjectTaskStatusPicker(): void {
    showProjectTaskStatusPicker = !showProjectTaskStatusPicker;
    if (showProjectTaskStatusPicker) {
      showStatusPicker = false;
      showPriorityPicker = false;
      showProjectTimingPicker = false;
      showTaskPriorityPicker = false;
      showTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function toggleTaskStatusPicker(): void {
    showTaskStatusPicker = !showTaskStatusPicker;
    if (showTaskStatusPicker) {
      showStatusPicker = false;
      showPriorityPicker = false;
      showProjectTimingPicker = false;
      showTaskPriorityPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskTimingPicker = false;
    }
  }

  function toggleTaskTimingPicker(): void {
    showTaskTimingPicker = !showTaskTimingPicker;
    if (showTaskTimingPicker) {
      showStatusPicker = false;
      showPriorityPicker = false;
      showProjectTimingPicker = false;
      showTaskPriorityPicker = false;
      showProjectTaskStatusPicker = false;
      showTaskStatusPicker = false;
    }
  }

  function allStatusesSelected(): boolean {
    return selectedStatuses().size === statusOptions.length && statusOptions.length > 0;
  }

  function allPrioritiesSelected(): boolean {
    return selectedPriorities().size === projectPriorityOptions.length && projectPriorityOptions.length > 0;
  }

  function statusButtonLabel(): string {
    const selectedCount = selectedStatuses().size;
    if (selectedCount === 0) {
      return "Status: None";
    }

    if (allStatusesSelected()) {
      return "Status: All";
    }

    return `Status: ${selectedCount}`;
  }

  function priorityButtonLabel(): string {
    const selectedCount = selectedPriorities().size;
    if (selectedCount === 0) {
      return "Priority: None";
    }

    if (allPrioritiesSelected()) {
      return "Priority: All";
    }

    return `Priority: ${selectedCount}`;
  }

  function allProjectTaskStatusesSelected(): boolean {
    return selectedProjectTaskStatuses().size === taskStatusOptions.length && taskStatusOptions.length > 0;
  }

  function allTaskPrioritiesSelected(): boolean {
    return selectedTaskPriorities().size === TASK_PRIORITY_OPTIONS.length && TASK_PRIORITY_OPTIONS.length > 0;
  }

  function allProjectTimingSelected(): boolean {
    return selectedProjectTimings().size === PROJECT_TIMING_OPTIONS.length && PROJECT_TIMING_OPTIONS.length > 0;
  }

  function projectTaskStatusButtonLabel(): string {
    const selectedCount = selectedProjectTaskStatuses().size;
    if (selectedCount === 0) {
      return "Task Status: None";
    }

    if (allProjectTaskStatusesSelected()) {
      return "Task Status: All";
    }

    return `Task Status: ${selectedCount}`;
  }

  function allTaskStatusesSelected(): boolean {
    return selectedTaskStatuses().size === taskStatusOptions.length && taskStatusOptions.length > 0;
  }

  function taskStatusButtonLabel(): string {
    const selectedCount = selectedTaskStatuses().size;
    if (selectedCount === 0) {
      return "Task Status: None";
    }

    if (allTaskStatusesSelected()) {
      return "Task Status: All";
    }

    return `Task Status: ${selectedCount}`;
  }

  function taskPriorityButtonLabel(): string {
    const selectedCount = selectedTaskPriorities().size;
    if (selectedCount === 0) {
      return "Task Priority: None";
    }

    if (allTaskPrioritiesSelected()) {
      return "Task Priority: All";
    }

    return `Task Priority: ${selectedCount}`;
  }

  function projectTimingButtonLabel(): string {
    const selectedCount = selectedProjectTimings().size;
    if (selectedCount === 0) {
      return "Timing: None";
    }

    if (allProjectTimingSelected()) {
      return "Timing: All";
    }

    return `Timing: ${selectedCount}`;
  }

  function allTaskTimingSelected(): boolean {
    return selectedTaskTimings().size === TASK_TIMING_OPTIONS.length && TASK_TIMING_OPTIONS.length > 0;
  }

  function taskTimingButtonLabel(): string {
    const selectedCount = selectedTaskTimings().size;
    if (selectedCount === 0) {
      return "Timing Status: None";
    }

    if (allTaskTimingSelected()) {
      return "Timing Status: All";
    }

    return `Timing Status: ${selectedCount}`;
  }

  function currentSavedViewLabel(): string {
    return state.savedViews.find((view) => view.id === state.activeSavedViewId)?.label ?? state.activeSavedViewName ?? "Default";
  }

  function selectedStatuses(): Set<string> {
    return new Set(state.statusFilter.filter((status) => statusOptions.includes(status)));
  }

  function selectedPriorities(): Set<string> {
    return new Set(
      state.priorityFilter.filter(
        (priority) => state.priorities.includes(priority) || priority === PROJECT_NO_PRIORITY_TOKEN,
      ),
    );
  }

  function selectedProjectTaskStatuses(): Set<TaskStatusFilterOption> {
    return selectedProjectTaskStatusSet;
  }

  function selectedTaskStatuses(): Set<TaskStatusFilterOption> {
    return selectedTaskStatusSet;
  }

  function selectedTaskPriorities(): Set<TaskPriorityFilterOption> {
    return selectedTaskPrioritySet;
  }

  function selectedProjectTimings(): Set<ProjectTimingFilterOption> {
    return selectedProjectTimingSet;
  }

  function selectedTaskTimings(): Set<TaskTimingFilterOption> {
    return selectedTaskTimingSet;
  }

  function handleStatusSelectAll(): void {
    viewStore.setStatusFilter(statusOptions);
  }

  function handleStatusSelectNone(): void {
    viewStore.setStatusFilter([FILTER_NONE_TOKEN]);
  }

  function handlePrioritySelectAll(): void {
    viewStore.setPriorityFilter(projectPriorityOptions);
  }

  function handlePrioritySelectNone(): void {
    viewStore.setPriorityFilter([FILTER_NONE_TOKEN]);
  }

  function handleProjectTaskStatusSelectAll(): void {
    viewStore.setProjectTaskStatusFilter([...taskStatusOptions]);
  }

  function handleProjectTaskStatusSelectNone(): void {
    viewStore.setProjectTaskStatusFilter([]);
  }

  function handleTasksViewStatusSelectAll(): void {
    viewStore.setTaskStatusFilter([...taskStatusOptions]);
  }

  function handleTasksViewStatusSelectNone(): void {
    viewStore.setTaskStatusFilter([]);
  }

  function handleTaskPrioritySelectAll(): void {
    viewStore.setTaskPriorityFilter([...TASK_PRIORITY_OPTIONS]);
  }

  function handleTaskPrioritySelectNone(): void {
    viewStore.setTaskPriorityFilter([]);
  }

  function handleProjectTimingSelectAll(): void {
    viewStore.setProjectTimingFilter([...PROJECT_TIMING_OPTIONS]);
  }

  function handleProjectTimingSelectNone(): void {
    viewStore.setProjectTimingFilter([]);
  }

  function handleTaskTimingSelectAll(): void {
    viewStore.setTaskTimingFilter([...TASK_TIMING_OPTIONS]);
  }

  function handleTaskTimingSelectNone(): void {
    viewStore.setTaskTimingFilter([]);
  }

  function handleStatusOptionChange(status: string, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = selectedStatuses();
    if (checked) {
      next.add(status);
    } else {
      next.delete(status);
    }
    viewStore.setStatusFilter(next.size > 0 ? Array.from(next) : [FILTER_NONE_TOKEN]);
  }

  function handlePriorityOptionChange(priority: string, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = selectedPriorities();
    if (checked) {
      next.add(priority);
    } else {
      next.delete(priority);
    }
    viewStore.setPriorityFilter(next.size > 0 ? Array.from(next) : [FILTER_NONE_TOKEN]);
  }

  function handleProjectTaskStatusOptionChange(taskStatus: TaskStatusFilterOption, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = new Set(selectedProjectTaskStatuses());
    if (checked) {
      next.add(taskStatus);
    } else {
      next.delete(taskStatus);
    }

    const normalized = taskStatusOptions.filter((status) => next.has(status));
    viewStore.setProjectTaskStatusFilter(normalized);
  }

  function handleTaskStatusOptionChange(taskStatus: TaskStatusFilterOption, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = new Set(selectedTaskStatuses());
    if (checked) {
      next.add(taskStatus);
    } else {
      next.delete(taskStatus);
    }

    const normalized = taskStatusOptions.filter((status) => next.has(status));
    viewStore.setTaskStatusFilter(normalized);
  }

  function handleTaskPriorityOptionChange(taskPriority: TaskPriorityFilterOption, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = new Set(selectedTaskPriorities());
    if (checked) {
      next.add(taskPriority);
    } else {
      next.delete(taskPriority);
    }

    const normalized = TASK_PRIORITY_OPTIONS.filter((priority) => next.has(priority));
    viewStore.setTaskPriorityFilter(normalized);
  }

  function handleProjectTimingOptionChange(projectTiming: ProjectTimingFilterOption, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = new Set(selectedProjectTimings());
    if (checked) {
      next.add(projectTiming);
    } else {
      next.delete(projectTiming);
    }

    const normalized = PROJECT_TIMING_OPTIONS.filter((status) => next.has(status));
    viewStore.setProjectTimingFilter(normalized);
  }

  function handleTaskTimingOptionChange(taskTiming: TaskTimingFilterOption, event: Event): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    const next = new Set(selectedTaskTimings());
    if (checked) {
      next.add(taskTiming);
    } else {
      next.delete(taskTiming);
    }

    const normalized = TASK_TIMING_OPTIONS.filter((status) => next.has(status));
    viewStore.setTaskTimingFilter(normalized);
  }

  function isProjectColumnVisible(columnId: string): boolean {
    return state.projectGridColumns.some((column) => column.id === columnId);
  }

  function handleProjectColumnVisibility(columnId: string, visible: boolean): void {
    const visibleIds = new Set(state.projectGridColumns.map((column) => column.id));
    if (visible) {
      visibleIds.add(columnId);
    } else {
      visibleIds.delete(columnId);
    }

    const nextVisibleIds = state.projectColumnOrderIds.filter((id) => visibleIds.has(id));
    viewStore.setProjectGridColumns(nextVisibleIds);
  }

  function handleProjectColumnOrder(nextOrder: string[]): void {
    viewStore.setProjectColumnOrder(nextOrder);
  }

  function handleTaskColumnVisibility(columnId: string, visible: boolean): void {
    const current = new Set(state.taskGridColumns.map((column) => column.id));
    if (visible) {
      current.add(columnId);
    } else {
      current.delete(columnId);
    }

    const next = state.taskColumnOrderIds.filter((id) => current.has(id));
    viewStore.setTaskGridColumns(next.length > 0 ? next : ["task"]);
  }

  function handleTaskColumnOrder(nextOrder: string[]): void {
    viewStore.setTaskColumnOrder(nextOrder);
  }

  function compareTasks(left: ProjectTask, right: ProjectTask): number {
    switch (state.taskSortBy) {
      case "state":
        return compareTaskState(left, right);
      case "task":
        return compareText(getTaskDisplayText(left), getTaskDisplayText(right));
      case "project":
        return compareText(left.projectName, right.projectName);
      case "requester":
        return compareText((left.projectRequester ?? []).join(", "), (right.projectRequester ?? []).join(", "));
      case "scheduled":
        return compareNullableDate(left.scheduledDate, right.scheduledDate);
      case "start":
        return compareNullableDate(left.startDate, right.startDate);
      case "finish":
        return compareNullableDate(left.finishedDate, right.finishedDate);
      case "timing":
        return compareText(timingSortValue(left), timingSortValue(right));
      case "due":
      default:
        return compareNullableDate(left.dueDate, right.dueDate);
    }
  }

  function timingSortValue(task: ProjectTask): string {
    return taskTimingStatuses(task).join("|");
  }

  function handleSavedViewSelect(id: string): void {
    void viewStore.selectSavedView(id);
  }

  function handleSavedViewDelete(id: string): void {
    void viewStore.deleteSavedView(id);
  }

  function handleSaveView(): void {
    void viewStore.promptSaveCurrentView();
  }

  function compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: "base" });
  }

  function compareNullableDate(left: string | null, right: string | null): number {
    if (left && right) {
      return left.localeCompare(right);
    }
    if (left) {
      return -1;
    }
    if (right) {
      return 1;
    }
    return 0;
  }

  function compareTaskState(left: ProjectTask, right: ProjectTask): number {
    const order: Record<TaskState, number> = {
      unchecked: 0,
      "in-progress": 1,
      checked: 2,
    };

    return order[left.state] - order[right.state];
  }

  function handleStatusChange(project: ProjectNote, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void viewStore.updateProject({
      path: project.path,
      key: "status",
      value,
    });
  }

  function handlePriorityChange(project: ProjectNote, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    void viewStore.updateProject({
      path: project.path,
      key: "priority",
      value,
    });
  }

  function readDateInputValue(event: Event): string | null {
    const value = (event.currentTarget as HTMLInputElement).value.trim();
    return value.length > 0 ? value : null;
  }

  function handleProjectDateChange(project: ProjectNote, key: ProjectMetadataKey, event: Event): void {
    void viewStore.updateProject({
      path: project.path,
      key,
      value: readDateInputValue(event) ?? "",
    });
  }

  function handleTaskDateChange(task: ProjectTask, field: TaskDateField, event: Event): void {
    void viewStore.setTaskDate(task.id, field, readDateInputValue(event));
  }

  function badgeToken(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function statusBadgeClass(status: string): string {
    const token = badgeToken(status);
    return token.length > 0 ? `opn-status-${token}` : "opn-status-default";
  }

  function priorityBadgeClass(priority: string): string {
    const token = badgeToken(priority);
    return token.length > 0 ? `opn-priority-${token}` : "opn-priority-default";
  }

  function handleProjectLinkClick(event: MouseEvent, path: string): void {
    event.preventDefault();
    void viewStore.openProject(path);
  }

  function parseWikiLink(value: string): { target: string; label: string; reference: string } | null {
    const trimmed = value.trim();
    const match = trimmed.match(/^\[\[([^\]]+)\]\]$/u);
    if (!match) {
      return null;
    }

    const inner = match[1];
    const [targetRaw = "", aliasRaw = ""] = inner.split("|", 2);
    const target = (targetRaw.split("#", 1)[0] ?? "").trim();
    if (target.length === 0) {
      return null;
    }

    const alias = aliasRaw.trim();
    return {
      target,
      label: alias.length > 0 ? alias : target,
      reference: `[[${inner}]]`,
    };
  }

  function parseCellSegments(value: string): CellSegment[] {
    const segments: CellSegment[] = [];
    let cursor = 0;

    while (cursor < value.length) {
      const nextWiki = findRegexMatchFrom(WIKI_LINK_REGEX, value, cursor);
      const nextMarkdownExternal = findRegexMatchFrom(MARKDOWN_EXTERNAL_LINK_REGEX, value, cursor);
      const nextExternalUrl = findRegexMatchFrom(EXTERNAL_URL_REGEX, value, cursor);
      const nextMatch = earliestSegmentMatch(nextWiki, nextMarkdownExternal, nextExternalUrl);

      if (!nextMatch) {
        segments.push({
          text: value.slice(cursor),
          linkReference: null,
          target: null,
          externalUrl: null,
        });
        cursor = value.length;
        break;
      }

      if (nextMatch.start > cursor) {
        segments.push({
          text: value.slice(cursor, nextMatch.start),
          linkReference: null,
          target: null,
          externalUrl: null,
        });
      }

      if (nextMatch.type === "wiki") {
        const parsed = parseWikiLink(nextMatch.text);
        if (parsed) {
          segments.push({
            text: parsed.label,
            linkReference: parsed.reference,
            target: parsed.target,
            externalUrl: null,
          });
        } else {
          segments.push({
            text: nextMatch.text,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      } else if (nextMatch.type === "markdown-external") {
        const [, labelRaw = "", hrefRaw = ""] = nextMatch.match;
        const label = labelRaw.trim();
        const href = hrefRaw.trim();
        if (href.length > 0) {
          segments.push({
            text: label.length > 0 ? label : href,
            linkReference: null,
            target: null,
            externalUrl: href,
          });
        } else {
          segments.push({
            text: nextMatch.text,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      } else {
        const urlMatch = splitTrailingUrlPunctuation(nextMatch.text);
        segments.push({
          text: urlMatch.url,
          linkReference: null,
          target: null,
          externalUrl: urlMatch.url,
        });
        if (urlMatch.trailing.length > 0) {
          segments.push({
            text: urlMatch.trailing,
            linkReference: null,
            target: null,
            externalUrl: null,
          });
        }
      }

      cursor = nextMatch.end;
    }

    if (segments.length === 0) {
      segments.push({
        text: value,
        linkReference: null,
        target: null,
        externalUrl: null,
      });
    }

    return segments;
  }

  function findRegexMatchFrom(regex: RegExp, value: string, fromIndex: number): RegExpExecArray | null {
    regex.lastIndex = fromIndex;
    return regex.exec(value);
  }

  function earliestSegmentMatch(
    wiki: RegExpExecArray | null,
    markdownExternal: RegExpExecArray | null,
    externalUrl: RegExpExecArray | null,
  ):
    | { type: "wiki" | "markdown-external" | "external-url"; start: number; end: number; text: string; match: RegExpExecArray }
    | null {
    const candidates: Array<{
      type: "wiki" | "markdown-external" | "external-url";
      start: number;
      end: number;
      text: string;
      match: RegExpExecArray;
    }> = [];

    if (wiki && typeof wiki.index === "number") {
      candidates.push({
        type: "wiki",
        start: wiki.index,
        end: wiki.index + wiki[0].length,
        text: wiki[0],
        match: wiki,
      });
    }

    if (markdownExternal && typeof markdownExternal.index === "number") {
      candidates.push({
        type: "markdown-external",
        start: markdownExternal.index,
        end: markdownExternal.index + markdownExternal[0].length,
        text: markdownExternal[0],
        match: markdownExternal,
      });
    }

    if (externalUrl && typeof externalUrl.index === "number") {
      candidates.push({
        type: "external-url",
        start: externalUrl.index,
        end: externalUrl.index + externalUrl[0].length,
        text: externalUrl[0],
        match: externalUrl,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => left.start - right.start);
    return candidates[0];
  }

  function splitTrailingUrlPunctuation(value: string): { url: string; trailing: string } {
    const match = value.match(/^(.*?)([.,!?;:]+)?$/u);
    if (!match) {
      return { url: value, trailing: "" };
    }

    const url = match[1] || value;
    const trailing = match[2] || "";
    return { url, trailing };
  }

  function handleCellLinkClick(event: MouseEvent, linkReference: string, sourcePath: string): void {
    event.preventDefault();
    void viewStore.openProjectLink(linkReference, sourcePath);
  }

  function handleTaskLinkClick(event: MouseEvent, task: ProjectTask): void {
    event.preventDefault();
    void viewStore.openProjectTask(task.projectPath, task.line);
  }

  function customPropertyValue(project: ProjectNote, column: ProjectGridColumn): string {
    const key = column.propertyKey;
    if (!key) {
      return "";
    }

    return project.customProperties?.[key] ?? "";
  }

  function getTaskDisplayText(task: ProjectTask): string {
    const displayText = task.text.replace(TASK_DATE_TOKEN_REGEX, "").replace(/\s{2,}/g, " ").trim();
    return displayText.length > 0 ? displayText : task.text;
  }

  function normalizeProjectReference(value: string): string {
    return value.trim().replace(/\.md$/iu, "").toLowerCase();
  }

  function createParentResolver(projects: ProjectNote[]): (project: ProjectNote) => string | null {
    const pathByReference = new Map<string, string>();
    for (const project of projects) {
      const pathWithoutExt = project.path.replace(/\.md$/iu, "");
      const fileName = pathWithoutExt.split("/").pop() ?? pathWithoutExt;
      const refs = new Set<string>([
        pathWithoutExt,
        fileName,
        project.title,
        project.displayName,
        ...project.aliases,
      ]);

      for (const ref of refs) {
        const normalized = normalizeProjectReference(ref);
        if (!normalized || pathByReference.has(normalized)) {
          continue;
        }
        pathByReference.set(normalized, project.path);
      }
    }

    return (project: ProjectNote): string | null => {
      const rawParent = project.parentProject?.trim();
      if (!rawParent) {
        return null;
      }

      const parsed = parseWikiLink(rawParent);
      const candidateTarget = parsed ? parsed.target : rawParent;
      const normalizedTarget = normalizeProjectReference(candidateTarget);
      if (!normalizedTarget) {
        return null;
      }

      return pathByReference.get(normalizedTarget) ?? null;
    };
  }
</script>

<div class={`opn-grid opn-${variant}`}>
  <section class="opn-grid-controls">
    {#if state.gridTab === "projects"}
      <div class="opn-grid-filter-row opn-projects-controls">
        <div class="opn-grid-filter-left">
          <SearchInput
            ariaLabel="Search projects"
            placeholder="Search Projects"
            value={state.projectSearch}
            onChange={(value) => viewStore.setProjectSearch(value)}
          />

          <ColumnPicker
            label="Columns"
            items={projectColumnPickerItems}
            onToggle={handleProjectColumnVisibility}
            onReorder={handleProjectColumnOrder}
          />

          <div class="opn-multiselect-wrap" bind:this={statusPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showStatusPicker}
              onclick={toggleStatusPicker}
            >
              {statusButtonLabel()}
            </button>

            {#if showStatusPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleStatusSelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleStatusSelectNone}>
                    None
                  </button>
                </div>
                {#each statusOptions as status (status)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedStatuses().has(status)}
                      onchange={(event) => handleStatusOptionChange(status, event)}
                    />
                    {status}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="opn-multiselect-wrap" bind:this={priorityPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showPriorityPicker}
              onclick={togglePriorityPicker}
            >
              {priorityButtonLabel()}
            </button>

            {#if showPriorityPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handlePrioritySelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handlePrioritySelectNone}>
                    None
                  </button>
                </div>
                {#each projectPriorityOptions as priority (priority)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedPriorities().has(priority)}
                      onchange={(event) => handlePriorityOptionChange(priority, event)}
                    />
                    {#if priority === PROJECT_NO_PRIORITY_TOKEN}
                      No Priority
                    {:else}
                      {priority}
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="opn-multiselect-wrap" bind:this={projectTimingPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showProjectTimingPicker}
              onclick={toggleProjectTimingPicker}
            >
              {projectTimingButtonLabel()}
            </button>

            {#if showProjectTimingPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleProjectTimingSelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleProjectTimingSelectNone}>
                    None
                  </button>
                </div>
                {#each PROJECT_TIMING_OPTIONS as projectTiming (projectTiming)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedProjectTimings().has(projectTiming)}
                      onchange={(event) => handleProjectTimingOptionChange(projectTiming, event)}
                    />
                    {projectTiming}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="opn-multiselect-wrap" bind:this={projectTaskStatusPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showProjectTaskStatusPicker}
              onclick={toggleProjectTaskStatusPicker}
            >
              {projectTaskStatusButtonLabel()}
            </button>

            {#if showProjectTaskStatusPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleProjectTaskStatusSelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleProjectTaskStatusSelectNone}>
                    None
                  </button>
                </div>
                {#each taskStatusOptions as taskStatus (taskStatus)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedProjectTaskStatuses().has(taskStatus)}
                      onchange={(event) => handleProjectTaskStatusOptionChange(taskStatus, event)}
                    />
                    {taskStatus}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="opn-grid-filter-right">
          <SavedViewPicker
            currentLabel={currentSavedViewLabel()}
            items={state.savedViews}
            onSelect={handleSavedViewSelect}
            onDelete={handleSavedViewDelete}
          />
          <button type="button" class="secondary" onclick={handleSaveView}>
            Save
          </button>
          <button type="button" class="mod-cta" onclick={() => void viewStore.createProjectNote()}>
            Add Project
          </button>
        </div>
      </div>
    {:else}
      <div class="opn-grid-filter-row opn-projects-controls">
        <div class="opn-grid-filter-left">
          <SearchInput
            ariaLabel="Search tasks"
            placeholder="Search Tasks"
            value={state.taskSearch}
            onChange={(value) => viewStore.setTaskSearch(value)}
          />

          <ColumnPicker
            label="Columns"
            items={taskColumnPickerItems}
            onToggle={handleTaskColumnVisibility}
            onReorder={handleTaskColumnOrder}
          />

          <div class="opn-multiselect-wrap" bind:this={taskStatusPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showTaskStatusPicker}
              onclick={toggleTaskStatusPicker}
            >
              {taskStatusButtonLabel()}
            </button>

            {#if showTaskStatusPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTasksViewStatusSelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTasksViewStatusSelectNone}>
                    None
                  </button>
                </div>
                {#each taskStatusOptions as taskStatus (taskStatus)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedTaskStatuses().has(taskStatus)}
                      onchange={(event) => handleTaskStatusOptionChange(taskStatus, event)}
                    />
                    {taskStatus}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="opn-multiselect-wrap" bind:this={taskPriorityPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showTaskPriorityPicker}
              onclick={toggleTaskPriorityPicker}
            >
              {taskPriorityButtonLabel()}
            </button>

            {#if showTaskPriorityPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTaskPrioritySelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTaskPrioritySelectNone}>
                    None
                  </button>
                </div>
                {#each TASK_PRIORITY_OPTIONS as priority (priority)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedTaskPriorities().has(priority)}
                      onchange={(event) => handleTaskPriorityOptionChange(priority, event)}
                    />
                    {#if priority === "none"}
                      No Priority
                    {:else}
                      {TASK_PRIORITY_METADATA[priority].emoji} {TASK_PRIORITY_METADATA[priority].label}
                    {/if}
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="opn-multiselect-wrap" bind:this={taskTimingPickerWrap}>
            <button
              type="button"
              class="secondary"
              aria-haspopup="dialog"
              aria-expanded={showTaskTimingPicker}
              onclick={toggleTaskTimingPicker}
            >
              {taskTimingButtonLabel()}
            </button>

            {#if showTaskTimingPicker}
              <div class="opn-multiselect-menu" role="dialog">
                <div class="opn-multiselect-actions">
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTaskTimingSelectAll}>
                    All
                  </button>
                  <button type="button" class="secondary opn-multiselect-action" onclick={handleTaskTimingSelectNone}>
                    None
                  </button>
                </div>
                {#each TASK_TIMING_OPTIONS as taskTiming (taskTiming)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedTaskTimings().has(taskTiming)}
                      onchange={(event) => handleTaskTimingOptionChange(taskTiming, event)}
                    />
                    {taskTiming}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="opn-grid-filter-right">
          <SavedViewPicker
            currentLabel={currentSavedViewLabel()}
            items={state.savedViews}
            onSelect={handleSavedViewSelect}
            onDelete={handleSavedViewDelete}
          />
          <button type="button" class="secondary" onclick={handleSaveView}>
            Save
          </button>
          <button type="button" class="mod-cta" onclick={() => void viewStore.createTaskInCurrentArea()}>
            Add Task
          </button>
        </div>
      </div>
    {/if}
  </section>

  {#if state.gridTab === "projects"}
    <GridTable
      ariaLabel="Projects grid"
      columns={projectTableColumns}
      sortBy={state.sortBy}
      sortDirection={state.sortDirection}
      onSort={handleProjectSort}
      showLeadingColumn={true}
    >
      {#each filteredProjects as project (project.path)}
        <tr>
          <td>
            {#if hasExpandableTasks(project)}
              <button
                type="button"
                class="secondary"
                onclick={() => toggleExpand(project.path)}
              >
                {state.projectExpandedPaths.includes(project.path) ? "▾" : "▸"}
              </button>
            {/if}
          </td>
          {#each state.projectGridColumns as column (column.id)}
            <td>
              {#if column.id === "project"}
                <a
                  href={encodeURI(project.path)}
                  class="opn-link"
                  onclick={(event) => handleProjectLinkClick(event, project.path)}
                >
                  {project.displayName}
                </a>
              {:else if column.id === "status"}
                <select
                  value={project.status}
                  class={`opn-grid-inline-editor opn-badge-select opn-status-badge ${statusBadgeClass(project.status)}`}
                  onchange={(event) => handleStatusChange(project, event)}
                >
                  {#each statusOptions as status (status)}
                    <option value={status}>{status}</option>
                  {/each}
                </select>
              {:else if column.id === "priority"}
                <select
                  value={project.priority}
                  class={`opn-grid-inline-editor opn-badge-select opn-priority-badge ${priorityBadgeClass(project.priority)}`}
                  onchange={(event) => handlePriorityChange(project, event)}
                >
                  <option value="">No Priority</option>
                  {#each state.priorities as priority (priority)}
                    <option value={priority}>{priority}</option>
                  {/each}
                </select>
              {:else if column.id === "scheduled-date"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${project.scheduledDate ? "" : "is-empty"}`}
                  value={project.scheduledDate ?? ""}
                  onchange={(event) => handleProjectDateChange(project, "scheduled-date", event)}
                />
              {:else if column.id === "start-date"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${project.startDate ? "" : "is-empty"}`}
                  value={project.startDate ?? ""}
                  onchange={(event) => handleProjectDateChange(project, "start-date", event)}
                />
              {:else if column.id === "finish-date"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${project.finishDate ? "" : "is-empty"}`}
                  value={project.finishDate ?? ""}
                  onchange={(event) => handleProjectDateChange(project, "finish-date", event)}
                />
              {:else if column.id === "due-date"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${project.dueDate ? "" : "is-empty"}`}
                  value={project.dueDate ?? ""}
                  onchange={(event) => handleProjectDateChange(project, "due-date", event)}
                />
              {:else if column.id === "timing-status"}
                {@const timingStatuses = projectTimingStatuses(project)}
                {#if timingStatuses.length > 0}
                  <div class="opn-task-timing-badges">
                    {#each timingStatuses as timing (timing)}
                      <span class={`opn-task-timing-badge opn-task-timing-${badgeToken(timing)}`}>
                        {timing}
                      </span>
                    {/each}
                  </div>
                {:else}
                  {""}
                {/if}
              {:else if column.id === "tags"}
                {project.tags.join(", ")}
              {:else if column.id === "parent-project"}
                {#if project.parentProject}
                  {#each parseCellSegments(project.parentProject) as segment, index (`${project.path}:parent:${index}`)}
                    {#if segment.linkReference}
                      <a
                        href={encodeURI(segment.target ?? "")}
                        class="opn-link"
                        onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", project.path)}
                      >
                        {segment.text}
                      </a>
                    {:else if segment.externalUrl}
                      <a
                        href={segment.externalUrl}
                        class="opn-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {segment.text}
                      </a>
                    {:else}
                      {segment.text}
                    {/if}
                  {/each}
                {:else}
                  {""}
                {/if}
              {:else if column.id === "requester"}
                {@const requesterValue = project.requester.join(", ")}
                {#if requesterValue.length > 0}
                  {#each parseCellSegments(requesterValue) as segment, index (`${project.path}:requester:${index}`)}
                    {#if segment.linkReference}
                      <a
                        href={encodeURI(segment.target ?? "")}
                        class="opn-link"
                        onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", project.path)}
                      >
                        {segment.text}
                      </a>
                    {:else if segment.externalUrl}
                      <a
                        href={segment.externalUrl}
                        class="opn-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {segment.text}
                      </a>
                    {:else}
                      {segment.text}
                    {/if}
                  {/each}
                {:else}
                  {""}
                {/if}
              {:else if column.kind === "property"}
                {@const propertyValue = customPropertyValue(project, column)}
                {#if propertyValue.length > 0}
                  {#each parseCellSegments(propertyValue) as segment, index (`${project.path}:${column.id}:${index}`)}
                    {#if segment.linkReference}
                      <a
                        href={encodeURI(segment.target ?? "")}
                        class="opn-link"
                        onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", project.path)}
                      >
                        {segment.text}
                      </a>
                    {:else if segment.externalUrl}
                      <a
                        href={segment.externalUrl}
                        class="opn-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {segment.text}
                      </a>
                    {:else}
                      {segment.text}
                    {/if}
                  {/each}
                {:else}
                  {""}
                {/if}
              {:else}
                {""}
              {/if}
            </td>
          {/each}
        </tr>

        {#if hasExpandableTasks(project) && state.projectExpandedPaths.includes(project.path)}
          <tr class="opn-row-detail">
            <td colspan={state.projectGridColumns.length + 1}>
              <ul class="opn-task-list">
                {#each sortedTasksByProject.get(project.path) ?? [] as task (task.id)}
                  {#if shouldShowTask(task)}
                    <li>
                      <input
                        type="checkbox"
                        class="opn-task-checkbox"
                        checked={task.state === "checked"}
                        use:checkboxVisualState={task.state}
                        onclick={(event) => handleTaskCheckboxClick(event, task)}
                      />
                      <span>{task.text}</span>
                    </li>
                  {/if}
                {/each}
              </ul>
            </td>
          </tr>
        {/if}
      {/each}
    </GridTable>
  {:else}
    <GridTable
      ariaLabel="Tasks grid"
      columns={visibleTaskColumns.map((column) => ({
        id: column.id,
        label: column.label,
        sortable: true,
        sortKey: column.sortField,
      }))}
      sortBy={state.taskSortBy}
      sortDirection={state.taskSortDirection}
      onSort={handleTaskSort}
    >
      {#each sortedTasks as task (task.id)}
        <tr>
          {#each visibleTaskColumns as column (column.id)}
            <td>
              {#if column.id === "done"}
                <input
                  type="checkbox"
                  class="opn-task-checkbox"
                  checked={task.state === "checked"}
                  use:checkboxVisualState={task.state}
                  onclick={(event) => handleTaskCheckboxClick(event, task)}
                />
              {:else if column.id === "task"}
                <a
                  href={encodeURI(task.projectPath)}
                  class="opn-link"
                  onclick={(event) => handleTaskLinkClick(event, task)}
                >
                  {getTaskDisplayText(task)}
                </a>
              {:else if column.id === "project"}
                <a
                  href={encodeURI(task.projectPath)}
                  class="opn-link"
                  onclick={(event) => handleProjectLinkClick(event, task.projectPath)}
                >
                  {task.projectName}
                </a>
              {:else if column.id === "requester"}
                {@const taskRequesterValue = (task.projectRequester ?? []).join(", ")}
                {#if taskRequesterValue.length > 0}
                  {#each parseCellSegments(taskRequesterValue) as segment, index (`${task.id}:requester:${index}`)}
                    {#if segment.linkReference}
                      <a
                        href={encodeURI(segment.target ?? "")}
                        class="opn-link"
                        onclick={(event) => handleCellLinkClick(event, segment.linkReference ?? "", task.projectPath)}
                      >
                        {segment.text}
                      </a>
                    {:else if segment.externalUrl}
                      <a
                        href={segment.externalUrl}
                        class="opn-link"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {segment.text}
                      </a>
                    {:else}
                      {segment.text}
                    {/if}
                  {/each}
                {:else}
                  {""}
                {/if}
              {:else if column.id === "scheduled"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${task.scheduledDate ? "" : "is-empty"}`}
                  value={task.scheduledDate ?? ""}
                  onchange={(event) => handleTaskDateChange(task, "scheduled", event)}
                />
              {:else if column.id === "start"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${task.startDate ? "" : "is-empty"}`}
                  value={task.startDate ?? ""}
                  onchange={(event) => handleTaskDateChange(task, "start", event)}
                />
              {:else if column.id === "due"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${task.dueDate ? "" : "is-empty"}`}
                  value={task.dueDate ?? ""}
                  onchange={(event) => handleTaskDateChange(task, "due", event)}
                />
              {:else if column.id === "finish"}
                <input
                  type="date"
                  class={`opn-grid-inline-editor opn-grid-date-input ${task.finishedDate ? "" : "is-empty"}`}
                  value={task.finishedDate ?? ""}
                  onchange={(event) => handleTaskDateChange(task, "finish", event)}
                />
              {:else if column.id === "timing"}
                {@const timingStatuses = taskTimingStatuses(task)}
                {#if timingStatuses.length > 0}
                  <div class="opn-task-timing-badges">
                    {#each timingStatuses as timing (timing)}
                      <span class={`opn-task-timing-badge opn-task-timing-${badgeToken(timing)}`}>
                        {timing}
                      </span>
                    {/each}
                  </div>
                {:else}
                  {""}
                {/if}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </GridTable>
  {/if}
</div>
