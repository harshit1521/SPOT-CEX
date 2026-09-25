import type { Asset, Balance, Side } from "./orderbook.ts";
import { BALANCES } from "./orderbook.ts";

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

const round = (value: number): number => Math.round(value * 1e10) / 1e10;

const emptyBalance = (): Record<Asset, Balance> => ({
  USD: { available: 0, locked: 0 },
  BTC: { available: 0, locked: 0 },
});

export const initUserBalances = (
  userId: string,
  usd: number,
  btc: number
): void => {
  BALANCES.set(userId, {
    USD: { available: usd, locked: 0 },
    BTC: { available: btc, locked: 0 },
  });
};

const getBalance = (userId: string, asset: Asset): Balance => {
  const balances = BALANCES.get(userId) ?? emptyBalance();
  return balances[asset];
};

const setBalance = (userId: string, asset: Asset, balance: Balance): void => {
  const balances = BALANCES.get(userId) ?? emptyBalance();
  balances[asset] = balance;
  BALANCES.set(userId, balances);
};

export const lockForOrder = (
  userId: string,
  asset: Asset,
  amount: number
): void => {
  const balance = getBalance(userId, asset);

  if (balance.available < amount) {
    throw new EngineError(`Insufficient ${asset} balance`);
  }

  setBalance(userId, asset, {
    available: round(balance.available - amount),
    locked: round(balance.locked + amount),
  });
};

export const unlockRemaining = (
  userId: string,
  side: Side,
  price: number,
  remainingQty: number
): void => {
  if (remainingQty <= 0) {
    return;
  }

  if (side === "BUY") {
    const unlockUsd = round(price * remainingQty);
    const usd = getBalance(userId, "USD");

    setBalance(userId, "USD", {
      available: round(usd.available + unlockUsd),
      locked: round(usd.locked - unlockUsd),
    });
    return;
  }

  const btc = getBalance(userId, "BTC");

  setBalance(userId, "BTC", {
    available: round(btc.available + remainingQty),
    locked: round(btc.locked - remainingQty),
  });
};

export const applyFillToBuyer = (
  userId: string,
  limitPrice: number,
  fillPrice: number,
  fillQty: number
): void => {
  const usd = getBalance(userId, "USD");
  const btc = getBalance(userId, "BTC");
  const lockedCost = round(limitPrice * fillQty);
  const actualCost = round(fillPrice * fillQty);
  const refund = round(lockedCost - actualCost);

  setBalance(userId, "USD", {
    available: round(usd.available + refund),
    locked: round(usd.locked - lockedCost),
  });

  setBalance(userId, "BTC", {
    available: round(btc.available + fillQty),
    locked: btc.locked,
  });
};

export const applyFillToSeller = (
  userId: string,
  fillPrice: number,
  fillQty: number
): void => {
  const usd = getBalance(userId, "USD");
  const btc = getBalance(userId, "BTC");
  const proceeds = round(fillPrice * fillQty);

  setBalance(userId, "BTC", {
    available: btc.available,
    locked: round(btc.locked - fillQty),
  });

  setBalance(userId, "USD", {
    available: round(usd.available + proceeds),
    locked: usd.locked,
  });
};
