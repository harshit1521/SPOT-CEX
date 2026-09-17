import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";
import { formatOrder } from "./order.service.ts";

export { formatOrder };

export const getOpenOrders = async (userId: number) => {
  const orders = await prisma.order.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "PARTIALLY_FILLED"] },
    },
    orderBy: { createdAt: "desc" },
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

  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) throw new ApiError(404, "Order not found");
  if (order.userId !== userId) throw new ApiError(403, "You can only view your own orders");

  return formatOrder(order);
};

export const getUserTrades = async (userId: number) => {
  const trades = await prisma.trade.findMany({
    where: {
      OR: [
        { buyOrder: { userId } },
        { sellOrder: { userId } },
      ],
    },
    include: {
      buyOrder: { select: { userId: true } },
      sellOrder: { select: { userId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return trades.map((trade) => ({
    tradeId: trade.id.toString(),
    symbol: trade.symbol,
    price: trade.price.toString(),
    quantity: trade.quantity.toString(),
    buyOrderId: trade.buyOrderId.toString(),
    sellOrderId: trade.sellOrderId.toString(),
    buyerUserId: trade.buyOrder.userId,
    sellerUserId: trade.sellOrder.userId,
    createdAt: trade.createdAt,
  }));
};

export const getMarketDepth = async (symbol: string) => {
  const bids = await prisma.$queryRaw<Array<{ price: string; quantity: string }>>`
    SELECT
      price::text,
      SUM((quantity - "filledQty"))::text AS quantity
    FROM "Order"
    WHERE
      symbol = ${symbol}
      AND side = 'BUY'::"Side"
      AND "orderType" = 'LIMIT'::"OrderType"
      AND status IN ('PENDING', 'PARTIALLY_FILLED')::"OrderStatus"[]
      AND price IS NOT NULL
    GROUP BY price
    ORDER BY price DESC
  `;

  const asks = await prisma.$queryRaw<Array<{ price: string; quantity: string }>>`
    SELECT
      price::text,
      SUM((quantity - "filledQty"))::text AS quantity
    FROM "Order"
    WHERE
      symbol = ${symbol}
      AND side = 'SELL'::"Side"
      AND "orderType" = 'LIMIT'::"OrderType"
      AND status IN ('PENDING', 'PARTIALLY_FILLED')::"OrderStatus"[]
      AND price IS NOT NULL
    GROUP BY price
    ORDER BY price ASC
  `;

  return {
    symbol,
    bids: bids.map((r) => ({ price: r.price, quantity: r.quantity })),
    asks: asks.map((r) => ({ price: r.price, quantity: r.quantity })),
  };
};
