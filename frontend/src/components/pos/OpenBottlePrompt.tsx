"use client";

import { Wine } from "lucide-react";
import { useCallback, useState } from "react";

import { Button, Modal } from "@/components/ui";
import { ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";

const QUESTION = "Open a new bottle?";

type Ask = { message: string; answer: (yes: boolean) => void };

/** When a peg needs more than the open bottle has, asks before opening a new one. */
export function useBottlePrompt() {
  const [asking, setAsking] = useState<Ask | null>(null);
  const [opening, setOpening] = useState(false);

  const withBottle = useCallback(
    async (send: (openBottle: boolean) => Promise<Order>): Promise<Order> => {
      try {
        return await send(false);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409 && e.message.endsWith(QUESTION))) throw e;
        const message = e.message.slice(0, -QUESTION.length).trim();
        const yes = await new Promise<boolean>((answer) => setAsking({ message, answer }));
        if (!yes) return undefined as unknown as Order;
        setOpening(true);
        try {
          return await send(true);
        } finally {
          setOpening(false);
          setAsking(null);
        }
      }
    },
    [],
  );

  const close = (yes: boolean) => {
    asking?.answer(yes);
    if (!yes) setAsking(null);
  };

  const prompt = (
    <Modal open={asking !== null} title="Open a new bottle?" onClose={() => close(false)}>
      <div className="flex gap-4">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600">
          <Wine className="size-6" aria-hidden />
        </span>
        <div>
          <p className="font-medium">{asking?.message}</p>
          <p className="mt-1 text-sm text-ink-soft">
            A sealed bottle will be opened for this peg. Only say yes when you really open one at the bar.
          </p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => close(false)} disabled={opening}>
          Not now
        </Button>
        <Button onClick={() => close(true)} busy={opening} autoFocus>
          <Wine className="size-4" aria-hidden /> Open bottle
        </Button>
      </div>
    </Modal>
  );

  return { withBottle, prompt };
}