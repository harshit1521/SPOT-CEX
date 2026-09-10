import {
  cancelOrderOnBook,
  EngineError,
  getDepth,
  getUserBalances,
  initUserBalances,
  matchOrder,
  ORDERBOOKS,
  BALANCES,
} from "./index.ts";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const resetEngine = (): void => {
  ORDERBOOKS.clear();
  BALANCES.clear();
};

console.log("Running matching engine tests...\n");

resetEngine();
initUserBalances("user-a", 100_000, 2);
initUserBalances("user-b", 50_000, 1);

const restingBuy = matchOrder({
  userId: "user-a",
  type: "LIMIT",
  side: "BUY",
  symbol: "BTCUSD",
  price: 50_000,
  qty: 1,
});

assert(restingBuy.status === "PENDING", "Unmatched buy should be pending");
assert(restingBuy.fills.length === 0, "Unmatched buy should have no fills");

const depthAfterBuy = getDepth("BTCUSD");
assert(depthAfterBuy.bids.length === 1, "Book should have one bid level");
assert(depthAfterBuy.bids[0].price === 50_000, "Bid price should be 50000");

const matchedSell = matchOrder({
  userId: "user-b",
  type: "LIMIT",
  side: "SELL",
  symbol: "BTCUSD",
  price: 50_000,
  qty: 1,
});

assert(matchedSell.status === "FILLED", "Crossing sell should fill");
assert(matchedSell.fills.length === 1, "Trade should produce one fill");

const depthAfterMatch = getDepth("BTCUSD");
assert(depthAfterMatch.bids.length === 0, "Book should be empty after full match");

resetEngine();
initUserBalances("user-c", 10_000, 0);

try {
  matchOrder({
    userId: "user-c",
    type: "LIMIT",
    side: "BUY",
    symbol: "BTCUSD",
    price: 50_000,
    qty: 1,
  });
  throw new Error("Expected insufficient balance error");
} catch (error) {
  assert(error instanceof EngineError, "Insufficient balance should throw EngineError");
}

resetEngine();
initUserBalances("user-d", 100_000, 0);
initUserBalances("user-e", 0, 2);

matchOrder({
  userId: "user-e",
  orderId: "sell-1",
  type: "LIMIT",
  side: "SELL",
  symbol: "BTCUSD",
  price: 49_000,
  qty: 0.5,
});

const marketBuy = matchOrder({
  userId: "user-d",
  orderId: "market-buy-1",
  type: "MARKET",
  side: "BUY",
  symbol: "BTCUSD",
  price: null,
  qty: 0.5,
});

assert(marketBuy.status === "FILLED", "Market buy should fill against resting ask");
assert(marketBuy.fills[0].price === 49_000, "Market buy should fill at maker price");

resetEngine();
initUserBalances("user-f", 100_000, 0);
initUserBalances("user-g", 0, 1);

matchOrder({
  userId: "user-f",
  orderId: "bid-1",
  type: "LIMIT",
  side: "BUY",
  symbol: "BTCUSD",
  price: 48_000,
  qty: 0.25,
});

const marketSell = matchOrder({
  userId: "user-g",
  orderId: "market-sell-1",
  type: "MARKET",
  side: "SELL",
  symbol: "BTCUSD",
  price: null,
  qty: 0.25,
});

assert(marketSell.status === "FILLED", "Market sell should fill against resting bid");

resetEngine();
initUserBalances("user-h", 100_000, 0);

const cancelBuy = matchOrder({
  userId: "user-h",
  orderId: "cancel-1",
  type: "LIMIT",
  side: "BUY",
  symbol: "BTCUSD",
  price: 45_000,
  qty: 0.2,
});

assert(cancelBuy.status === "PENDING", "Resting order should be pending before cancel");

const beforeCancel = getUserBalances("user-h");
assert(beforeCancel.USD.locked > 0, "USD should be locked before cancel");

cancelOrderOnBook("BTCUSD", "BUY", 45_000, "cancel-1", "user-h", 0.2);

const afterCancel = getUserBalances("user-h");
assert(afterCancel.USD.locked === 0, "Locked USD should be released after cancel");
assert(getDepth("BTCUSD").bids.length === 0, "Cancelled order should leave the book");

console.log("All matching engine tests passed.");
