import { randomUUID } from "crypto";
import {
  applyFillToBuyer,
  applyFillToSeller,
  EngineError,
  lockForOrder,
  unlockRemaining,
} from "./balances.ts";
import {
  addToBook,
  getOrCreateBook,
  getSortedAskPrices,
  getSortedBidPrices,
  removeFromBook,
} from "./book.ts";
import type {
  CreateOrderInput,
  FillResult,
  MatchOrderResult,
  OrderStatus,
  RestingOrder,
} from "./orderbook.ts";

const round = (value: number): number => Math.round(value * 1e10) / 1e10;

const getStatus = (qty: number, filledQty: number): OrderStatus => {
  if (filledQty === 0) {
    return "PENDING";
  }

  if (filledQty < qty) {
    return "PARTIALLY_FILLED";
  }

  return "FILLED";
};

const createFill = (
  symbol: string,
  price: number,
  qty: number,
  buyOrderId: string,
  sellOrderId: string,
  takerUserId: string
): FillResult => ({
  fillId: randomUUID(),
  symbol,
  price,
  qty,
  buyOrderId,
  sellOrderId,
  takerUserId,
  createdAt: Date.now(),
});

const applyFillBalances = (
  buyOrder: RestingOrder,
  sellOrder: RestingOrder,
  fillPrice: number,
  fillQty: number
): void => {
  applyFillToBuyer(buyOrder.userId, buyOrder.price, fillPrice, fillQty);
  applyFillToSeller(sellOrder.userId, fillPrice, fillQty);
};

const matchAgainstAsks = (
  taker: RestingOrder,
  limitPrice: number,
  fills: FillResult[]
): number => {
  const book = getOrCreateBook(taker.symbol);
  let remainingQty = round(taker.qty - taker.filledQty);

  while (remainingQty > 0) {
    const askPrices = getSortedAskPrices(book);
    const askPrice = askPrices[0];

    if (askPrice === undefined || askPrice > limitPrice) {
      break;
    }

    const level = book.asks.get(askPrice);

    if (!level || level.length === 0) {
      book.asks.delete(askPrice);
      continue;
    }

    const maker = level[0];
    if (!maker) {
      level.shift();
      continue;
    }

    const makerRemaining = round(maker.qty - maker.filledQty);

    if (makerRemaining <= 0) {
      removeFromBook(book, "SELL", askPrice, maker.orderId);
      continue;
    }

    const fillQty = round(Math.min(remainingQty, makerRemaining));

    maker.filledQty = round(maker.filledQty + fillQty);
    taker.filledQty = round(taker.filledQty + fillQty);
    remainingQty = round(remainingQty - fillQty);

    fills.push(
      createFill(
        taker.symbol,
        askPrice,
        fillQty,
        taker.orderId,
        maker.orderId,
        taker.userId
      )
    );

    applyFillBalances(taker, maker, askPrice, fillQty);

    if (maker.filledQty >= maker.qty) {
      removeFromBook(book, "SELL", askPrice, maker.orderId);
    }
  }

  return remainingQty;
};

const matchAgainstBids = (
  taker: RestingOrder,
  limitPrice: number,
  fills: FillResult[]
): number => {
  const book = getOrCreateBook(taker.symbol);
  let remainingQty = round(taker.qty - taker.filledQty);

  while (remainingQty > 0) {
    const bidPrices = getSortedBidPrices(book);
    const bidPrice = bidPrices[0];

    if (bidPrice === undefined || bidPrice < limitPrice) {
      break;
    }

    const level = book.bids.get(bidPrice);

    if (!level || level.length === 0) {
      book.bids.delete(bidPrice);
      continue;
    }

    const maker = level[0];
    if (!maker) {
      level.shift();
      continue;
    }

    const makerRemaining = round(maker.qty - maker.filledQty);

    if (makerRemaining <= 0) {
      removeFromBook(book, "BUY", bidPrice, maker.orderId);
      continue;
    }

    const fillQty = round(Math.min(remainingQty, makerRemaining));

    maker.filledQty = round(maker.filledQty + fillQty);
    taker.filledQty = round(taker.filledQty + fillQty);
    remainingQty = round(remainingQty - fillQty);

    fills.push(
      createFill(
        taker.symbol,
        bidPrice,
        fillQty,
        maker.orderId,
        taker.orderId,
        taker.userId
      )
    );

    applyFillBalances(maker, taker, bidPrice, fillQty);

    if (maker.filledQty >= maker.qty) {
      removeFromBook(book, "BUY", bidPrice, maker.orderId);
    }
  }

  return remainingQty;
};

