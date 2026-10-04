import * as React from "react";
import {
  ActionBarPrimitive, AssistantRuntimeProvider, AuiIf, ComposerPrimitive,
  MessagePrimitive, ThreadPrimitive, useAui, useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive, ArrowDown, ArrowUp, Check, ChevronRight, Clock3, Copy, FileText,
  Menu, Mic, Paperclip, Pin, PinOff, Plus, Search, Square, X,
} from "lucide-react";
import { Button } from "./ui/button";
import { currentBridge, type AwhChatSnapshot, type AwhTaskView } from "./bridge";
import { useAwhChatRuntime } from "./runtime";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const formatBytes = (value: number) => value < 1024 ** 2
  ? Math.max(1, Math.round(value / 1024)) + " KB"
  : (value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0) + " MB";

function MarkdownText() {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="awh-chat-markdown" />;
}

function TaskCard({ task, approvals = [], artifacts = [] }: {
  task: AwhTaskView; approvals?: any[]; artifacts?: any[];
}) {
  const bridge = currentBridge();
  const pendingApproval = approvals.find((item) => item?.status === "PENDING");
  const active = !TERMINAL.has(task.state);
  const hasDetails = task.journey.length > 0 || task.tools.length > 0;
  return <section className={"awh-task-card " + (task.state === "FAILED" ? "is-failed" : active ? "is-active" : "is-done")}>
    <div className="awh-task-card-head">
      <span className="awh-task-status-dot" aria-hidden="true" />
      <div><strong>{task.title || "AWH"}</strong><small>{task.detail || task.goal}</small></div>
    </div>
    {pendingApproval && <div className="awh-approval-card">
      <div><strong>ต้องยืนยันก่อนทำต่อ</strong><small>{pendingApproval.reason || "AWH รอการยืนยันตามสิทธิ์ของระบบ"}</small></div>
      <div className="awh-approval-actions">
        <Button size="sm" onClick={() => void bridge?.decide(pendingApproval.approvalId, "approve")}>อนุญาตครั้งนี้</Button>
        <Button size="sm" variant="secondary" onClick={() => void bridge?.decide(pendingApproval.approvalId, "reject")}>ไม่อนุญาต</Button>
      </div>
    </div>}
    {artifacts.length > 0 && <div className="awh-artifact-list">
      {artifacts.slice(0, 4).map((artifact) => <button key={artifact.artifactId} type="button"
        onClick={() => bridge?.openArtifact(artifact.artifactId)} className="awh-artifact-card">
        <FileText size={17} /><span><strong>{artifact.name || "ไฟล์ผลลัพธ์"}</strong><small>เปิดใน Artifact Panel</small></span><ChevronRight size={16} />
      </button>)}
    </div>}
    {hasDetails && <details className="awh-task-details">
      <summary>รายละเอียดงาน</summary>
      <div className="awh-task-details-body">
        {task.journey.length > 0 && <ol className="awh-task-steps">
          {task.journey.slice(0, 5).map((step, index) => <li key={index} data-state={step.state}>
            <span>{step.state === "done" || step.state === "complete" ? <Check size={13} /> : step.state === "active" ? "●" : "○"}</span>
            <em>{step.label}</em>
          </li>)}
        </ol>}
        {task.tools.length > 0 && <details className="awh-task-technical">
          <summary>ดูรายละเอียดเครื่องมือ</summary>
          <div>{task.tools.map((tool) => <p key={tool.id}><strong>{tool.label}</strong><span>{tool.reason || tool.id}</span></p>)}</div>
        </details>}
      </div>
    </details>}
  </section>;
}

function UserMessage() {
  const aui = useAui();
  const content = useAuiState((s) => s.message.content);
  const text = content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  return <MessagePrimitive.Root className="awh-message awh-user-message">
    <div className="awh-user-bubble"><MessagePrimitive.Parts /></div>
    <div className="awh-message-actions">
      <ActionBarPrimitive.Root>
        <ActionBarPrimitive.Copy className="awh-message-action" aria-label="คัดลอก"><Copy size={14} /></ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
      <details className="awh-message-more">
        <summary aria-label="ตัวเลือกข้อความ"><Menu size={14} /></summary>
        <div className="awh-message-menu">
          <button type="button" onClick={() => aui.composer.setText(text)}>แก้ไขแล้วส่งใหม่</button>
          <button type="button" onClick={async () => {
            const bridge = currentBridge(); if (!bridge || !text.trim()) return;
            await bridge.newConversation(); await bridge.sendText(text);
          }}>แยกเป็นแชทใหม่</button>
        </div>
      </details>
    </div>
  </MessagePrimitive.Root>;
}

