import * as React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { Toaster, toast } from "sonner";
import { Activity, ChevronRight, Clock3, Command as CommandIcon, Globe2, Laptop, RefreshCw, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { operationMachine, stateEvent, workflowLabels } from "./workflow";
import "./styles.css";

// Existing AWH adapter remains the only API/control authority.
// @ts-ignore legacy browser adapter is intentionally plain JavaScript.
import { cancelTask, decideApproval, listManagedSites, loadControlData, loadCoreReleaseStatus, managedSiteAction, requestCoreRelease, revokeDevice } from "../control-plane-adapter.js";

type OwnerAction = {
  kind: "core-release" | "cancel-task" | "approval" | "site" | "device";
  label: string;
  queue: string;
  taskId?: string;
  approvalId?: string;
  decision?: "approve" | "reject";
  siteId?: string;
  siteAction?: "deploy" | "rollback" | "disable";
  deviceId?: string;
  releaseSha?: string;
  confirmText?: string;
};
type TrackedOperation = { taskId: string; label: string; queue: string; startedAt: number };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1500, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

const terminalStates = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const short = (value: unknown) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 9) : "—";
const compactId = (value: unknown) => typeof value === "string" ? value.slice(0, 8) : "—";
const taskLabel = (state: unknown) => ({
  QUEUED: "อยู่ในคิว",
  WAITING_FOR_WORKER: "รอ executor",
  WAITING_FOR_APPROVAL: "รออนุมัติ",
  WAITING_FOR_CAPABILITY: "รอ capability",
  PREPARING: "กำลังเตรียม",
  RUNNING: "กำลังทำ",
  VERIFYING: "กำลังตรวจผล",
  QA: "กำลัง QA",
  RECOVERING: "กำลังกู้ต่อ",
  COMPLETED: "เสร็จแล้ว",
  FAILED: "ล้มเหลว",
  CANCELLED: "ยกเลิกแล้ว",
} as Record<string, string>)[String(state ?? "").toUpperCase()] ?? String(state ?? "—");
const queueLabel = (capability: unknown) => ({
  "system.core.release": "คิวปล่อยรุ่น AWH",
  "hosting.site.deploy": "คิวเว็บไซต์ · Deploy",
  "hosting.site.rollback": "คิวเว็บไซต์ · Rollback",
  "hosting.site.disable": "คิวเว็บไซต์ · Disable",
  "qa.cloud": "คิว Cloud QA",
  "review.visual": "คิว Visual Review",
} as Record<string, string>)[String(capability ?? "")] ?? (capability ? "คิว " + String(capability) : "คิว AWH");

function liveInterval(query: any): number {
  const tasks = Array.isArray(query?.state?.data?.tasks) ? query.state.data.tasks : [];
  return tasks.some((task: any) => !terminalStates.has(String(task?.state ?? ""))) ? 2000 : 8000;
}

function StatusPill({ state }: { state: unknown }) {
  const value = String(state ?? "UNKNOWN").toUpperCase();
  const good = ["READY", "ACTIVE", "ONLINE", "COMPLETED", "APPROVED"].includes(value);
  const bad = ["FAILED", "ERROR", "OFFLINE", "REJECTED", "CANCELLED"].includes(value);
  return <span className={"awh-live-pill " + (good ? "good" : bad ? "bad" : "warn")}>{taskLabel(value)}</span>;
}