const getMarketBuyLockPrice = (symbol: string, qty: number): number => {
  const book = getOrCreateBook(symbol);
  let remaining = qty;
  let maxPrice = 0;
  let fillableQty = 0;

  for (const askPrice of getSortedAskPrices(book)) {
    const level = book.asks.get(askPrice) ?? [];

    for (const order of level) {
      const available = round(order.qty - order.filledQty);

      if (available <= 0) {
        continue;
      }

      const take = round(Math.min(remaining, available));
      maxPrice = askPrice;
      fillableQty = round(fillableQty + take);
      remaining = round(remaining - take);

      if (remaining <= 0) {
        break;
      }
    }

    if (remaining <= 0) {
      break;
    }
  }

  if (fillableQty <= 0 || maxPrice <= 0) {
    throw new EngineError("Insufficient liquidity");
  }

  return maxPrice;
};

const buildResult = (
  order: RestingOrder,
  input: CreateOrderInput,
  remainingQty: number,
  fills: FillResult[]
): MatchOrderResult => {
  const filledQty = round(input.qty - remainingQty);

  return {
    orderId: order.orderId,
    userId: input.userId,
    side: input.side,
    symbol: input.symbol,
    type: input.type,
    price: input.price,
    qty: input.qty,
    filledQty,
    remainingQty,
    status: getStatus(input.qty, filledQty),
    fills,
  };
};

const matchLimitOrder = (input: CreateOrderInput): MatchOrderResult => {
  if (input.price == null || input.price <= 0) {
    throw new EngineError("Limit orders require a positive price");
  }

  const order: RestingOrder = {
    orderId: input.orderId ?? randomUUID(),
    userId: input.userId,
    side: input.side,
    symbol: input.symbol,
    price: input.price,
    qty: input.qty,
    filledQty: 0,
    createdAt: Date.now(),
  };

  lockForOrder(input.userId, input.side, input.price, input.qty);

  const fills: FillResult[] = [];
  const book = getOrCreateBook(input.symbol);

  const remainingQty =
    input.side === "BUY"
      ? matchAgainstAsks(order, input.price, fills)
      : matchAgainstBids(order, input.price, fills);

  if (remainingQty > 0) {
    addToBook(book, order);
  }

  return buildResult(order, input, remainingQty, fills);
};

const matchMarketOrder = (input: CreateOrderInput): MatchOrderResult => {
  const order: RestingOrder = {
    orderId: input.orderId ?? randomUUID(),
    userId: input.userId,
    side: input.side,
    symbol: input.symbol,
    price: 0,
    qty: input.qty,
    filledQty: 0,
    createdAt: Date.now(),
  };

  const fills: FillResult[] = [];

  if (input.side === "BUY") {
    const lockPrice = getMarketBuyLockPrice(input.symbol, input.qty);
    order.price = lockPrice;

    lockForOrder(input.userId, "BUY", lockPrice, input.qty);

    const remainingQty = matchAgainstAsks(
      order,
      Number.MAX_SAFE_INTEGER,
      fills
    );

    if (remainingQty > 0) {
      unlockRemaining(input.userId, "BUY", lockPrice, remainingQty);
    }

    if (fills.length === 0) {
      throw new EngineError("Insufficient liquidity");
    }

    return buildResult(order, input, remainingQty, fills);
  }

  lockForOrder(input.userId, "SELL", 0, input.qty);

  const remainingQty = matchAgainstBids(order, 0, fills);

  if (fills.length === 0) {
    unlockRemaining(input.userId, "SELL", 0, input.qty);
    throw new EngineError("Insufficient liquidity");
  }

  if (remainingQty > 0) {
    unlockRemaining(input.userId, "SELL", 0, remainingQty);
  }

  return buildResult(order, input, remainingQty, fills);
};

export const matchOrder = (input: CreateOrderInput): MatchOrderResult => {
  if (input.qty <= 0) {
    throw new EngineError("Quantity must be greater than 0");
  }

  if (input.type === "MARKET") {
    return matchMarketOrder(input);
  }

  return matchLimitOrder(input);
};

export const cancelOrderOnBook = (
  symbol: string,
  side: RestingOrder["side"],
  price: number,
  orderId: string,
  userId: string,
  remainingQty: number
): void => {
  const book = getOrCreateBook(symbol);
  const removed = removeFromBook(book, side, price, orderId);

  if (!removed) {
    throw new EngineError("Order not found on book");
  }

  if (removed.userId !== userId) {
    throw new EngineError("Cannot cancel another user's order");
  }

  unlockRemaining(userId, side, price, remainingQty);
};
