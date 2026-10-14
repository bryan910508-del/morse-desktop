// B409-2: the server's time inside the storage worker, which has its own thread and so its own Date. Main hands its
// difference with every command (delivery-client.ts), and a message queued here is dated with it, as the window shows it
// and as the server will (server-clock.ts).
let offset = 0
export function setStorageClock(value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 7 * 86400000) offset = Math.round(value)
}
export function storageNow(): number { return Date.now() + offset }
