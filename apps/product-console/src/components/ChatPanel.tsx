import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { createOrGetChatSession, sendChatMessage, getChatHistory } from "../lib/chatApi";
import type { ChatAssistantResponse, ChatMessage } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatPanelProps = {
  open: boolean;
  onToggle: () => void;
  projectId: string;
  locale?: string;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useChatSession(projectId: string, open: boolean) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ChatAssistantResponse["preview"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);

  // Initialize session when panel opens
  useEffect(() => {
    if (!open) return;
    if (sessionRef.current) return;

    createOrGetChatSession(projectId)
      .then((session) => {
        sessionRef.current = session.id;
        setSessionId(session.id);
        return getChatHistory(session.id, 50);
      })
      .then((history) => {
        setMessages(history);
        // Restore pending confirmation state from last assistant message
        const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.commandStatus === "pending_confirmation") {
          // Session has pending - user needs to confirm or cancel
          setPendingConfirmation(null); // We'll show the last message text which says to confirm/cancel
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to connect to chat service.");
      });
  }, [open, projectId]);

  // Reset when projectId changes
  useEffect(() => {
    sessionRef.current = null;
    setSessionId(null);
    setMessages([]);
    setPendingConfirmation(null);
    setError(null);
  }, [projectId]);

  async function sendMessage(text: string) {
    const sid = sessionRef.current;
    if (!sid || !text.trim() || isLoading) return;

    // Optimistically add user message
    const optimisticUserMsg: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      sessionId: sid,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendChatMessage(sid, text);

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: response.messageId,
        sessionId: sid,
        role: "assistant",
        content: response.text,
        intentType: response.intent,
        commandAction: response.preview?.action ?? response.receipt?.action,
        commandStatus: response.state,
        commandReceiptJson: response.receipt ? JSON.stringify(response.receipt) : undefined,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (response.state === "pending_confirmation" && response.preview) {
        setPendingConfirmation(response.preview);
      } else {
        setPendingConfirmation(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      // Remove optimistic user message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmCommand() {
    await sendMessage("确认");
  }

  async function cancelCommand() {
    await sendMessage("取消");
    setPendingConfirmation(null);
  }

  return {
    sessionId,
    messages,
    isLoading,
    pendingConfirmation,
    error,
    sendMessage,
    confirmCommand,
    cancelCommand,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatPanel({ open, onToggle, projectId, locale = "zh-CN" }: ChatPanelProps) {
  const {
    messages,
    isLoading,
    pendingConfirmation,
    error,
    sendMessage,
    confirmCommand,
    cancelCommand,
  } = useChatSession(projectId, open);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isChinese = locale === "zh-CN";
  const labels = {
    title: isChinese ? "SpecDrive 助手" : "SpecDrive Assistant",
    placeholder: isChinese ? "输入您的问题或指令..." : "Type your question or command...",
    confirm: isChinese ? "确认执行" : "Confirm",
    cancel: isChinese ? "取消" : "Cancel",
    confirmLabel: isChinese ? "确认操作" : "Confirm action",
    confirmHint: isChinese
      ? "以下操作需要您确认后才能执行："
      : "The following action requires your confirmation:",
    errorPrefix: isChinese ? "错误：" : "Error: ",
    open: isChinese ? "打开 AI 助手" : "Open AI Assistant",
    close: isChinese ? "关闭" : "Close",
  };

  // Auto-scroll to latest message
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  function handleSend() {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  function getMessageReceiptFromJson(json: string | undefined) {
    if (!json) return null;
    try {
      return JSON.parse(json) as { action: string; status: string; runId?: string; schedulerJobId?: string; blockedReasons?: string[] };
    } catch {
      return null;
    }
  }

  return (
    <>
      {/* Toggle button */}
      <button
        className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-action text-white shadow-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        aria-label={labels.open}
        title={labels.open}
        onClick={onToggle}
      >
        {open ? <X size={20} /> : <MessageCircle size={20} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 flex w-96 flex-col overflow-hidden rounded-xl border border-line bg-white shadow-panel max-md:bottom-16 max-md:left-2 max-md:right-2 max-md:w-auto" style={{ height: "560px" }}>
          {/* Header */}
          <div className="flex h-12 items-center justify-between border-b border-line bg-slate-50 px-4">
            <div className="flex items-center gap-2">
              <MessageCircle size={16} className="text-action" />
              <span className="text-[14px] font-semibold text-ink">{labels.title}</span>
            </div>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-slate-200 hover:text-ink"
              aria-label={labels.close}
              onClick={onToggle}
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 p-4 text-[13px]">
            {messages.length === 0 && !isLoading && (
              <div className="flex items-center justify-center h-full text-muted text-[12px]">
                {isChinese ? "发送消息开始对话" : "Send a message to get started"}
              </div>
            )}

            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const receipt = msg.role === "assistant" ? getMessageReceiptFromJson(msg.commandReceiptJson) : null;
              const isExecuted = msg.commandStatus === "executed";
              const isPending = msg.commandStatus === "pending_confirmation";

              return (
                <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed ${
                      isUser
                        ? "bg-action text-white"
                        : isPending
                          ? "border border-yellow-300 bg-yellow-50 text-ink"
                          : isExecuted && receipt?.status === "accepted"
                            ? "border border-emerald-300 bg-emerald-50 text-ink"
                            : isExecuted && receipt?.status === "blocked"
                              ? "border border-red-200 bg-red-50 text-ink"
                              : "bg-slate-100 text-ink"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                    {/* Receipt display */}
                    {isExecuted && receipt && (
                      <div className="mt-2 border-t border-current border-opacity-20 pt-2 text-[11px] opacity-80">
                        {receipt.status === "accepted" ? (
                          <span className="flex items-center gap-1">
                            <CheckCircle size={11} className="text-emerald-600" />
                            {receipt.runId ? `Run: ${receipt.runId.slice(0, 8)}...` : receipt.schedulerJobId ? `Job: ${receipt.schedulerJobId.slice(0, 8)}...` : receipt.action}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <XCircle size={11} className="text-red-500" />
                            {receipt.blockedReasons?.[0] ?? "Blocked"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2">
                  <Loader2 size={13} className="animate-spin text-muted" />
                  <span className="text-[12px] text-muted">{isChinese ? "思考中..." : "Thinking..."}</span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {labels.errorPrefix}{error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Pending confirmation actions */}
          {pendingConfirmation && (
            <div className="border-t border-yellow-200 bg-yellow-50 px-4 py-3">
              <p className="mb-2 text-[12px] font-medium text-amber-800">{labels.confirmHint}</p>
              <div className="mb-3 rounded-md border border-yellow-300 bg-white px-3 py-2 text-[11px] font-mono text-ink break-all">
                <span className="font-semibold text-action">{pendingConfirmation.action}</span>
                {" → "}
                <span>{pendingConfirmation.entityType}/{pendingConfirmation.entityId}</span>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  onClick={confirmCommand}
                  disabled={isLoading}
                  aria-label={labels.confirmLabel}
                >
                  {isLoading ? <Loader2 size={13} className="mx-auto animate-spin" /> : labels.confirm}
                </button>
                <button
                  className="flex-1 rounded-md border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-slate-50 disabled:opacity-50"
                  onClick={cancelCommand}
                  disabled={isLoading}
                >
                  {labels.cancel}
                </button>
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-line px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                className="flex-1 rounded-md border border-line bg-white px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-action focus:outline-none focus:ring-1 focus:ring-action"
                type="text"
                placeholder={labels.placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                aria-label={labels.placeholder}
              />
              <button
                className="flex h-9 w-9 items-center justify-center rounded-md bg-action text-white hover:bg-blue-700 disabled:opacity-40"
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                aria-label={isChinese ? "发送" : "Send"}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
