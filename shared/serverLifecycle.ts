export const SERVER_STATUSES = ["installing", "offline", "running", "stopping", "failed"] as const;

export type ServerStatus = (typeof SERVER_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<ServerStatus, readonly ServerStatus[]> = {
  installing: ["offline", "failed"],
  offline: ["installing", "running"],
  running: ["stopping", "offline", "failed"],
  stopping: ["running", "offline", "failed"],
  failed: ["installing", "offline"],
};

export function canTransitionServerStatus(from: ServerStatus, to: ServerStatus) {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertServerStatusTransition(from: ServerStatus, to: ServerStatus) {
  if (!canTransitionServerStatus(from, to)) {
    throw new Error(`Invalid server status transition: ${from} -> ${to}`);
  }
}
