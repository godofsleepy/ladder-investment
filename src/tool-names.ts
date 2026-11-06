/** Which tools an assistant gets. Read-only access leaves out everything in WRITE_TOOLS. */
export const READ_TOOLS = [
  "get_portfolio",
  "get_allocation",
  "get_asset_detail",
  "get_watchlist",
  "get_theses",
  "get_macro_views",
  "get_scorecard",
  "get_net_worth",
  "check_alerts",
  "search_notes",
] as const;

export const WRITE_TOOLS = [
  "log_trade",
  "import_trades",
  "delete_trade",
  "add_to_watchlist",
  "update_watchlist_item",
  "save_thesis",
  "review_thesis",
  "close_thesis",
  "save_macro_view",
  "delete_macro_view",
  "add_note",
  "refresh_prices",
  "set_price",
  "update_asset",
] as const;
