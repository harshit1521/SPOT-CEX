export type Side = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";
export type OrderStatus = "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
export type Asset = "USD" | "BTC";

export interface Balance {
  available: number;
  locked: number;
}

export interface RestingOrder {
  orderId: string;
  userId: string;
  side: Side;
  symbol: string;
  price: number;
  qty: number;
  filledQty: number;
  createdAt: number;
}

export interface OrderBook {
  bids: Map<number, RestingOrder[]>;  // price -> orders, best bid = highest price
  asks: Map<number, RestingOrder[]>;  // price -> orders, best ask = lowest price
}

export interface CreateOrderInput {
  userId: string;
  orderId?: string;
  type: OrderType;
  side: Side;
  symbol: string;
  price: number | null;
  qty: number;
}

// What a fill looks like right after a match, before/while it's persisted.
// Not stored long-term in memory — written to Fill table, then discarded.
export interface FillResult {
  fillId: string;
  symbol: string;
  price: number;
  qty: number;
  buyOrderId: string;
  sellOrderId: string;
  takerUserId: string;
  createdAt: number;
}

export interface DepthLevel {
  price: number;
  qty: number;
}

export interface DepthResponse {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

export interface MatchOrderResult {
  orderId: string;
  userId: string;
  side: Side;
  symbol: string;
  type: OrderType;
  price: number | null;
  qty: number;
  filledQty: number;
  remainingQty: number;
  status: OrderStatus;
  fills: FillResult[];
}

// userId -> asset -> balance (live cache, source of truth is Balance table)
export const BALANCES = new Map<string, Record<Asset, Balance>>();

// symbol -> order book (live matching state, only resting/open orders)
export const ORDERBOOKS = new Map<string, OrderBook>();