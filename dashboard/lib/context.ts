/**
 * Short references for the copy buttons. They only name the record: the assistant reads
 * the details itself through Ladder's MCP tools.
 */
import { capitalize, fullDate } from "./format";

export const assetRef = (symbol: string) => `Ladder asset ${symbol}`;
export const holdingRef = (symbol: string) => `Ladder holding ${symbol}`;
export const watchRef = (id: number, symbol: string) => `Ladder watchlist item #${id} (${symbol})`;
export const macroRef = (id: number, name: string) => `Ladder macro view #${id} (${name})`;
export const thesisRef = (id: number, symbol: string) => `Ladder thesis #${id} (${symbol})`;
export const tradeRef = (id: number, type: string, symbol: string, date: string) => `Ladder trade #${id} (${capitalize(type)} ${symbol}, ${fullDate(date)})`;
export const noteRef = (id: number, symbol: string | null) => `Ladder note #${id}${symbol ? ` (${symbol})` : ""}`;
