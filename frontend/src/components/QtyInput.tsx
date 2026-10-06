"use client";

import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui";
import type { Item } from "@/lib/types";
import { BASE_LABEL, plural, qtyMode, round3 } from "@/lib/units";

type Props = {
  item: Pick<Item, "base_unit" | "unit_size" | "stock_unit">;
  /** Quantity in base units (ml, g, pieces). */
  value: number;
  onChange: (baseQty: number) => void;
  label: string;
};

/** Type a quantity the way staff count it, e.g. "12 bottles + 300 ml". Emits base units. */
export function QtyInput({ item, value, onChange, label }: Props) {
  const mode = qtyMode(item);
  const size = item.unit_size;
  const id = useId();

  const [whole, setWhole] = useState("");
  const [rest, setRest] = useState("");

  // Fill the boxes from the incoming value once (e.g. the current stock for a count).
  useEffect(() => {
    if (mode === "compound") {
      const w = Math.floor(value / size);
      setWhole(String(w));
      setRest(String(round3(value - w * size)));
    } else if (mode === "decimal") {
      setWhole(String(round3(value / size)));
    } else {
      setWhole(String(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit(w: string, r: string) {
    const wn = Number(w) || 0;
    const rn = Number(r) || 0;
    if (mode === "compound") onChange(round3(wn * size + rn));
    else if (mode === "decimal") onChange(round3(wn * size));
    else onChange(Math.round(wn));
  }

  const unitWord = plural(item.stock_unit, 2);

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex items-center gap-2">
        <Input
          id={`${id}-whole`}
          aria-label={unitWord}
          type="number"
          inputMode={mode === "decimal" ? "decimal" : "numeric"}
          min={0}
          step={mode === "decimal" ? "0.001" : "1"}
          value={whole}
          onChange={(e) => {
            setWhole(e.target.value);
            emit(e.target.value, rest);
          }}
          className="tabular w-28"
        />
        <span className="text-sm text-ink-soft">{unitWord}</span>
        {mode === "compound" && (
          <>
            <span className="text-ink-soft">+</span>
            <Input
              id={`${id}-rest`}
              aria-label={`extra ${BASE_LABEL[item.base_unit]}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={size - (item.base_unit === "piece" ? 1 : 0.001)}
              step={item.base_unit === "piece" ? "1" : "any"}
              value={rest}
              onChange={(e) => {
                setRest(e.target.value);
                emit(whole, e.target.value);
              }}
              className="tabular w-24"
            />
            <span className="text-sm text-ink-soft">{BASE_LABEL[item.base_unit]}</span>
          </>
        )}
      </div>
    </fieldset>
  );
}
