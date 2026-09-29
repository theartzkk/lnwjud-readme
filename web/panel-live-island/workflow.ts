import { createMachine } from "xstate";

export type WorkflowState =
  | "idle"
  | "validating"
  | "queued"
  | "deploying"
  | "verifying"
  | "rollback"
  | "completed"
  | "failed";

export const operationMachine = createMachine({
  id: "awh-owner-operation",
  initial: "idle",
  states: {
    idle: { on: { START: "validating" } },
    validating: { on: { QUEUED: "queued", COMPLETE: "completed", FAIL: "failed", ROLLBACK: "rollback" } },
    queued: { on: { DEPLOY: "deploying", VERIFY: "verifying", COMPLETE: "completed", FAIL: "failed", ROLLBACK: "rollback" } },
    deploying: { on: { QUEUED: "queued", VERIFY: "verifying", COMPLETE: "completed", FAIL: "failed", ROLLBACK: "rollback" } },
    verifying: { on: { DEPLOY: "deploying", COMPLETE: "completed", FAIL: "failed", ROLLBACK: "rollback" } },
    rollback: { on: { QUEUED: "queued", DEPLOY: "deploying", VERIFY: "verifying", COMPLETE: "completed", FAIL: "failed" } },
    completed: { after: { 5000: "idle" }, on: { START: "validating" } },
    failed: { after: { 8000: "idle" }, on: { START: "validating" } },
  },
});

export function stateEvent(state: unknown): "QUEUED" | "DEPLOY" | "VERIFY" | "COMPLETE" | "FAIL" | null {
  const value = String(state ?? "").toUpperCase();
  if (["QUEUED", "WAITING_FOR_WORKER", "WAITING_FOR_APPROVAL", "WAITING_FOR_CAPABILITY"].includes(value)) return "QUEUED";
  if (["PREPARING", "RUNNING", "DEPLOYING", "WORKING"].includes(value)) return "DEPLOY";
  if (["QA", "VERIFYING", "RECOVERING", "VALIDATING"].includes(value)) return "VERIFY";
  if (value === "COMPLETED") return "COMPLETE";
  if (["FAILED", "CANCELLED"].includes(value)) return "FAIL";
  return null;
}

export const workflowLabels: Record<string, string> = {
  idle: "พร้อมรับคำสั่ง",
  validating: "กำลังตรวจคำสั่ง",
  queued: "เข้าคิวแล้ว",
  deploying: "กำลังดำเนินการ",
  verifying: "กำลังตรวจผล",
  rollback: "กำลังย้อนกลับ",
  completed: "เสร็จเรียบร้อย",
  failed: "ต้องตรวจ",
};
