export type RoleBrief = { id: number; name: string; label: string };

export type Role = RoleBrief & { is_system: boolean; permission_names: string[] };

export type User = {
  id: number;
  name: string;
  username: string;
  role: RoleBrief;
  is_active: boolean;
  has_pin: boolean;
  last_login_at: string | null;
  created_at: string;
};

export type StaffTile = { id: number; name: string; role: RoleBrief };

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  user: User;
  permissions: string[];
};

export type BusinessSettings = {
  business_name: string;
  address: string;
  phone: string;
  currency: string;
  currency_symbol: string;
  timezone: string;
  tax_percent: number;
  service_charge_percent: number;
  receipt_footer: string;
};

export type AuditEntry = {
  id: number;
  user: { id: number; name: string } | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type AuditPage = { items: AuditEntry[]; total: number; page: number; page_size: number };

// ---- Phase 2: catalogue, stock, purchasing ----------------------------------

export type Module = "bar" | "sundry" | "food" | "other";
export type BaseUnit = "ml" | "g" | "piece";

export type Category = { id: number; name: string; module: Module; is_active: boolean; item_count: number };

export type SupplierBrief = { id: number; name: string };

export type Supplier = SupplierBrief & {
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  is_active: boolean;
  balance_due: number;
  purchase_count: number;
};

export type Item = {
  id: number;
  name: string;
  category: { id: number; name: string; module: Module };
  kind: string;
  base_unit: BaseUnit;
  unit_size: number;
  stock_unit: string;
  cost_price: number;
  selling_price: number | null;
  avg_cost: number;
  reorder_level: number;
  track_stock: boolean;
  supplier: SupplierBrief | null;
  sku: string;
  notes: string;
  is_active: boolean;
  on_hand: number;
  on_hand_display: string;
  stock_value: number;
  is_low: boolean;
  has_movements: boolean;
};

export type Movement = {
  id: number;
  qty: number;
  qty_display: string;
  unit_cost: number;
  type: string;
  ref_type: string | null;
  ref_id: number | null;
  reason: string;
  user: { id: number; name: string } | null;
  created_at: string;
  balance_after: number;
};

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export type PurchaseLine = {
  id: number;
  item: { id: number; name: string; stock_unit: string };
  qty: number;
  unit_cost: number;
  line_total: number;
  expiry_date: string | null;
};

export type Purchase = {
  id: number;
  supplier: SupplierBrief;
  invoice_no: string;
  invoice_date: string;
  notes: string;
  total: number;
  amount_paid: number;
  status: "received" | "cancelled";
  cancel_reason: string;
  creator: { id: number; name: string } | null;
  created_at: string;
  lines: PurchaseLine[];
};
