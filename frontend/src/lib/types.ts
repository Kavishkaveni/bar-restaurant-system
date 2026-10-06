export type RoleBrief = { id: number; name: string; label: string };

export type Role = RoleBrief & {
  is_system: boolean;
  permission_names: string[];
};

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
  overhead_percent: number;
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

export type AuditPage = {
  items: AuditEntry[];
  total: number;
  page: number;
  page_size: number;
};

// ---- Phase 2: catalogue, stock, purchasing ----------------------------------

export type Module = "bar" | "sundry" | "food" | "other";
export type BaseUnit = "ml" | "g" | "piece";

export type Category = {
  id: number;
  name: string;
  module: Module;
  is_active: boolean;
  item_count: number;
};

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

export type ItemKind = "final_product" | "build_assembly";

export type Item = {
  id: number;
  name: string;
  category: { id: number; name: string; module: Module };
  kind: ItemKind;
  batch_yield: number | null;
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

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

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

// ---- Phase 3: POS -------------------------------------------------------------

export type OrderType = "table" | "bar" | "takeaway" | "tab";
export type PaymentMethod = "cash" | "card" | "bank_transfer" | "qr";

export type OpenOrderBrief = {
  id: number;
  total: number;
  item_count: number;
  opened_at: string;
  printed: boolean;
};

export type DiningTable = {
  id: number;
  name: string;
  area: string;
  seats: number;
  sort_order: number;
  open_orders: OpenOrderBrief[];
};

export type SellOption = {
  id: number;
  item_id: number;
  name: string;
  deduct_qty: number;
  price: number;
  sort_order: number;
};

export type MenuOption = { id: number | null; name: string; price: number };
export type MenuItem = {
  id: number;
  name: string;
  category_id: number;
  stock_unit: string;
  track_stock: boolean;
  on_hand_display: string;
  out_of_stock: boolean;
  options: MenuOption[];
};
export type Menu = {
  categories: { id: number; name: string; module: Module }[];
  items: MenuItem[];
};

export type OrderLine = {
  id: number;
  item_id: number;
  option_id: number | null;
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
  note: string;
  kitchen_status: KitchenStatus | null;
  created_at: string;
};

export type KitchenStatus = "new" | "preparing" | "ready" | "served";

export type OrderPayment = {
  id: number;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  change: number;
  tip: number;
  reference: string;
  user: { id: number; name: string } | null;
  created_at: string;
};

export type Order = {
  id: number;
  type: OrderType;
  label: string;
  table: { id: number; name: string } | null;
  customer_name: string;
  note: string;
  status: "open" | "paid" | "void" | "merged";
  service_charge_percent: number;
  tax_percent: number;
  discount_type: "percent" | "amount" | null;
  discount_value: number;
  discount_reason: string;
  subtotal: number;
  discount: number;
  service_charge: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  tips: number;
  item_count: number;
  printed_count: number;
  receipt_count: number;
  opener: { id: number; name: string } | null;
  closer: { id: number; name: string } | null;
  created_at: string;
  closed_at: string | null;
  void_reason: string;
  merged_into: number | null;
  lines: OrderLine[];
  payments: OrderPayment[];
};

export type BillsPage = Page<Order> & {
  day: string;
  sales_total: number;
  bill_count: number;
  tips_total: number;
  by_method: { method: PaymentMethod; amount: number; count: number }[];
  void_count: number;
};

export type Approval = { user_id: number; pin: string };

// ---- Phase 4: recipes, open bottles, kitchen ---------------------------------------

export type RecipeLineOut = {
  id: number;
  component: {
    id: number;
    name: string;
    base_unit: BaseUnit;
    unit_size: number;
    stock_unit: string;
    track_stock: boolean;
  };
  qty: number;
  qty_display: string;
  cost: number;
  on_hand_display: string;
};

export type Recipe = {
  item_id: number;
  kind: ItemKind;
  lines: RecipeLineOut[];
  ingredient_cost: number;
  overhead_percent: number;
  total_cost: number;
  selling_price: number | null;
  margin: number | null;
  margin_percent: number | null;
  batch_yield: number | null;
  batch_yield_display: string | null;
  portions_available: number | null;
};

export type OpenBottle = {
  id: number;
  size_ml: number;
  remaining_ml: number;
  opened_at: string;
  opener: { id: number; name: string } | null;
  note: string;
};

export type BottleItem = {
  item_id: number;
  name: string;
  category: string;
  unit_size: number;
  sealed: number;
  on_hand_display: string;
  smallest_pour: number | null;
  running_low: boolean;
  open: OpenBottle[];
};

export type TicketLine = {
  id: number;
  name: string;
  qty: number;
  note: string;
  kitchen_status: KitchenStatus;
  created_at: string;
  kitchen_updated_at: string | null;
};

export type Ticket = {
  order_id: number;
  label: string;
  order_note: string;
  waiter: string | null;
  lines: TicketLine[];
  oldest: string;
};
