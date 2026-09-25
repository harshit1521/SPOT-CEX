import "dotenv/config";
import { randomUUID } from "crypto";
import { createClient, type RedisClientType } from "redis";
import { matchOrder } from "./src/orderBook/match.ts";
import { addToBook, getOrCreateBook } from "./src/orderBook/book.ts";
import { initUserBalances } from "./src/orderBook/balances.ts";
import { BALANCES } from "./src/orderBook/orderbook.ts";
import type { RestingOrder } from "./src/orderBook/orderbook.ts";

export { matchOrder, cancelOrderOnBook } from "./src/orderBook/match.ts";
export { initUserBalances, EngineError } from "./src/orderBook/balances.ts";
export { getDepth } from "./src/orderBook/book.ts";
export { ORDERBOOKS, BALANCES } from "./src/orderBook/orderbook.ts";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const DATABASE_URL = process.env.DATABASE_URL ?? "";

const STREAMS = {
  ORDER_EVENTS: "cex:place-order-stream",
  EXECUTION_EVENTS: "cex:execution-event-stream",
} as const;

const CONSUMER_GROUP = "matching-engine";
const CONSUMER_NAME = `engine-${process.pid}`;

interface OrderAcceptedPayload {
  eventId: string;
  eventType: "ORDER_ACCEPTED";
  orderId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  price: string | null;
  quantity: string;
  quoteBudget: string | null;
  lockedAsset: "USD" | "BTC";
  lockedAmount: number;
  timestamp: number;
}

interface TradeExecutedEvent {
  eventId: string;
  eventType: "TRADE_EXECUTED";
  tradeId: string;
  symbol: string;
  buyOrderId: string;
  sellOrderId: string;
  buyerUserId: string;
  sellerUserId: string;
  buyerLimitPrice: string | null;
  buyerOrderType: "LIMIT" | "MARKET";
  price: string;
  quantity: string;
  timestamp: number;
}

interface OrderRestedEvent {
  eventId: string;
  eventType: "ORDER_RESTED";
  orderId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: string;
  quantity: string;
  remainingQty: string;
  timestamp: number;
}

interface OrderFilledEvent {
  eventId: string;
  eventType: "ORDER_FILLED";
  orderId: string;
  timestamp: number;
}

interface OrderCancelledEvent {
  eventId: string;
  eventType: "ORDER_CANCELLED";
  orderId: string;
  userId: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  remainingQty: string;
  reason: string;
  timestamp: number;
}

