import * as React from "react";
import { createRoot } from "react-dom/client";
import { AwhChatIsland } from "./thread";
import "./chat.css";

const mount = document.getElementById("awh-chat-root");

function restoreNativeFallback() {
  document.body.classList.remove("awh-modern-chat-ready");
  if (mount) mount.hidden = true;
}

class ChatBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error("AWH Chat presentation failed; using native fallback", error);
    restoreNativeFallback();
  }
  render() { return this.state.failed ? null : this.props.children; }
}

function MountedChat() {
  React.useEffect(() => {
    if (mount) mount.hidden = false;
    document.body.classList.add("awh-modern-chat-ready");
    return restoreNativeFallback;
  }, []);
  return <AwhChatIsland />;
}

if (mount) createRoot(mount).render(<ChatBoundary><MountedChat /></ChatBoundary>);