function AssistantMessage() {
  const custom = useAuiState((s) => s.message.metadata.custom as any) || {};
  const task = custom.task as AwhTaskView | null;
  return <MessagePrimitive.Root className="awh-message awh-assistant-message">
    {!custom.taskCardOnly && <div className="awh-assistant-copy">
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
    </div>}
    {task && <TaskCard task={task} approvals={custom.approvals || []} artifacts={custom.artifacts || []} />}
    <div className="awh-message-actions">
      <ActionBarPrimitive.Root>
        <ActionBarPrimitive.Copy className="awh-message-action" aria-label="คัดลอก"><Copy size={14} /></ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
      {task?.state === "FAILED" && task.goal && <button type="button" className="awh-message-action"
        onClick={() => void currentBridge()?.sendText(task.goal)}>ลองใหม่</button>}
    </div>
  </MessagePrimitive.Root>;
}

function EmptyChat({ snapshot }: { snapshot: AwhChatSnapshot }) {
  return <div className="awh-chat-empty">
    <span className="awh-chat-mark" aria-hidden="true">A</span>
    <h2>{snapshot.project ? "ถามหรือสั่ง AWH ได้เลย" : "เลือกโปรเจกต์ก่อนเริ่มคุย"}</h2>
    <p>{snapshot.project ? "คุยเป็นภาษาปกติ AWH จะสรุปสิ่งที่กำลังทำและซ่อนรายละเอียดเทคนิคไว้จนกว่าจะต้องใช้" : "เลือกโปรเจกต์ด้านบนเพื่อให้ AWH ใช้บริบทที่ถูกต้อง"}</p>
    {snapshot.project && <div className="awh-starter-prompts">
      {["ตรวจสถานะโปรเจกต์นี้", "สรุปงานที่ต้องทำต่อ", "ช่วยหาสาเหตุของปัญหาล่าสุด"].map((prompt) =>
        <button key={prompt} type="button" onClick={() => void currentBridge()?.sendText(prompt)}>{prompt}</button>)}
    </div>}
  </div>;
}

function PendingFiles({ snapshot }: { snapshot: AwhChatSnapshot }) {
  if (!snapshot.pendingAttachments.length) return null;
  return <div className="awh-pending-files">
    {snapshot.pendingAttachments.map((file) => <span key={file.index}>
      <FileText size={13} /><em>{file.name}</em><small>{formatBytes(file.size)}</small>
      <button type="button" aria-label={"เอา " + file.name + " ออก"}
        onClick={() => currentBridge()?.removePendingAttachment(file.index)}><X size={13} /></button>
    </span>)}
  </div>;
}

function ComposerAssist({ snapshot }: { snapshot: AwhChatSnapshot }) {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  if (!text.startsWith("/") && !text.startsWith("@")) return null;
  const options = text.startsWith("/")
    ? ["/status ตรวจสถานะ", "/continue ทำงานต่อ", "/files ดูไฟล์"]
    : [snapshot.project?.name, ...snapshot.workers.filter((w) => w.state === "WORKING").map((w) => w.name)].filter(Boolean);
  return <div className="awh-composer-assist">
    {options.slice(0, 5).map((item) => <button key={item} type="button"
      onClick={() => aui.composer.setText(String(item).replace(/^\/(\S+).*/, "/$1 ") + (text.startsWith("@") ? " " : ""))}>{item}</button>)}
  </div>;
}

function DictationSafety() {
  const aui = useAui();
  const active = useAuiState((s) => s.composer.dictation != null);
  React.useEffect(() => {
    if (!active) return;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      void aui.composer.stopDictation();
    };
    const watchdog = window.setTimeout(stop, 12_000);
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, aui]);

  return active
    ? <span className="awh-dictation-state" role="status" aria-live="polite">กำลังฟัง… แตะ ■ เพื่อหยุด</span>
    : null;
}

