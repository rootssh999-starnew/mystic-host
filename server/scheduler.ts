import { createScheduleRun, finishScheduleRun, listEnabledSchedules, markScheduleRun } from "./controlPlane";
import { nodeAction, nodeCommand } from "./nodeAgent";

function matchesField(field: string, value: number) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("-")) { const [start, end] = part.split("-").map(Number); return value >= start && value <= end; }
    if (part.startsWith("*/")) return value % Number(part.slice(2)) === 0;
    return Number(part) === value;
  });
}
function cronValues(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short", hour12: false }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "0";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [Number(get("minute")), Number(get("hour")) % 24, Number(get("day")), Number(get("month")), weekdays.indexOf(get("weekday"))];
}
function matchesCron(expression: string, now: Date, timezone: string) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => matchesField(field, cronValues(now, timezone)[index]));
}

let running = false;
export function startScheduler() {
  if (running) return;
  running = true;
  const tick = async () => {
    const now = new Date();
    try {
      const rows = await listEnabledSchedules();
      for (const { schedule, server } of rows) {
        const previous = schedule.lastRunAt?.getTime() ?? 0;
        const sameMinute = Math.floor(previous / 60000) === Math.floor(now.getTime() / 60000);
        if (sameMinute || !matchesCron(schedule.cron, now, schedule.timezone)) continue;
        const runId = await createScheduleRun(schedule.id);
        try {
          if (schedule.action === "command") await nodeCommand(server.identifier, schedule.payload || "");
          else await nodeAction(server.identifier, schedule.action);
          await markScheduleRun(schedule.id);
          await finishScheduleRun(runId, "completed");
        } catch (error) {
          await finishScheduleRun(runId, "failed", error instanceof Error ? error.message : "Schedule action failed");
          console.error(`[Scheduler] Schedule ${schedule.id} failed`, error);
        }
      }
    } catch (error) { console.error("[Scheduler] Tick failed", error); }
  };
  void tick();
  setInterval(() => void tick(), 60_000);
}
