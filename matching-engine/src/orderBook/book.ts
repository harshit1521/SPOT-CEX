import type {
  DepthLevel,
  DepthResponse,
  OrderBook,
  RestingOrder,
  Side,
} from "./orderbook.ts";
import { ORDERBOOKS } from "./orderbook.ts";

export const createOrderBook = (): OrderBook => ({
  bids: new Map(),
  asks: new Map(),
});

export const getOrCreateBook = (symbol: string): OrderBook => {
  const existing = ORDERBOOKS.get(symbol);

  if (existing) {
    return existing;
  }

  const book = createOrderBook();
  ORDERBOOKS.set(symbol, book);
  return book;
};

const getSideMap = (book: OrderBook, side: Side): Map<number, RestingOrder[]> => {
  return side === "BUY" ? book.bids : book.asks;
};

export const addToBook = (book: OrderBook, order: RestingOrder): void => {
  const sideMap = getSideMap(book, order.side);
  const level = sideMap.get(order.price) ?? [];
  level.push(order);
  sideMap.set(order.price, level);
};

export const removeFromBook = (
  book: OrderBook,
  side: Side,
  price: number,
  orderId: string
): RestingOrder | null => {
  const sideMap = getSideMap(book, side);
  const level = sideMap.get(price);

  if (!level) {
    return null;
  }

  const index = level.findIndex((order) => order.orderId === orderId);

  if (index === -1) {
    return null;
  }

  const [removed] = level.splice(index, 1);

  if (level.length === 0) {
    sideMap.delete(price);
  }

  return removed ?? null;
};

export const getSortedAskPrices = (book: OrderBook): number[] => {
  return [...book.asks.keys()].sort((a, b) => a - b); // ascending order (lowest price first)
};

export const getSortedBidPrices = (book: OrderBook): number[] => {
  return [...book.bids.keys()].sort((a, b) => b - a); // descending order (highest price first)
};

const aggregateSide = (
  book: OrderBook,
  side: Side,
  sort: (a: number, b: number) => number
): DepthLevel[] => {
  const sideMap = getSideMap(book, side);
  const levels: DepthLevel[] = [];

  for (const price of [...sideMap.keys()].sort(sort)) {
    const orders = sideMap.get(price) ?? [];
    const qty = orders.reduce(
      (total, order) => total + (order.qty - order.filledQty),
      0
    );

    if (qty > 0) {
      levels.push({ price, qty });
    }
  }

  return levels;
};

export const getDepth = (symbol: string): DepthResponse => {
  const book = getOrCreateBook(symbol);

  return {
    symbol,
    bids: aggregateSide(book, "BUY", (a, b) => b - a),
    asks: aggregateSide(book, "SELL", (a, b) => a - b),
  };
};
