export type NodeCapacityInput = {
  memoryMb: number;
  diskMb: number;
  memoryOverallocate: number;
  diskOverallocate: number;
};

export type ServerReservation = { memoryMb: number; diskMb: number };

export function capacityLimit(base: number, overallocate: number) {
  return Math.floor(base * (1 + Math.max(0, overallocate) / 100));
}

export function capacityUsage(node: NodeCapacityInput, reservations: ServerReservation[]) {
  const memoryUsedMb = reservations.reduce((total, item) => total + item.memoryMb, 0);
  const diskUsedMb = reservations.reduce((total, item) => total + item.diskMb, 0);
  return {
    memoryUsedMb,
    diskUsedMb,
    memoryLimitMb: capacityLimit(node.memoryMb, node.memoryOverallocate),
    diskLimitMb: capacityLimit(node.diskMb, node.diskOverallocate),
  };
}

export function assertCapacityAvailable(node: NodeCapacityInput, reservations: ServerReservation[], requested: ServerReservation) {
  const usage = capacityUsage(node, reservations);
  if (usage.memoryUsedMb + requested.memoryMb > usage.memoryLimitMb) throw new Error("Node memory capacity exceeded");
  if (usage.diskUsedMb + requested.diskMb > usage.diskLimitMb) throw new Error("Node disk capacity exceeded");
  return { ...usage, memoryUsedMb: usage.memoryUsedMb + requested.memoryMb, diskUsedMb: usage.diskUsedMb + requested.diskMb };
}

export function allocationKey(ip: string, port: number) {
  return `${ip.trim().toLowerCase()}:${port}`;
}