function ChatComposer({ snapshot }: { snapshot: AwhChatSnapshot }) {
  const addClipboardFiles = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files || []);
    if (files.length) currentBridge()?.addFiles(files);
  };
  return <ThreadPrimitive.ViewportFooter className="awh-composer-footer">
    <ComposerPrimitive.Root className="awh-composer">
      <ComposerAssist snapshot={snapshot} />
      <PendingFiles snapshot={snapshot} />
      <ComposerPrimitive.Input className="awh-composer-input" rows={1}
        submitMode="enter" placeholder={snapshot.ready ? "ถามหรือสั่ง AWH…" : "เลือกโปรเจกต์ก่อน"}
        onPaste={addClipboardFiles} />
      <DictationSafety />
      <ComposerPrimitive.DictationTranscript className="awh-dictation-transcript" />
      <div className="awh-composer-bar">
        <div className="awh-composer-tools">
          <Button type="button" variant="ghost" size="icon" aria-label="แนบไฟล์หรือรูป"
            onClick={() => currentBridge()?.pickFiles()}><Paperclip size={18} /></Button>
          <ComposerPrimitive.Dictate className="awh-icon-action" aria-label="พิมพ์ด้วยเสียง"><Mic size={18} /></ComposerPrimitive.Dictate>
          <ComposerPrimitive.StopDictation className="awh-icon-action" aria-label="หยุดฟังเสียง"><Square size={15} /></ComposerPrimitive.StopDictation>
          <span className="awh-composer-context">{snapshot.project?.name || "AWH"}</span>
        </div>
        <div className="awh-composer-submit">
          {snapshot.running
            ? <ComposerPrimitive.Cancel className="awh-stop-button" aria-label="หยุดงาน"><Square size={15} /></ComposerPrimitive.Cancel>
            : <ComposerPrimitive.Send className="awh-send-button" aria-label="ส่ง"><ArrowUp size={18} /></ComposerPrimitive.Send>}
        </div>
      </div>
    </ComposerPrimitive.Root>
  </ThreadPrimitive.ViewportFooter>;
}

function DraftPersistence({ snapshot }: { snapshot: AwhChatSnapshot }) {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const conversationId = String(snapshot.conversation?.conversationId || "");
  const temporary = snapshot.temporary;
  const hydrated = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (temporary || !conversationId || hydrated.current.has(conversationId)) return;
    const key = "awh.chat.draft.v1:" + conversationId;
    const saved = localStorage.getItem(key);
    if (saved && !aui.composer.getState().text) aui.composer.setText(saved);
    const frame = window.requestAnimationFrame(() => hydrated.current.add(conversationId));
    return () => window.cancelAnimationFrame(frame);
  }, [aui, conversationId, temporary]);
  React.useEffect(() => {
    if (temporary || !conversationId || !hydrated.current.has(conversationId)) return;
    const key = "awh.chat.draft.v1:" + conversationId;
    if (text) localStorage.setItem(key, text); else localStorage.removeItem(key);
  }, [conversationId, temporary, text]);
  return null;
}

function Sidebar({ snapshot, open, onClose }: { snapshot: AwhChatSnapshot; open: boolean; onClose(): void }) {
  const bridge = currentBridge();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<Array<Record<string, any>>>([]);
  const [pinned, setPinned] = React.useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("awh.chat.pinned.v1") || "[]")); } catch { return new Set(); }
  });
  React.useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void bridge?.searchConversations(query).then((items) => { if (active) setResults(items); });
    }, query ? 180 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [bridge, query, snapshot.conversations.length]);
  const togglePin = (id: string) => {
    const next = new Set(pinned); if (next.has(id)) next.delete(id); else next.add(id);
    setPinned(next); localStorage.setItem("awh.chat.pinned.v1", JSON.stringify([...next]));
  };
  const list = (query ? results : snapshot.conversations)
    .slice().sort((a, b) => Number(pinned.has(b.conversationId)) - Number(pinned.has(a.conversationId)));
  const groups = query
    ? [{ label: "ผลการค้นหา", items: list }]
    : [
        { label: "ปักหมุด", items: list.filter((item) => pinned.has(item.conversationId)) },
        { label: "ล่าสุด", items: list.filter((item) => !pinned.has(item.conversationId)) },
      ].filter((group) => group.items.length);
  return <aside className={"awh-chat-sidebar" + (open ? " is-open" : "")}>
    <div className="awh-sidebar-head">
      <strong>AWH</strong>
      <Button variant="ghost" size="icon" className="awh-sidebar-close" onClick={onClose} aria-label="ปิดรายการแชท"><X size={17} /></Button>
    </div>
    <Button className="awh-new-chat" variant="secondary" onClick={() => void bridge?.newConversation()}>
      <Plus size={16} /> แชทใหม่
    </Button>
    <Button className="awh-temp-chat" variant="ghost" onClick={() => void bridge?.newTemporaryConversation()}>
      <Clock3 size={16} /> แชทชั่วคราว
    </Button>
    <label className="awh-chat-search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)}
      placeholder="ค้นหาแชท" aria-label="ค้นหาการสนทนา" /></label>
    <nav className="awh-thread-list" aria-label="รายการสนทนา">
      {groups.map((group) => <section className="awh-thread-group" key={group.label}>
        <h3>{group.label}</h3>
        {group.items.map((item) => <div key={item.conversationId}
          className={"awh-thread-item" + (item.conversationId === snapshot.conversation?.conversationId ? " is-active" : "")}>
          <button type="button" className="awh-thread-open" onClick={() => { void bridge?.switchConversation(item.conversationId); onClose(); }}>
            <strong>{item.title || "การสนทนา"}</strong><small>{new Date(item.updatedAt || Date.now()).toLocaleDateString("th-TH")}</small>
          </button>
          <button type="button" className="awh-thread-pin" aria-label={pinned.has(item.conversationId) ? "เลิกปักหมุด" : "ปักหมุด"}
            onClick={() => togglePin(item.conversationId)}>{pinned.has(item.conversationId) ? <PinOff size={14} /> : <Pin size={14} />}</button>
        </div>)}
      </section>)}
      {!list.length && <p className="awh-thread-empty">{query ? "ไม่พบแชทที่ค้นหา" : "ยังไม่มีการสนทนา"}</p>}
    </nav>
    <button type="button" className="awh-sidebar-manager" onClick={() => bridge?.openConversationManager()}>
      <Archive size={15} /> จัดการแชท / คลัง / ถังขยะ
    </button>
  </aside>;
}

