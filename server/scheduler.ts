import { listEnabledSchedules, markScheduleRun } from "./controlPlane";
import { nodeAction, nodeCommand } from "./nodeAgent";

function matchesField(field: string, value: number) {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      return value >= start && value <= end;
    }
    if (part.startsWith("*/")) return value % Number(part.slice(2)) === 0;
    return Number(part) === value;
  });
}

function matchesCron(expression: string, now: Date) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const values = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];
  return fields.every((field, index) => matchesField(field, values[index]));
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
        if (sameMinute || !matchesCron(schedule.cron, now)) continue;
        if (schedule.action === "command") await nodeCommand(server.identifier, schedule.payload || "");
        else await nodeAction(server.identifier, schedule.action);
        await markScheduleRun(schedule.id);
      }
    } catch (error) {
      console.error("[Scheduler] Tick failed", error);
    }
  };
  void tick();
  setInterval(() => void tick(), 60_000);
}
