import {
  addToBook,
  cancelOrderOnBook,
  EngineError,
  getDepth,
  getOrCreateBook,
  getUserBalances,
  matchOrder,
  type CreateOrderInput,
  type MatchOrderResult,
  BALANCES,
  ORDERBOOKS,
} from "../../../matching-engine/index.ts";
import type { Asset, Order, OrderStatus, Prisma } from "../../prisma/generated/client.ts";
import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";

type PlaceOrderInput = {
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  symbol: string;
  price: number | null;
  qty: number;
};

const toNumber = (value: { toString(): string } | number): number => {
  return typeof value === "number" ? value : Number(value.toString());
};

export const loadEngineFromDb = async (): Promise<void> => {
  ORDERBOOKS.clear();
  BALANCES.clear();

  const balances = await prisma.balance.findMany();

  for (const balance of balances) {
    const userId = String(balance.userId);
    const current = BALANCES.get(userId) ?? {
      USD: { available: 0, locked: 0 },
      BTC: { available: 0, locked: 0 },
    };

    current[balance.asset] = {
      available: toNumber(balance.available),
      locked: toNumber(balance.locked),
    };

    BALANCES.set(userId, current);
  }

  const openOrders = await prisma.order.findMany({
    where: {
      status: {
        in: ["PENDING", "PARTIALLY_FILLED"],
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  for (const order of openOrders) {
    if (order.price == null) {
      continue;
    }

    const book = getOrCreateBook(order.symbol);

    addToBook(book, {
      orderId: order.id.toString(),
      userId: String(order.userId),
      side: order.side,
      symbol: order.symbol,
      price: toNumber(order.price),
      qty: toNumber(order.quantity),
      filledQty: toNumber(order.filledQty),
      createdAt: order.createdAt.getTime(),
    });
  }
};

const getOrderStatus = (quantity: number, filledQty: number): OrderStatus => {
  if (filledQty <= 0) {
    return "PENDING";
  }

  if (filledQty < quantity) {
    return "PARTIALLY_FILLED";
  }

  return "FILLED";
};

const syncBalancesToDb = async (
  tx: Prisma.TransactionClient,
  userIds: number[]
): Promise<void> => {
  for (const userId of userIds) {
    const balances = getUserBalances(String(userId));

    for (const asset of ["USD", "BTC"] as Asset[]) {
      await tx.balance.update({
        where: {
          userId_asset: {
            userId,
            asset,
          },
        },
        data: {
          available: balances[asset].available,
          locked: balances[asset].locked,
        },
      });
    }
  }
};

const updateOrderAfterFill = async (
  tx: Prisma.TransactionClient,
  orderId: bigint,
  fillQty: number
): Promise<number> => {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
  });

  const quantity = toNumber(order.quantity);
  const filledQty = toNumber(order.filledQty) + fillQty;

  await tx.order.update({
    where: { id: orderId },
    data: {
      filledQty,
      status: getOrderStatus(quantity, filledQty),
    },
  });

  return order.userId;
};

const persistMatchResult = async (
  dbOrderId: bigint,
  userId: number,
  result: MatchOrderResult
): Promise<void> => {
  const affectedUserIds = new Set<number>([userId]);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: dbOrderId },
      data: {
        filledQty: result.filledQty,
        status: result.status,
      },
    });

    for (const fill of result.fills) {
      const buyOrderId = BigInt(fill.buyOrderId);
      const sellOrderId = BigInt(fill.sellOrderId);

      await tx.fill.create({
        data: {
          symbol: fill.symbol,
          price: fill.price,
          quantity: fill.qty,
          buyOrderId,
          sellOrderId,
          userId,
        },
      });

      if (buyOrderId !== dbOrderId) {
        const buyOrderUserId = await updateOrderAfterFill(tx, buyOrderId, fill.qty);
        affectedUserIds.add(buyOrderUserId);
      }

      if (sellOrderId !== dbOrderId) {
        const sellOrderUserId = await updateOrderAfterFill(tx, sellOrderId, fill.qty);
        affectedUserIds.add(sellOrderUserId);
      }
    }

    await syncBalancesToDb(tx, [...affectedUserIds]);
  });
};

const formatMatchResult = (dbOrderId: bigint, result: MatchOrderResult) => ({
  orderId: dbOrderId.toString(),
  symbol: result.symbol,
  side: result.side,
  type: result.type,
  price: result.price,
  qty: result.qty,
  filledQty: result.filledQty,
  remainingQty: result.remainingQty,
  status: result.status,
  fills: result.fills.map((fill) => ({
    fillId: fill.fillId,
    symbol: fill.symbol,
    price: fill.price,
    qty: fill.qty,
    buyOrderId: fill.buyOrderId,
    sellOrderId: fill.sellOrderId,
  })),
});

