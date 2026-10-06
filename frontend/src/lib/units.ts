import type { BaseUnit, Item } from "./types";

/** How an item is counted. Each preset maps to base unit + size + stock unit. */
export type PresetKey = "bottle" | "pack" | "single" | "kg" | "litre";

export type Preset = {
  key: PresetKey;
  label: string;
  hint: string;
  base_unit: BaseUnit;
  /** Fixed size, or null when the user enters it (bottle size, pack size). */
  fixedSize: number | null;
  sizeLabel?: string;
  defaultSize?: number;
  /** Fixed stock unit name, or null when the user names it (bottle, can, piece). */
  fixedUnit: string | null;
};

export const PRESETS: Preset[] = [
  {
    key: "bottle",
    label: "Bottles measured in ml",
    hint: "Liquor and wine. Open bottles are tracked in ml.",
    base_unit: "ml",
    fixedSize: null,
    sizeLabel: "Bottle size (ml)",
    defaultSize: 750,
    fixedUnit: "bottle",
  },
  {
    key: "pack",
    label: "Packs of pieces",
    hint: "Cigarettes and anything sold by the pack or one by one.",
    base_unit: "piece",
    fixedSize: null,
    sizeLabel: "Pieces per pack",
    defaultSize: 20,
    fixedUnit: "pack",
  },
  {
    key: "single",
    label: "Single pieces",
    hint: "Cans, soft drink bottles, beer bottles, eggs, snack packets, gas cylinders.",
    base_unit: "piece",
    fixedSize: 1,
    fixedUnit: null,
  },
  { key: "kg", label: "Kilograms", hint: "Rice, chicken, vegetables, flour.", base_unit: "g", fixedSize: 1000, fixedUnit: "kg" },
  { key: "litre", label: "Litres", hint: "Cooking oil, milk, sauces.", base_unit: "ml", fixedSize: 1000, fixedUnit: "litre" },
];

export function presetOf(item: Pick<Item, "base_unit" | "unit_size" | "stock_unit">): PresetKey {
  if (item.base_unit === "g") return "kg";
  if (item.base_unit === "ml") return item.stock_unit === "litre" && item.unit_size === 1000 ? "litre" : "bottle";
  return item.unit_size === 1 ? "single" : "pack";
}

export const BASE_LABEL: Record<BaseUnit, string> = { ml: "ml", g: "g", piece: "pcs" };

export function plural(word: string, n: number): string {
  if (n === 1 || word === "kg" || word === "ml" || word === "g" || word === "pcs") return word;
  return /(ch|sh|s|x)$/.test(word) ? `${word}es` : `${word}s`;
}

/**
 * How quantities are typed for an item:
 * - "compound": whole units + leftover base units (12 bottles + 300 ml, 3 packs + 7)
 * - "decimal":  stock units with decimals (8.25 kg, 2.5 litres)
 * - "count":    whole pieces (24 cans)
 */
export type QtyMode = "compound" | "decimal" | "count";

export function qtyMode(item: Pick<Item, "unit_size" | "stock_unit">): QtyMode {
  if (item.unit_size === 1) return "count";
  if (item.stock_unit === "kg" || item.stock_unit === "litre") return "decimal";
  return "compound";
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