function ChatHeader({ snapshot, onMenu }: { snapshot: AwhChatSnapshot; onMenu(): void }) {
  const liveLabel = snapshot.stream.phase === "SENDING" ? "กำลังส่ง"
    : snapshot.stream.phase === "WAITING_FOR_APPROVAL" ? "รอการยืนยัน"
    : snapshot.stream.phase === "RUNNING" ? "กำลังทำงาน" : null;
  return <header className="awh-chat-header">
    <Button variant="ghost" size="icon" className="awh-menu-button" onClick={onMenu} aria-label="เปิดรายการแชท"><Menu size={18} /></Button>
    <div className="awh-chat-title">
      <strong>{snapshot.temporary ? "แชทชั่วคราว" : snapshot.conversation?.title || "AWH Chat"}</strong>
      <span>{snapshot.temporary ? "ไม่อยู่ในประวัติ และไม่จำ draft หลังออกจากห้องนี้" : snapshot.project?.name || "เลือกโปรเจกต์"}</span>
    </div>
    <div className="awh-context-chips">
      {snapshot.temporary && <span className="awh-temporary-chip"><Clock3 size={12} /> ชั่วคราว</span>}
      {liveLabel && <span className="awh-live-chip"><i aria-hidden="true" />{liveLabel}</span>}
    </div>
  </header>;
}

function ThreadSurface({ snapshot }: { snapshot: AwhChatSnapshot }) {
  return <ThreadPrimitive.Root className="awh-chat-thread">
    <ThreadPrimitive.Viewport className="awh-chat-viewport" autoScroll
      scrollToBottomOnRunStart scrollToBottomOnInitialize scrollToBottomOnThreadSwitch>
      {snapshot.messages.length === 0 && <EmptyChat snapshot={snapshot} />}
      <ThreadPrimitive.Messages>
        {({ message }) => message.role === "user" ? <UserMessage /> : <AssistantMessage />}
      </ThreadPrimitive.Messages>
      {snapshot.stream.phase === "SENDING" && <div className="awh-response-pending" role="status" aria-live="polite">
        <i aria-hidden="true" /><span>AWH กำลังรับคำสั่ง…</span>
      </div>}
      <ThreadPrimitive.ScrollToBottom className="awh-scroll-latest" aria-label="ไปข้อความล่าสุด" behavior="smooth">
        <ArrowDown size={17} />
      </ThreadPrimitive.ScrollToBottom>
      <ChatComposer snapshot={snapshot} />
    </ThreadPrimitive.Viewport>
  </ThreadPrimitive.Root>;
}

export function AwhChatIsland() {
  const { runtime, snapshot } = useAwhChatRuntime();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const drop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!snapshot.ready) return;
    event.preventDefault();
    currentBridge()?.addFiles(Array.from(event.dataTransfer.files || []));
  };
  return <AssistantRuntimeProvider runtime={runtime}>
    <DraftPersistence snapshot={snapshot} />
    <div className="awh-chat-shell" onDragOver={(event) => { if (snapshot.ready) event.preventDefault(); }} onDrop={drop}>
      <Sidebar snapshot={snapshot} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && <button className="awh-sidebar-backdrop" type="button" aria-label="ปิดรายการแชท" onClick={() => setSidebarOpen(false)} />}
      <main className="awh-chat-main">
        <ChatHeader snapshot={snapshot} onMenu={() => setSidebarOpen(true)} />
        <ThreadSurface snapshot={snapshot} />
      </main>
    </div>
  </AssistantRuntimeProvider>;
}