export const formatOrder = (order: Order) => ({
  orderId: order.id.toString(),
  symbol: order.symbol,
  side: order.side,
  type: order.orderType,
  price: order.price?.toString() ?? null,
  quantity: order.quantity.toString(),
  filledQty: order.filledQty.toString(),
  status: order.status,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

export const placeOrder = async (userId: number, input: PlaceOrderInput) => {
  await loadEngineFromDb();

  const dbOrder = await prisma.order.create({
    data: {
      userId,
      symbol: input.symbol,
      side: input.side,
      orderType: input.type,
      price: input.type === "LIMIT" ? input.price : null,
      quantity: input.qty,
      status: "PENDING",
    },
  });

  const engineInput: CreateOrderInput = {
    userId: String(userId),
    orderId: dbOrder.id.toString(),
    type: input.type,
    side: input.side,
    symbol: input.symbol,
    price: input.type === "LIMIT" ? input.price : null,
    qty: input.qty,
  };

  let result: MatchOrderResult;

  try {
    result = matchOrder(engineInput);
  } catch (error) {
    await prisma.order.delete({ where: { id: dbOrder.id } });

    if (error instanceof EngineError) {
      throw new ApiError(400, error.message);
    }

    throw error;
  }

  await persistMatchResult(dbOrder.id, userId, result);

  return formatMatchResult(dbOrder.id, result);
};

export const cancelOrder = async (userId: number, orderIdValue: string) => {
  let orderId: bigint;

  try {
    orderId = BigInt(orderIdValue);
  } catch {
    throw new ApiError(400, "Invalid order ID");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.userId !== userId) {
    throw new ApiError(403, "You can only cancel your own orders");
  }

  if (order.status !== "PENDING" && order.status !== "PARTIALLY_FILLED") {
    throw new ApiError(400, "Only open orders can be cancelled");
  }

  if (order.price == null) {
    throw new ApiError(400, "Market orders cannot be cancelled");
  }

  await loadEngineFromDb();

  const remainingQty = toNumber(order.quantity) - toNumber(order.filledQty);
  const price = toNumber(order.price);

  try {
    cancelOrderOnBook(
      order.symbol,
      order.side,
      price,
      order.id.toString(),
      String(userId),
      remainingQty
    );
  } catch (error) {
    if (error instanceof EngineError) {
      throw new ApiError(400, error.message);
    }

    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });

    await syncBalancesToDb(tx, [userId]);
  });

  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
  });

  return formatOrder(updated);
};

export const getOpenOrders = async (userId: number) => {
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: {
        in: ["PENDING", "PARTIALLY_FILLED"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return orders.map(formatOrder);
};

export const getOrderById = async (userId: number, orderIdValue: string) => {
  let orderId: bigint;

  try {
    orderId = BigInt(orderIdValue);
  } catch {
    throw new ApiError(400, "Invalid order ID");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new ApiError(404, "Order not found");
  }

  if (order.userId !== userId) {
    throw new ApiError(403, "You can only view your own orders");
  }

  return formatOrder(order);
};

export const getUserFills = async (userId: number) => {
  const fills = await prisma.fill.findMany({
    where: {
      OR: [
        { userId },
        { buyOrder: { userId } },
        { sellOrder: { userId } },
      ],
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return fills.map((fill) => ({
    fillId: fill.id.toString(),
    symbol: fill.symbol,
    price: fill.price.toString(),
    quantity: fill.quantity.toString(),
    buyOrderId: fill.buyOrderId?.toString() ?? null,
    sellOrderId: fill.sellOrderId?.toString() ?? null,
    createdAt: fill.createdAt,
  }));
};

export const getMarketDepth = async (symbol: string) => {
  await loadEngineFromDb();
  return getDepth(symbol);
};

export const initializeEngine = async (): Promise<void> => {
  await loadEngineFromDb();

  let openOrderCount = 0;

  for (const book of ORDERBOOKS.values()) {
    for (const level of book.bids.values()) {
      openOrderCount += level.length;
    }

    for (const level of book.asks.values()) {
      openOrderCount += level.length;
    }
  }

  console.log(
    `Matching engine ready: ${BALANCES.size} user balance(s), ${ORDERBOOKS.size} market(s), ${openOrderCount} open order(s)`
  );
};
