"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  Select,
  Spinner,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";

type Provider = {
  key: string;
  label: string;
  model: string;
  base_url: string;
  key_url: string;
};
type Config = {
  provider: string;
  model: string;
  base_url: string;
  key_set: boolean;
  key_hint: string;
  providers: Provider[];
};

type Note = { ok: boolean; text: string } | null;

export function AISettings() {
  // Kept here so the "Saved" / test result survives the form reloading after a save.
  const [message, setMessage] = useState<Note>(null);
  const cfg = useQuery({
    queryKey: ["ai-config"],
    queryFn: () => api<Config>("/ai/config"),
  });
  if (cfg.isLoading || !cfg.data) return <Spinner />;
  return (
    <Form
      key={JSON.stringify(cfg.data)}
      cfg={cfg.data}
      message={message}
      setMessage={setMessage}
    />
  );
}

function Form({
  cfg,
  message,
  setMessage,
}: {
  cfg: Config;
  message: Note;
  setMessage: (n: Note) => void;
}) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState(cfg.provider);
  const preset = cfg.providers.find((p) => p.key === provider)!;
  const [model, setModel] = useState(
    provider === cfg.provider ? cfg.model : preset.model,
  );
  const [baseUrl, setBaseUrl] = useState(
    cfg.provider === "custom" ? cfg.base_url : "",
  );
  const [key, setKey] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api<Config>("/ai/config", {
        method: "PUT",
        json: {
          provider,
          model,
          base_url: baseUrl,
          api_key: key ? key : undefined,
        },
      }),
    onSuccess: () => {
      setMessage({ ok: true, text: "Saved." });
      qc.invalidateQueries({ queryKey: ["ai-config"] });
      qc.invalidateQueries({ queryKey: ["ai-status"] });
    },
    onError: (e) =>
      setMessage({
        ok: false,
        text: e instanceof ApiError ? e.message : "Could not save",
      }),
  });
  const test = useMutation({
    mutationFn: () => api<{ reply: string }>("/ai/test", { method: "POST" }),
    onSuccess: () =>
      setMessage({
        ok: true,
        text: 'It works. Staff with "AI assistant" permission can use it now.',
      }),
    onError: (e) =>
      setMessage({
        ok: false,
        text: e instanceof ApiError ? e.message : "Test failed",
      }),
  });

  return (
    <Panel className="mt-6 p-5">
      <h2 id="ai" className="flex items-center gap-2 font-semibold">
        <Sparkles className="size-4 text-amber-500" aria-hidden /> AI assistant
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        The assistant answers questions about sales, stock, rooms and expenses.
        It sends the AI service only business figures, never guest names or
        contact details. Google Gemini and Groq have free plans; on free plans
        the service may use what is sent to improve its products.
      </p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage(null);
          save.mutate();
        }}
      >
        <Field label="AI service">
          {(id) => (
            <Select
              id={id}
              value={provider}
              onChange={(e) => {
                const p = cfg.providers.find((x) => x.key === e.target.value)!;
                setProvider(p.key);
                setModel(p.key === cfg.provider ? cfg.model : p.model);
              }}
            >
              {cfg.providers.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Model"
          hint={preset.model ? `Usually ${preset.model}` : undefined}
        >
          {(id) => (
            <Input
              id={id}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              required
              maxLength={100}
            />
          )}
        </Field>
        {provider === "custom" && (
          <div className="sm:col-span-2">
            <Field
              label="Service address"
              hint="An OpenAI-compatible address, e.g. http://localhost:11434/v1 for Ollama"
            >
              {(id) => (
                <Input
                  id={id}
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  maxLength={300}
                />
              )}
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field
            label="API key"
            hint={
              cfg.key_set
                ? `A key is saved (${cfg.key_hint}). Leave empty to keep it.`
                : "Paste the key here."
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                maxLength={300}
              />
            )}
          </Field>
          {preset.key_url && (
            <a
              href={preset.key_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-bottle-800 underline underline-offset-4"
            >
              Get a free key <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <Button type="submit" busy={save.isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="secondary"
            busy={test.isPending}
            disabled={!cfg.key_set && provider !== "custom"}
            onClick={() => (setMessage(null), test.mutate())}
          >
            Test it
          </Button>
          {message &&
            (message.ok ? (
              <span className="flex items-center gap-1 text-sm text-ok">
                <CheckCircle2 className="size-4" aria-hidden /> {message.text}
              </span>
            ) : (
              <ErrorText>{message.text}</ErrorText>
            ))}
        </div>
      </form>
    </Panel>
  );
}
