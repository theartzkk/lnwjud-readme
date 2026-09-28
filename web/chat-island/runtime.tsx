import { useCallback, useMemo, useSyncExternalStore } from "react";
import { WebSpeechDictationAdapter, useExternalStoreRuntime } from "@assistant-ui/react";
import { currentBridge, emptySnapshot, snapshotFromBridge, type AwhChatSnapshot } from "./bridge";

function taskForMessage(snapshot: AwhChatSnapshot, message: Record<string, any>) {
  if (message.taskId) return snapshot.tasks.find((task) => task.taskId === message.taskId) ?? null;
  if (message.kind !== "user") return null;
  const body = String(message.body || "").trim();
  return [...snapshot.tasks].reverse().find((task) => task.goal.trim() === body) ?? null;
}

function customFor(snapshot: AwhChatSnapshot, message: Record<string, any>) {
  const task = taskForMessage(snapshot, message);
  return {
    awhKind: String(message.kind || "assistant"),
    task,
    approvals: task ? snapshot.approvals.filter((item) => item.taskId === task.taskId) : [],
    artifacts: task ? snapshot.artifacts.filter((item) => item.taskId === task.taskId) : [],
    attachments: snapshot.attachments.filter((item) => item.messageId === message.messageId),
    rawMessageId: message.messageId || null,
  };
}

function assistantStatus(task: any, kind: string) {
  if (kind === "failure" || task?.state === "FAILED") return { type: "incomplete" as const, reason: "error" as const };
  if (task?.state === "CANCELLED") return { type: "incomplete" as const, reason: "cancelled" as const };
  if (task && !["COMPLETED", "FAILED", "CANCELLED"].includes(task.state)) return { type: "running" as const };
  return { type: "complete" as const, reason: "stop" as const };
}

export function runtimeMessages(snapshot: AwhChatSnapshot) {
  const output: any[] = snapshot.messages
    .filter((message) => message?.kind !== "progress")
    .filter((message) => !(message?.kind === "assistant" &&
      /เครื่องมือที่เหมาะสม|เตรียมบริบทของโปรเจกต์|เก็บคำขอนี้ไว้แล้ว/u.test(String(message?.body || ""))))
    .map((message, index) => {
      const role = message.kind === "user" ? "user" : "assistant";
      const task = taskForMessage(snapshot, message);
      return {
        id: String(message.messageId || "awh-" + index), role,
        content: String(message.body || ""), createdAt: new Date(message.createdAt || Date.now()),
        ...(role === "assistant" ? { status: assistantStatus(task, String(message.kind || "")) } : {}),
        metadata: { custom: customFor(snapshot, message) },
      };
    });

  const active = [...snapshot.tasks].reverse()
    .find((task) => !["COMPLETED", "FAILED", "CANCELLED"].includes(task.state));
  if (active) {
    const visible = output.some((message) =>
      message.metadata?.custom?.task?.taskId === active.taskId && message.role === "assistant");
    if (!visible) output.push({
      id: "awh-live-" + active.taskId, role: "assistant",
      content: active.detail || active.title || "AWH กำลังทำงาน…",
      createdAt: new Date(active.updatedAt || Date.now()),
      status: { type: "running" as const },
      metadata: { custom: {
        awhKind: "progress", task: active,
        approvals: snapshot.approvals.filter((item) => item.taskId === active.taskId),
        artifacts: snapshot.artifacts.filter((item) => item.taskId === active.taskId),
        attachments: [], taskCardOnly: true,
      } },
    });
  }
  return output;
}

function textFromAppend(message: any) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((part: any) => part?.type === "text")
    .map((part: any) => String(part.text || "")).join("\n").trim();
}

export function useAwhChatRuntime() {
  const subscribe = useCallback((notify: () => void) => {
    const bridge = currentBridge();
    if (!bridge) {
      const ready = () => notify();
      window.addEventListener("awh:chat-bridge-ready", ready, { once: true });
      return () => window.removeEventListener("awh:chat-bridge-ready", ready);
    }
    return bridge.subscribe(() => notify());
  }, []);

  const snapshot = useSyncExternalStore(subscribe, snapshotFromBridge, () => emptySnapshot);
  const messages = useMemo(() => runtimeMessages(snapshot), [snapshot]);
  const dictation = useMemo(() => WebSpeechDictationAdapter.isSupported()
    ? new WebSpeechDictationAdapter({ language: "th-TH", continuous: true, interimResults: true })
    : undefined, []);

  const onNew = useCallback(async (message: any) => {
    const text = textFromAppend(message);
    if (!text) return;
    const bridge = currentBridge();
    if (!bridge) return;
    await bridge.sendText(text);
    const title = String(snapshot.conversation?.title || "");
    const conversationId = String(snapshot.conversation?.conversationId || "");
    if (conversationId && /^(Work|การสนทนาใหม่)$/u.test(title)) {
      void bridge.renameConversation(conversationId, text.slice(0, 48));
    }
  }, [snapshot.conversation]);

  const onCancel = useCallback(async () => { await currentBridge()?.cancel(); }, []);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: any) => message,
    isRunning: snapshot.running,
    isDisabled: !snapshot.ready,
    isSendDisabled: snapshot.sending,
    onNew,
    onCancel,
    adapters: { dictation },
    unstable_capabilities: { copy: true },
  } as any);

  return { runtime, snapshot };
}
