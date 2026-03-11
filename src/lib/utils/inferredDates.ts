import type {
  ProjectNote,
  ProjectTask,
  ProjectTimingFilterOption,
  ResolvedDateField,
  ResolvedDateKey,
  ResolvedDateSet,
  TaskTimingFilterOption,
} from "../types";

type DateCarrier = Pick<ProjectNote, "scheduledDate" | "startDate" | "dueDate" | "inferDatesOverride">;

function rawResolvedDate(value: string | null): ResolvedDateField {
  return {
    value,
    isInferred: false,
  };
}

export function createRawResolvedDates(dates?: Partial<Record<ResolvedDateKey, string | null>>): ResolvedDateSet {
  return {
    scheduled: rawResolvedDate(dates?.scheduled ?? null),
    start: rawResolvedDate(dates?.start ?? null),
    due: rawResolvedDate(dates?.due ?? null),
  };
}

function isTaskFinished(task: ProjectTask): boolean {
  return task.state === "checked" || Boolean(task.finishedDate);
}

function compareNullableDateAsc(left: string | null, right: string | null): number {
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

function earliestUnfinishedTaskDate(tasks: ProjectTask[], key: ResolvedDateKey): string | null {
  const candidates = tasks
    .filter((task) => !isTaskFinished(task))
    .filter((task) => {
      if (key === "scheduled") {
        return Boolean(task.scheduledDate);
      }

      if (key === "start") {
        return Boolean(task.startDate);
      }

      return Boolean(task.dueDate);
    })
    .slice()
    .sort((left, right) => {
      const leftValue = key === "scheduled" ? left.scheduledDate : key === "start" ? left.startDate : left.dueDate;
      const rightValue = key === "scheduled" ? right.scheduledDate : key === "start" ? right.startDate : right.dueDate;
      return compareNullableDateAsc(leftValue, rightValue) || left.line - right.line;
    });

  if (candidates.length === 0) {
    return null;
  }

  const task = candidates[0];
  if (key === "scheduled") {
    return task.scheduledDate;
  }

  if (key === "start") {
    return task.startDate;
  }

  return task.dueDate;
}

function resolveField(rawValue: string | null, inferredValue: string | null): ResolvedDateField {
  if (rawValue) {
    return {
      value: rawValue,
      isInferred: false,
    };
  }

  if (inferredValue) {
    return {
      value: inferredValue,
      isInferred: true,
    };
  }

  return {
    value: null,
    isInferred: false,
  };
}

function shouldInferDates(project: DateCarrier, globalInferDates: boolean): boolean {
  if (project.inferDatesOverride !== null) {
    return project.inferDatesOverride;
  }

  return globalInferDates;
}

export function resolveProjectDates(project: ProjectNote, inferDates: boolean): ResolvedDateSet {
  if (!shouldInferDates(project, inferDates)) {
    return createRawResolvedDates({
      scheduled: project.scheduledDate,
      start: project.startDate,
      due: project.dueDate,
    });
  }

  return {
    scheduled: resolveField(project.scheduledDate, earliestUnfinishedTaskDate(project.tasks, "scheduled")),
    start: resolveField(project.startDate, earliestUnfinishedTaskDate(project.tasks, "start")),
    due: resolveField(project.dueDate, earliestUnfinishedTaskDate(project.tasks, "due")),
  };
}

export function resolveTaskDates(task: ProjectTask, project: DateCarrier, inferDates: boolean): ResolvedDateSet {
  if (!shouldInferDates(project, inferDates)) {
    return createRawResolvedDates({
      scheduled: task.scheduledDate,
      start: task.startDate,
      due: task.dueDate,
    });
  }

  return {
    scheduled: resolveField(task.scheduledDate, project.scheduledDate),
    start: resolveField(task.startDate, project.startDate),
    due: resolveField(task.dueDate, project.dueDate),
  };
}

export function applyResolvedDates(project: ProjectNote, inferDates: boolean): ProjectNote {
  const tasks = project.tasks.map((task) => ({
    ...task,
    resolvedDates: resolveTaskDates(task, project, inferDates),
  }));
  const nextProject = {
    ...project,
    tasks,
  };

  return {
    ...nextProject,
    resolvedDates: resolveProjectDates(nextProject, inferDates),
  };
}

export function plannedStartDate(resolvedDates: ResolvedDateSet): string | null {
  return resolvedDates.scheduled.value ?? resolvedDates.start.value;
}

function isTerminalProjectStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "done" || normalized === "cancelled" || normalized === "canceled";
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

export function projectTimingStatuses(project: ProjectNote): ProjectTimingFilterOption[] {
  const timing: ProjectTimingFilterOption[] = [];
  const today = relativeLocalIsoDate(0);
  const tomorrow = relativeLocalIsoDate(1);
  const terminalStatus = isTerminalProjectStatus(project.status) || Boolean(project.finishDate);
  const timingStartDate = plannedStartDate(project.resolvedDates);

  if (
    !terminalStatus &&
    timingStartDate &&
    project.resolvedDates.due.value &&
    timingStartDate <= today &&
    today <= project.resolvedDates.due.value
  ) {
    timing.push("Current");
  }

  if (!terminalStatus && project.resolvedDates.scheduled.value && !project.resolvedDates.start.value && today > project.resolvedDates.scheduled.value) {
    timing.push("Off Schedule");
  }

  if (!terminalStatus && project.resolvedDates.due.value === today) {
    timing.push("Due");
  }

  if (!terminalStatus && project.resolvedDates.due.value && today > project.resolvedDates.due.value) {
    timing.push("Overdue");
  }

  if (!terminalStatus && timingStartDate === tomorrow) {
    timing.push("Tomorrow");
  }

  if (!terminalStatus && timingStartDate && timingStartDate > tomorrow) {
    timing.push("Future");
  }

  if (!terminalStatus && !timingStartDate && !project.resolvedDates.due.value) {
    timing.push("Needs Timing");
  }

  return timing;
}

export function taskTimingStatuses(
  task: ProjectTask,
  projectStatus?: string,
): TaskTimingFilterOption[] {
  const timing: TaskTimingFilterOption[] = [];
  const today = relativeLocalIsoDate(0);
  const tomorrow = relativeLocalIsoDate(1);
  const timingStartDate = plannedStartDate(task.resolvedDates);

  if (
    !task.checked &&
    !isTerminalProjectStatus(projectStatus) &&
    timingStartDate &&
    task.resolvedDates.due.value &&
    timingStartDate <= today &&
    today <= task.resolvedDates.due.value
  ) {
    timing.push("Current");
  }

  if (task.resolvedDates.scheduled.value && !task.resolvedDates.start.value && today > task.resolvedDates.scheduled.value) {
    timing.push("Off Schedule");
  }

  if (task.resolvedDates.due.value === today) {
    timing.push("Due");
  }

  if (task.resolvedDates.due.value && today > task.resolvedDates.due.value) {
    timing.push("Overdue");
  }

  if (timingStartDate === tomorrow) {
    timing.push("Tomorrow");
  }

  if (timingStartDate && timingStartDate > tomorrow) {
    timing.push("Future");
  }

  if (!timingStartDate && !task.resolvedDates.due.value) {
    timing.push("Needs Timing");
  }

  return timing;
}