async function bootstrapFromDb(): Promise<void> {
  if (!DATABASE_URL) {
    console.warn("[engine] DATABASE_URL not set, skipping DB bootstrap");
    return;
  }

  const { PrismaClient } = await import("./prisma/generated/client.ts");
  const { PrismaPg } = await import("@prisma/adapter-pg");

  const adapter = new PrismaPg({
    connectionString: DATABASE_URL.replace(
      /([?&])sslmode=require\b/g,
      "$1sslmode=verify-full"
    ),
  });

  const prisma = new PrismaClient({ adapter });

  try {
    console.log("[engine] Bootstrapping order book from DB via Prisma...");

    const balances = await prisma.balance.findMany({
      select: {
        userId: true,
        asset: true,
        available: true,
        locked: true,
      },
    });

    for (const b of balances) {
      const userIdStr = String(b.userId);
      const availableNum = Number(b.available);
      const lockedNum = Number(b.locked);

      initUserBalances(userIdStr, availableNum + lockedNum, 0);

      const existing = BALANCES.get(userIdStr);
      if (existing) {
        if (b.asset === "USD") {
          existing.USD = {
            available: availableNum,
            locked: lockedNum,
          };
        } else if (b.asset === "BTC") {
          existing.BTC = {
            available: availableNum,
            locked: lockedNum,
          };
        }
      }
    }

    const orders = await prisma.order.findMany({
      where: {
        status: { in: ["PENDING", "PARTIALLY_FILLED"] },
        orderType: "LIMIT",
        price: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        side: true,
        symbol: true,
        price: true,
        quantity: true,
        filledQty: true,
        createdAt: true,
      },
    });

    for (const o of orders) {
      const restingOrder: RestingOrder = {
        orderId: String(o.id),
        userId: String(o.userId),
        side: o.side as "BUY" | "SELL",
        symbol: o.symbol,
        price: Number(o.price),
        qty: Number(o.quantity),
        filledQty: Number(o.filledQty),
        createdAt: o.createdAt.getTime(),
      };
      const book = getOrCreateBook(o.symbol);
      addToBook(book, restingOrder);
    }

    console.log(
      `[engine] Bootstrap done: ${balances.length} balances, ${orders.length} orders loaded`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function publishExecution(
  redis: RedisClientType,
  event:
    | TradeExecutedEvent
    | OrderRestedEvent
    | OrderFilledEvent
    | OrderCancelledEvent
): Promise<void> {
  await redis.xAdd(STREAMS.EXECUTION_EVENTS, "*", {
    data: JSON.stringify(event),
  });
}

async function processOrderAccepted(
  redis: RedisClientType,
  payload: OrderAcceptedPayload
): Promise<void> {
  const { orderId, userId, symbol, side, orderType, price, quantity, quoteBudget, lockedAsset, lockedAmount } = payload;
  const qty = parseFloat(quantity);
  const limitPrice = price != null ? parseFloat(price) : null;

  let result;
  try {
    result = matchOrder({
      orderId,
      userId,
      type: orderType,
      side,
      symbol,
      price: limitPrice,
      quotePrice: quoteBudget != null ? parseFloat(quoteBudget) : null,
      qty,
      lockedAsset,
      lockedAmount,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[engine] matchOrder error for order ${orderId}: ${errMsg}`);

    const cancelEvent: OrderCancelledEvent = {
      eventId: randomUUID(),
      eventType: "ORDER_CANCELLED",
      orderId,
      userId,
      side,
      orderType,
      remainingQty: quantity,
      reason: errMsg,
      timestamp: Date.now(),
    };
    await publishExecution(redis, cancelEvent);
    return;
  }

  for (const fill of result.fills) {
    const tradeEvent: TradeExecutedEvent = {
      eventId: randomUUID(),
      eventType: "TRADE_EXECUTED",
      tradeId: randomUUID(),
      symbol,
      buyOrderId: fill.buyOrderId,
      sellOrderId: fill.sellOrderId,
      buyerUserId: side === "BUY" ? userId : fill.takerUserId,
      sellerUserId: side === "SELL" ? userId : fill.takerUserId,
      buyerLimitPrice: side === "BUY" ? (price ?? null) : null,
      buyerOrderType: side === "BUY" ? orderType : "LIMIT",
      price: fill.price.toString(),
      quantity: fill.qty.toString(),
      timestamp: Date.now(),
    };
    await publishExecution(redis, tradeEvent);
  }

  if (result.remainingQty > 0 && orderType === "LIMIT") {
    const restedEvent: OrderRestedEvent = {
      eventId: randomUUID(),
      eventType: "ORDER_RESTED",
      orderId,
      userId,
      symbol,
      side,
      price: (limitPrice ?? 0).toString(),
      quantity,
      remainingQty: result.remainingQty.toString(),
      timestamp: Date.now(),
    };
    await publishExecution(redis, restedEvent);
  }

  if (result.status === "FILLED") {
    const filledEvent: OrderFilledEvent = {
      eventId: randomUUID(),
      eventType: "ORDER_FILLED",
      orderId,
      timestamp: Date.now(),
    };
    await publishExecution(redis, filledEvent);
  }

  if (orderType === "MARKET" && result.remainingQty > 0) {
    const cancelEvent: OrderCancelledEvent = {
      eventId: randomUUID(),
      eventType: "ORDER_CANCELLED",
      orderId,
      userId,
      side,
      orderType,
      remainingQty: result.remainingQty.toString(),
      reason: "Insufficient liquidity — market order partially filled",
      timestamp: Date.now(),
    };
    await publishExecution(redis, cancelEvent);
  }
}

async function main(): Promise<void> {
  console.log("[engine] Starting matching engine...");

  await bootstrapFromDb();

  const redis = createClient({ url: REDIS_URL }) as RedisClientType;
  redis.on("error", (err) => console.error("[redis] error:", err));
  await redis.connect();
  console.log("[engine] Connected to Redis");

  try {
    await redis.xGroupCreate(STREAMS.ORDER_EVENTS, CONSUMER_GROUP, "$", {
      MKSTREAM: true,
    });
    console.log(`[engine] Created consumer group "${CONSUMER_GROUP}"`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("BUSYGROUP")) {
      console.log(`[engine] Consumer group "${CONSUMER_GROUP}" already exists`);
    } else {
      throw err;
    }
  }

  while (true) {
    const messages = await redis.xReadGroup(
      CONSUMER_GROUP,
      CONSUMER_NAME,
      [{ key: STREAMS.ORDER_EVENTS, id: ">" }],
      { COUNT: 1, BLOCK: 5000 }
    );

    if (!messages || messages.length === 0) {
      continue;
    }

    const stream = messages[0];
    if (!stream) continue;

    for (const message of stream.messages) {
      const raw = message.message["data"];
      if (!raw) {
        await redis.xAck(STREAMS.ORDER_EVENTS, CONSUMER_GROUP, message.id);
        continue;
      }

      try {
        const payload = JSON.parse(raw) as OrderAcceptedPayload;

        if (payload.eventType === "ORDER_ACCEPTED") {
          await processOrderAccepted(redis, payload);
        }
      } catch (err) {
        console.error(`[engine] Error processing message ${message.id}:`, err);
      }

      await redis.xAck(STREAMS.ORDER_EVENTS, CONSUMER_GROUP, message.id);
    }
  }
}

process.on("SIGINT", async () => {
  console.log("[engine] SIGINT received, shutting down...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[engine] SIGTERM received, shutting down...");
  process.exit(0);
});

main().catch((err) => {
  console.error("[engine] Fatal error:", err);
  process.exit(1);
});
