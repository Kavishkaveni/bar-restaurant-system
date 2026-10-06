import {
  BarChart3,
  BedDouble,
  ChefHat,
  History,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown if the user has any one of these permissions. */
  anyOf: string[];
  group: "Service" | "Back office" | "Admin";
  /** Build phase that delivers this page; undefined = ready now. */
  phase?: number;
  blurb: string;
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, anyOf: ["dashboard.view"], group: "Service", phase: 7, blurb: "Today's sales, profit and expenses as live charts." },
  { href: "/pos", label: "POS", icon: ShoppingCart, anyOf: ["pos.order", "pos.room_service"], group: "Service", phase: 3, blurb: "Take orders, print bills and take payments." },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat, anyOf: ["kitchen.view"], group: "Service", phase: 4, blurb: "Food orders appear here live for the cooks." },
  { href: "/rooms", label: "Rooms", icon: BedDouble, anyOf: ["rooms.manage"], group: "Service", phase: 5, blurb: "Bookings, check-in, check-out and room bills." },
  { href: "/inventory", label: "Inventory", icon: Package, anyOf: ["catalogue.manage", "stock.count", "stock.wastage", "bar.open_bottle"], group: "Back office", phase: 2, blurb: "Items, recipes, open bottles and stock counts." },
  { href: "/purchases", label: "Purchases", icon: Truck, anyOf: ["purchasing.manage"], group: "Back office", phase: 2, blurb: "Suppliers, purchase orders and invoices." },
  { href: "/expenses", label: "Expenses", icon: Receipt, anyOf: ["expenses.manage"], group: "Back office", phase: 6, blurb: "Rent, salaries, utilities and shift cash." },
  { href: "/reports", label: "Reports", icon: BarChart3, anyOf: ["dashboard.view"], group: "Back office", phase: 6, blurb: "Day-end stock, sales, profit and variance." },
  { href: "/assistant", label: "AI assistant", icon: Sparkles, anyOf: ["ai.use"], group: "Back office", phase: 8, blurb: "Ask questions about the business in plain words." },
  { href: "/users", label: "Staff", icon: Users, anyOf: ["users.manage"], group: "Admin", blurb: "Add staff, set roles and PINs." },
  { href: "/roles", label: "Roles", icon: ShieldCheck, anyOf: ["users.manage"], group: "Admin", blurb: "Choose what each role can do." },
  { href: "/settings", label: "Settings", icon: Settings, anyOf: ["settings.manage"], group: "Admin", blurb: "Business name, tax and receipt details." },
  { href: "/audit", label: "Audit log", icon: History, anyOf: ["audit.view"], group: "Admin", blurb: "Who changed what, and when." },
];

export function visibleNav(can: (p: string) => boolean): NavItem[] {
  return NAV.filter((item) => item.anyOf.some(can));
}
