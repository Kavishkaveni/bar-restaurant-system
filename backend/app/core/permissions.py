"""Permission catalogue and default role setup.

Permissions are plain strings stored per role in `role_permissions`, so the
owner can change them from Settings. The Owner role always has every
permission and cannot be edited.
"""

PERMISSIONS: dict[str, str] = {
    # POS
    "pos.order": "Create orders and bills",
    "pos.room_service": "Create room service orders",
    "pos.payment": "Take payments",
    "pos.discount_void": "Give discounts, void or edit paid bills",
    # Bar and stock
    "bar.open_bottle": "Open bottles for pegs",
    "stock.wastage": "Record wastage",
    "stock.count": "Enter stock counts",
    "catalogue.manage": "Manage items, recipes and prices",
    "purchasing.manage": "Manage purchases and suppliers",
    # Rooms and kitchen
    "rooms.manage": "Rooms, bookings, check-in and check-out",
    "kitchen.view": "Kitchen screen",
    # Money and reports
    "expenses.manage": "Manage expenses",
    "dashboard.view": "Dashboard: sales figures",
    "dashboard.profit": "Dashboard: profit and costs",
    "ai.use": "AI assistant",
    # Admin
    "users.manage": "Manage users and roles",
    "settings.manage": "Change business settings",
    "audit.view": "View the audit log",
}

OWNER_ROLE = "owner"

# name -> (label, permissions). Matches the roles table in the build plan.
DEFAULT_ROLES: dict[str, tuple[str, list[str]]] = {
    OWNER_ROLE: ("Owner", list(PERMISSIONS)),
    "manager": (
        "Manager",
        [
            "pos.order", "pos.room_service", "pos.payment", "pos.discount_void",
            "bar.open_bottle", "stock.wastage", "stock.count",
            "catalogue.manage", "purchasing.manage",
            "rooms.manage", "kitchen.view", "expenses.manage",
            "dashboard.view", "ai.use",
        ],
    ),
    "receptionist": (
        "Receptionist",
        ["pos.room_service", "pos.payment", "rooms.manage"],
    ),
    "bartender": (
        "Bartender",
        ["pos.order", "pos.payment", "bar.open_bottle", "stock.wastage", "stock.count"],
    ),
    "waiter": ("Waiter", ["pos.order", "pos.payment", "kitchen.view"]),
    "kitchen": ("Kitchen", ["kitchen.view", "stock.wastage", "stock.count"]),
}

DEFAULT_SETTINGS: dict[str, object] = {
    "business_name": "My Bar & Restaurant",
    "address": "",
    "phone": "",
    "currency": "LKR",
    "currency_symbol": "Rs.",
    "timezone": "Asia/Colombo",
    "tax_percent": 0,
    "service_charge_percent": 0,
    "receipt_footer": "Thank you! Please come again.",
}
