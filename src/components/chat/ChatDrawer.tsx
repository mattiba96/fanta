"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ToolCallInfo = { name: string; input: unknown };

const TOOL_LABELS: Record<string, string> = {
  search_players: "Cerco giocatori…",
  get_player_detail: "Guardo la scheda…",
  get_lineup_info: "Guardo la probabile formazione…",
  compare_players: "Confronto i giocatori…",
  list_best_value: "Cerco i migliori affari…",
};

/**
 * Chat AI di consultazione, disponibile su ogni pagina: risponde a domande
 * su giocatori/quotazioni/statistiche/formazioni usando gli stessi dati
 * dell'app. Nessuna scrittura: l'asta si gestisce altrove.
 */
export function ChatDrawer() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingTool, setPendingTool] = useState<ToolCallInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, isStreaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    setError(null);
    const nextHistory: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextHistory, { role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory }),
      });
      if (!res.body) throw new Error("Nessuna risposta dal server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "text") {
            assistantText += event.text;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: assistantText };
              return copy;
            });
            setPendingTool(null);
          } else if (event.type === "tool_call") {
            setPendingTool({ name: event.name, input: event.input });
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStreaming(false);
      setPendingTool(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl text-white shadow-lg hover:bg-brand-hover"
        aria-label="Apri assistente AI"
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-40 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">🐶 Assistente</p>
            {messages.length > 0 && (
              <button
                onClick={() => {
                  setMessages([]);
                  setError(null);
                }}
                className="text-xs text-zinc-400 hover:text-zinc-600"
              >
                nuova chat
              </button>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-sm text-zinc-400">
                Chiedimi consigli, confronti tra giocatori, statistiche o probabili formazioni.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-brand px-3 py-1.5 text-sm text-white"
                    : "mr-auto max-w-[90%] rounded-lg bg-zinc-100 px-3 py-1.5 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                }
              >
                {m.content || (isStreaming && i === messages.length - 1 ? "…" : "")}
              </div>
            ))}
            {pendingTool && (
              <p className="text-xs text-zinc-400">{TOOL_LABELS[pendingTool.name] ?? "Elaboro…"}</p>
            )}

            {error && <p className="text-xs text-red-500">Errore: {error}</p>}
          </div>

          <div className="flex items-center gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Scrivi un messaggio…"
              disabled={isStreaming}
              className="flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={send}
              disabled={isStreaming || !input.trim()}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
            >
              Invia
            </button>
          </div>
        </div>
      )}
    </>
  );
}