function ActionButton({ children, tone = "", disabled, onClick }: React.PropsWithChildren<{ tone?: string; disabled?: boolean; onClick: () => void }>) {
  return <button type="button" className={"awh-live-action " + tone} disabled={disabled} onClick={onClick}>{children}</button>;
}
function WorkflowRail({ state, tracked, task }: { state: string; tracked: TrackedOperation | null; task: any }) {
  const steps = state === "rollback"
    ? ["validating", "queued", "rollback", "verifying", "completed"]
    : ["validating", "queued", "deploying", "verifying", "completed"];
  const activeIndex = Math.max(0, steps.indexOf(state));
  if (state === "idle" && !tracked) return null;
  return (
    <motion.section className={"awh-live-progress " + (state === "failed" ? "is-failed" : "")}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <div className="awh-live-progress-head">
        <span className="awh-live-pulse"><Activity size={16} /></span>
        <div><strong>{tracked?.label ?? "กำลังดำเนินการ"}</strong><small>{tracked?.queue ?? "AWH Control Plane"}</small></div>
        <b>{workflowLabels[state] ?? state}</b>
      </div>
      <div className="awh-live-steps">
        {steps.map((step, index) => <span key={step} className={index <= activeIndex ? "is-done" : ""}><i />{workflowLabels[step]}</span>)}
      </div>
      {task && <div className="awh-live-proof">
        <span>Task {compactId(task.taskId)}</span><span>{taskLabel(task.state)}</span>
        <span>{Number.isFinite(Number(task.progress)) ? Math.round(Number(task.progress)) + "%" : "กำลังยืนยันสถานะ"}</span>
        {task.lastEvent?.message && <span>{task.lastEvent.message}</span>}
      </div>}
    </motion.section>
  );
}
function LiveControlApp() {
  const qc = useQueryClient();
  const [workflow, send] = useMachine(operationMachine);
  const workflowState = String(workflow.value);
  const [tracked, setTracked] = React.useState<TrackedOperation | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const toastId = React.useRef<string | number | null>(null);

  const control = useQuery<any>({ queryKey: ["awh", "control-live"], queryFn: loadControlData, refetchInterval: liveInterval });
  const sites = useQuery<any>({ queryKey: ["awh", "managed-sites"], queryFn: listManagedSites, refetchInterval: 8000 });
  const releases = useQuery<any>({ queryKey: ["awh", "core-release"], queryFn: loadCoreReleaseStatus, refetchInterval: 4000 });

  const refreshAll = React.useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["awh", "control-live"] }),
      qc.invalidateQueries({ queryKey: ["awh", "managed-sites"] }),
      qc.invalidateQueries({ queryKey: ["awh", "core-release"] }),
    ]);
    toast.success("อัปเดตสถานะล่าสุดแล้ว");
  }, [qc]);

  const mutation = useMutation({
    mutationFn: async (action: OwnerAction) => {
      if (action.kind === "core-release") return requestCoreRelease(action.releaseSha, false);
      if (action.kind === "cancel-task") return cancelTask(action.taskId);
      if (action.kind === "approval") return decideApproval(action.approvalId, action.decision);
      if (action.kind === "site") return managedSiteAction(action.siteId, action.siteAction);
      if (action.kind === "device") return revokeDevice(action.deviceId);
      throw new Error("คำสั่งนี้ยังไม่รองรับ");
    },
    onMutate: (action) => {
      send({ type: "START" } as any);
      toastId.current = toast.loading("กำลังตรวจคำสั่ง…", { description: action.label });
    },
    onSuccess: (result: any, action) => {
      const taskId = typeof result?.taskId === "string" ? result.taskId : null;
      if (action.siteAction === "rollback") send({ type: "ROLLBACK" } as any);
      else if (taskId) send({ type: "QUEUED" } as any);
      else send({ type: "COMPLETE" } as any);
      if (taskId) {
        setTracked({ taskId, label: action.label, queue: action.queue, startedAt: Date.now() });
        toast.message("รับคำสั่งแล้ว · เข้าคิว", { id: toastId.current ?? undefined, description: action.queue, duration: Infinity });
      } else {
        toast.success("ดำเนินการสำเร็จ", { id: toastId.current ?? undefined, description: action.label });
      }
    },
    onError: (error: any, action) => {
      send({ type: "FAIL" } as any);
      toast.error("ดำเนินการไม่สำเร็จ", { id: toastId.current ?? undefined, description: error?.message ?? action.label });
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["awh", "control-live"] }),
        qc.invalidateQueries({ queryKey: ["awh", "managed-sites"] }),
        qc.invalidateQueries({ queryKey: ["awh", "core-release"] }),
      ]);
    },
  });
  const runAction = React.useCallback((action: OwnerAction) => {
    if (action.confirmText && !window.confirm(action.confirmText)) return;
    mutation.mutate(action);
    setPaletteOpen(false);
  }, [mutation]);

  const tasks = Array.isArray(control.data?.tasks) ? control.data.tasks : [];
  const approvals = Array.isArray(control.data?.approvals) ? control.data.approvals.filter((item: any) => item?.status === "PENDING") : [];
  const workers = Array.isArray(control.data?.workers) ? control.data.workers : [];
  const managedSites = Array.isArray(sites.data?.sites) ? sites.data.sites : [];
  const activeTasks = tasks.filter((task: any) => !terminalStates.has(String(task?.state ?? ""))).slice(0, 10);
  const trackedTask = tracked ? tasks.find((task: any) => task?.taskId === tracked.taskId) ?? null : null;

  React.useEffect(() => {
    if (!tracked || !trackedTask) return;
    const event = stateEvent(trackedTask.state);
    if (!event) return;
    send({ type: event } as any);
    if (event === "COMPLETE") {
      toast.success("งานเสร็จและยืนยันผลแล้ว", { id: toastId.current ?? undefined, description: tracked.label });
      setTracked(null);
    } else if (event === "FAIL") {
      toast.error("งานจบด้วยสถานะที่ต้องตรวจ", { id: toastId.current ?? undefined, description: trackedTask.resultSummary ?? tracked.label });
      setTracked(null);
    }
  }, [tracked, trackedTask?.state, trackedTask?.progress, send]);

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const sourceSha = releases.data?.sourcePromotion?.sha;
  const runtimeSha = releases.data?.runtimeProductionSha;
  const activeRelease = Array.isArray(releases.data?.releases)
    ? releases.data.releases.find((item: any) => !terminalStates.has(String(item?.taskState ?? "")))
    : null;
  const releaseReady = Boolean(sourceSha && sourceSha !== runtimeSha && releases.data?.releaseDetailsReady !== false && !activeRelease);

  const commandActions: Array<{ value: string; label: string; meta: string; run: () => void }> = [
    { value: "refresh status ตรวจสถานะ", label: "รีเฟรชสถานะทั้งหมด", meta: "Control Plane", run: () => void refreshAll() },
    { value: "updates release อัปเดต", label: "เปิด Update Center", meta: "Navigation", run: () => { location.assign("./updates.html"); } },
    { value: "devices agent อุปกรณ์", label: "ไปที่อุปกรณ์", meta: "Navigation", run: () => { location.hash = "#awh-agent"; } },
    { value: "users access ผู้ใช้", label: "ไปที่ผู้ใช้และสิทธิ์", meta: "Navigation", run: () => { location.hash = "#users"; } },
    { value: "hosting sites เว็บไซต์", label: "เปิดเว็บไซต์และ Hosting", meta: "Navigation", run: () => { location.assign("./hosting.html"); } },
    { value: "diagnostics health ระบบ", label: "เปิด Diagnostics", meta: "Diagnostics", run: () => {
      const details = document.getElementById("cp-technical-details") as HTMLDetailsElement | null;
      if (details) details.open = true;
      location.hash = "#system-health";
    } },
  ];
  if (releaseReady) commandActions.unshift({
    value: "update awh production release อัปเดต AWH",
    label: "อัปเดต AWH → " + short(sourceSha),
    meta: "Production Release",
    run: () => runAction({ kind: "core-release", label: "อัปเดต AWH เป็น " + short(sourceSha), queue: "คิวปล่อยรุ่น AWH", releaseSha: sourceSha,
      confirmText: "อัปเดต AWH Production เป็น " + short(sourceSha) + " ใช่หรือไม่?" }),
  });
  const loading = control.isPending || sites.isPending || releases.isPending;
  const queryError = control.error || sites.error || releases.error;

  return <>
    <Toaster position="top-right" richColors closeButton />
    <div className="awh-live-toolbar">
      <div><span>LIVE CONTROL</span><strong>สั่งงาน → เห็นคิว → ติดตาม → ตรวจผล</strong>
        <small>{loading ? "กำลังเชื่อม Control Plane…" : queryError ? "บางสถานะยังโหลดไม่ครบ" : "ข้อมูลสด · " + activeTasks.length + " งานกำลังทำ"}</small></div>
      <div className="awh-live-toolbar-actions">
        <button type="button" onClick={() => setPaletteOpen(true)}><CommandIcon size={15} /> ค้นหาและสั่งงาน <kbd>⌘K</kbd></button>
        <button type="button" onClick={() => void refreshAll()} disabled={control.isFetching || sites.isFetching || releases.isFetching}>
          <RefreshCw size={15} className={control.isFetching ? "is-spinning" : ""} /> รีเฟรช
        </button>
      </div>
    </div>

    <AnimatePresence mode="wait"><WorkflowRail key={workflowState + (tracked?.taskId ?? "")} state={workflowState} tracked={tracked} task={trackedTask} /></AnimatePresence>

    <section className="awh-live-release">
      <div className="awh-live-release-icon"><Server size={20} /></div>
      <div className="awh-live-release-copy"><small>AWH PRODUCTION</small>
        <strong>{activeRelease ? "กำลังอัปเดต " + Math.round(Number(activeRelease.progress ?? 0)) + "%" : releaseReady ? "มีรุ่นพร้อม " + short(sourceSha) : sourceSha === runtimeSha ? "เป็นรุ่นล่าสุด" : "กำลังตรวจ release"}</strong>
        <span>Production {short(runtimeSha)} · Canonical {short(sourceSha)}</span>
      </div>
      {releaseReady && <ActionButton disabled={mutation.isPending} onClick={() => runAction({
        kind: "core-release", label: "อัปเดต AWH เป็น " + short(sourceSha), queue: "คิวปล่อยรุ่น AWH", releaseSha: sourceSha,
        confirmText: "อัปเดต AWH Production เป็น " + short(sourceSha) + " ใช่หรือไม่?"
      })}>อัปเดต AWH <ChevronRight size={14} /></ActionButton>}
      {activeRelease && <StatusPill state={activeRelease.taskState} />}
    </section>
    <div className="awh-live-grid">
      <motion.article className="awh-live-panel" layout>
        <header><span><Clock3 size={16} />งานและคิว</span><b>{activeTasks.length}</b></header>
        <div className="awh-live-list">
          {activeTasks.length === 0 && <div className="awh-live-empty">ไม่มีงานค้าง ระบบพร้อมรับคำสั่งใหม่</div>}
          {activeTasks.map((task: any) => <motion.div className="awh-live-row" key={task.taskId} layout>
            <div><strong>{task.goal || "งาน AWH"}</strong><small>{queueLabel(task.execution?.requiredCapability)} · Task {compactId(task.taskId)}</small></div>
            <StatusPill state={task.state} />
            {task.canCancel === true && <ActionButton tone="warn" disabled={mutation.isPending} onClick={() => runAction({
              kind: "cancel-task", label: "ยกเลิก " + (task.goal || "งาน AWH"), queue: queueLabel(task.execution?.requiredCapability),
              taskId: task.taskId, confirmText: "ยกเลิกงาน “" + (task.goal || "งานนี้") + "” ใช่หรือไม่?"
            })}>ยกเลิก</ActionButton>}
          </motion.div>)}
        </div>
      </motion.article>

      <motion.article className="awh-live-panel" layout>
        <header><span><ShieldCheck size={16} />รอการตัดสินใจ</span><b>{approvals.length}</b></header>
        <div className="awh-live-list">
          {approvals.length === 0 && <div className="awh-live-empty">ไม่มีรายการรออนุมัติ</div>}
          {approvals.slice(0, 8).map((approval: any) => {
            const task = tasks.find((item: any) => item.taskId === approval.taskId);
            return <motion.div className="awh-live-row" key={approval.approvalId} layout>
              <div><strong>{task?.goal || "การดำเนินการของ AWH"}</strong><small>Approval {compactId(approval.approvalId)}</small></div>
              <div className="awh-live-row-actions">
                <ActionButton disabled={mutation.isPending} onClick={() => runAction({ kind: "approval", label: "อนุมัติการดำเนินการ", queue: "Approval Queue", approvalId: approval.approvalId, decision: "approve", confirmText: "อนุมัติรายการนี้ใช่หรือไม่?" })}>อนุมัติ</ActionButton>
                <ActionButton tone="danger" disabled={mutation.isPending} onClick={() => runAction({ kind: "approval", label: "ไม่อนุมัติการดำเนินการ", queue: "Approval Queue", approvalId: approval.approvalId, decision: "reject", confirmText: "ปฏิเสธรายการนี้ใช่หรือไม่?" })}>ไม่อนุมัติ</ActionButton>
              </div>
            </motion.div>;
          })}
        </div>
      </motion.article>
      <motion.article className="awh-live-panel" layout>
        <header><span><Globe2 size={16} />เว็บไซต์</span><b>{managedSites.length}</b></header>
        <div className="awh-live-list">
          {managedSites.length === 0 && <div className="awh-live-empty">ยังไม่มี Managed Site</div>}
          {managedSites.slice(0, 8).map((site: any) => <motion.div className="awh-live-row" key={site.siteId} layout>
            <div><strong>{site.name || site.slug}</strong><small>{site.url || site.domainHost || "Managed Hosting"}{site.taskState ? " · " + taskLabel(site.taskState) : ""}</small></div>
            <StatusPill state={site.state} />
            <div className="awh-live-row-actions">
              <ActionButton disabled={mutation.isPending || Boolean(site.taskId)} onClick={() => runAction({
                kind: "site", label: "Deploy " + (site.name || site.slug), queue: "คิวเว็บไซต์ · Deploy", siteId: site.siteId, siteAction: "deploy",
                confirmText: "Deploy “" + (site.name || site.slug) + "” ตอนนี้ใช่หรือไม่?"
              })}>Deploy</ActionButton>
              {site.rollbackReleaseId && <ActionButton tone="warn" disabled={mutation.isPending || Boolean(site.taskId)} onClick={() => runAction({
                kind: "site", label: "Rollback " + (site.name || site.slug), queue: "คิวเว็บไซต์ · Rollback", siteId: site.siteId, siteAction: "rollback",
                confirmText: "Rollback “" + (site.name || site.slug) + "” ไปยังรุ่นก่อนหน้าใช่หรือไม่?"
              })}><RotateCcw size={13} />Rollback</ActionButton>}
              {site.state !== "DISABLED" && <ActionButton tone="danger" disabled={mutation.isPending || Boolean(site.taskId)} onClick={() => runAction({
                kind: "site", label: "ปิด " + (site.name || site.slug), queue: "คิวเว็บไซต์ · Disable", siteId: site.siteId, siteAction: "disable",
                confirmText: "ปิดเว็บไซต์ “" + (site.name || site.slug) + "” ใช่หรือไม่?"
              })}>ปิด</ActionButton>}
            </div>
          </motion.div>)}
        </div>
      </motion.article>
      <motion.article className="awh-live-panel" layout>
        <header><span><Laptop size={16} />อุปกรณ์ AWH</span><b>{workers.length}</b></header>
        <div className="awh-live-list">
          {workers.length === 0 && <div className="awh-live-empty">ยังไม่มีอุปกรณ์ที่เชื่อมกับ AWH</div>}
          {workers.slice(0, 10).map((worker: any) => <motion.div className="awh-live-row" key={worker.deviceId} layout>
            <div><strong>{worker.displayName || "AWH Agent"}</strong><small>{worker.platform || "device"} · {worker.appVersion ? "Agent " + worker.appVersion : "version —"}</small></div>
            <StatusPill state={worker.state} />
            {worker.state !== "WORKING" && <ActionButton tone="danger" disabled={mutation.isPending} onClick={() => runAction({
              kind: "device", label: "ยกเลิกการเชื่อมต่อ " + (worker.displayName || "อุปกรณ์"), queue: "Device Authority", deviceId: worker.deviceId,
              confirmText: "ยกเลิกการเชื่อมต่อ “" + (worker.displayName || "อุปกรณ์นี้") + "” ใช่หรือไม่?"
            })}>ยกเลิกการเชื่อมต่อ</ActionButton>}
          </motion.div>)}
        </div>
      </motion.article>
    </div>

    <Command.Dialog open={paletteOpen} onOpenChange={setPaletteOpen} label="AWH Command Palette">
      <div className="awh-command-shell">
        <div className="awh-command-input-wrap"><CommandIcon size={18} /><Command.Input placeholder="ค้นหา command, ระบบ หรือ action…" autoFocus /></div>
        <Command.List><Command.Empty>ไม่พบคำสั่ง</Command.Empty>
          <Command.Group heading="คำสั่งและทางลัด">
            {commandActions.map((item) => <Command.Item key={item.value} value={item.value} onSelect={item.run}><span>{item.label}</span><small>{item.meta}</small></Command.Item>)}
          </Command.Group>
          {activeTasks.some((task: any) => task.canCancel === true) && <Command.Group heading="งานที่ยกเลิกได้">
            {activeTasks.filter((task: any) => task.canCancel === true).map((task: any) => <Command.Item key={task.taskId}
              value={"cancel " + task.goal + " " + task.taskId} onSelect={() => runAction({
                kind: "cancel-task", label: "ยกเลิก " + (task.goal || "งาน AWH"), queue: queueLabel(task.execution?.requiredCapability),
                taskId: task.taskId, confirmText: "ยกเลิกงาน “" + (task.goal || "งานนี้") + "” ใช่หรือไม่?"
              })}>
              <span>ยกเลิก · {task.goal || "งาน AWH"}</span><small>{queueLabel(task.execution?.requiredCapability)}</small>
            </Command.Item>)}
          </Command.Group>}
        </Command.List>
        <footer><span>↑↓ เลือก</span><span>Enter เปิด</span><span>Esc ปิด</span></footer>
      </div>
    </Command.Dialog>
  </>;
}

const root = document.getElementById("cp-live-react-root");
if (root) {
  document.documentElement.classList.add("panel-live-ready");
  createRoot(root).render(<QueryClientProvider client={queryClient}><LiveControlApp /></QueryClientProvider>);
}
