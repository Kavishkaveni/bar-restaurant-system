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
