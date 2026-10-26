"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Guard } from "@/components/Guard";
import { Button, ErrorText, Panel, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "How much did we sell today?",
  "Compare this week with last week",
  "What are our best sellers this month?",
  "Which items are running low?",
  "How many rooms are occupied?",
  "What did we spend on expenses this month?",
];

export default function AssistantPage() {
  return (
    <Guard anyOf={["ai.use"]}>
      <Assistant />
    </Guard>
  );
}

function Assistant() {
  const { can } = useAuth();
  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api<{ ready: boolean; provider: string }>("/ai/status"),
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: (question: string) =>
      api<{ answer: string }>("/ai/ask", {
        method: "POST",
        json: { question, history: messages.slice(-8) },
      }),
    onSuccess: (r) =>
      setMessages((m) => [...m, { role: "assistant", content: r.answer }]),
    onError: (e, question) => {
      setError(e instanceof ApiError ? e.message : "Couldn't get an answer");
      // Put the question back so it can be sent again.
      setMessages((m) => m.slice(0, -1));
      setText(question);
    },
  });

  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, and an
    // effect may only return a clean-up function.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, ask.isPending]);

  function send(q: string) {
    const question = q.trim();
    if (!question || ask.isPending) return;
    setError("");
    setText("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    ask.mutate(question);
  }

  if (status.isLoading) return <Spinner />;
  if (status.data && !status.data.ready) {
    return (
      <Panel className="mx-auto mt-6 max-w-lg p-6 text-center">
        <Sparkles className="mx-auto mb-3 size-8 text-amber-500" aria-hidden />
        <h1 className="text-lg font-semibold">
          The AI assistant isn&apos;t set up yet
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          It needs a free key from an AI service. It takes about two minutes.
        </p>
        {can("settings.manage") ? (
          <Link
            href="/settings#ai"
            className="mt-4 inline-block font-semibold text-bottle-800 underline underline-offset-4"
          >
            Set it up in Settings
          </Link>
        ) : (
          <p className="mt-3 text-sm">
            Ask the owner to set it up in Settings.
          </p>
        )}
      </Panel>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-3xl flex-col lg:h-[calc(100dvh-4rem)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI assistant</h1>
          <p className="text-sm text-ink-soft">
            Ask about sales, profit, stock, rooms and expenses in plain words.
            It reads the reports; it can&apos;t change anything.
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => (setMessages([]), setError(""))}
          >
            <RotateCcw className="size-4" aria-hidden /> New chat
          </Button>
        )}
      </div>

      <div
        className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Sparkles className="mb-2 size-7 text-amber-500" aria-hidden />
            <p className="mb-4 font-medium">Try asking</p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-amber-500 hover:bg-amber-100/40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={clsx(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={clsx(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "rounded-br-sm bg-bottle-900 text-white"
                    : "rounded-bl-sm bg-ground text-ink",
                )}
              >
                <Formatted text={m.content} />
              </div>
            </div>
          ))
        )}
        {ask.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-ground px-4 py-2.5 text-sm text-ink-soft">
              Looking at the numbers…
            </div>
          </div>
        )}
        <div ref={end} />
      </div>

      <ErrorText>{error}</ErrorText>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <label className="sr-only" htmlFor="ask">
          Your question
        </label>
        <textarea
          id="ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="e.g. Why was profit lower yesterday?"
          className="max-h-32 min-h-12 flex-1 resize-none rounded-xl border border-line bg-surface px-4 py-3 text-sm focus:border-amber-500 focus:outline-none"
        />
        <Button
          type="submit"
          size="lg"
          busy={ask.isPending}
          disabled={!text.trim()}
          aria-label="Ask"
        >
          <ArrowUp className="size-5" aria-hidden />
        </Button>
      </form>
      <p className="mt-1 text-xs text-ink-soft">
        Answers come from your own figures. Guest names and contact details are
        never sent to the AI service.
      </p>
    </div>
  );
}

/** Light formatting for AI answers: **bold** and bullet lines. */
function Formatted({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, "");
        const parts = body
          .split(/(\*\*[^*]+\*\*)/g)
          .map((p, j) =>
            p.startsWith("**") && p.endsWith("**") ? (
              <strong key={j}>{p.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{p.replace(/^#+\s*/, "")}</span>
            ),
          );
        return (
          <span key={i} className={clsx("block", bullet && "pl-4 -indent-3")}>
            {bullet && "• "}
            {parts}
            {!line && " "}
          </span>
        );
      })}
    </>
  );
}
