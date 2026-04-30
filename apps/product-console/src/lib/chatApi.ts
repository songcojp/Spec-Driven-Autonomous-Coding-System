import type { ChatAssistantResponse, ChatMessage, ChatSession } from "../types";

export async function createOrGetChatSession(projectId: string): Promise<ChatSession> {
  const response = await fetch("/chat/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) {
    throw new Error(`/chat/sessions returned ${response.status}`);
  }
  return response.json() as Promise<ChatSession>;
}

export async function sendChatMessage(sessionId: string, content: string): Promise<ChatAssistantResponse> {
  const response = await fetch(`/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    throw new Error(`/chat/sessions/${sessionId}/messages returned ${response.status}`);
  }
  return response.json() as Promise<ChatAssistantResponse>;
}

export async function getChatHistory(sessionId: string, limit = 50): Promise<ChatMessage[]> {
  const response = await fetch(`/chat/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`/chat/sessions/${sessionId}/messages returned ${response.status}`);
  }
  return response.json() as Promise<ChatMessage[]>;
}
