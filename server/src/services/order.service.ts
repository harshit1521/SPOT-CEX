import { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";
import type { Asset, Order, OutboxEventType } from "../../prisma/generated/client.ts";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET";

export interface PlaceOrderInput {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;

  price: number | null;

  quantity: number;

  quoteBudget: number | null;
}

export interface OrderResult {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  price: string | null;
  quantity: string;
  filledQty: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CancelOrderResult = OrderResult;

export const formatOrder = (order: Order): OrderResult => ({
  orderId: order.id.toString(),
  clientOrderId: order.clientOrderId,
  symbol: order.symbol,
  side: order.side,
  orderType: order.orderType,
  price: order.price?.toString() ?? null,
  quantity: order.quantity.toString(),
  filledQty: order.filledQty.toString(),
  status: order.status,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

function determineReservation(
  side: OrderSide,
  orderType: OrderType,
  quantity: number,
  price: number | null,
  quoteBudget: number | null
): { asset: Asset; amount: Decimal } {
  const qty = new Decimal(quantity.toString());

  if (side === "BUY") {
    if (orderType === "LIMIT") {
      if (price == null) throw new ApiError(400, "LIMIT BUY requires a price");

      const p = new Decimal(price.toString());
      return { asset: "USD", amount: qty.mul(p) };
    }

    if (quoteBudget == null) throw new ApiError(400, "MARKET BUY requires quoteBudget");
    return { asset: "USD", amount: new Decimal(quoteBudget.toString()) };
  }

  return { asset: "BTC", amount: qty };
}

export const placeOrder = async (
  userId: number,
  input: PlaceOrderInput
): Promise<OrderResult> => {
  const { asset: reserveAsset, amount: reserveAmount } = determineReservation(
    input.side,
    input.orderType,
    input.quantity,
    input.price,
    input.quoteBudget
  );

  const result = await prisma.$transaction(async (tx) => {

    const rows = await tx.$queryRaw<
      Array<{ available: string; locked: string }>
    >`
      SELECT available::text, locked::text
      FROM "Balance"
      WHERE "userId" = ${userId} AND "asset" = ${reserveAsset}::"Asset"
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new ApiError(404, `No ${reserveAsset} balance found for user`);
    }

    const balanceRow = rows[0];
    if (!balanceRow) {
      throw new ApiError(404, `No ${reserveAsset} balance found for user`);
    }

    const available = new Decimal(balanceRow.available);
    const locked = new Decimal(balanceRow.locked);

    if (available.lessThan(reserveAmount)) {
      throw new ApiError(
        400,
        `Insufficient ${reserveAsset} balance. ` +
        `Available: ${available.toString()}, Required: ${reserveAmount.toString()}`
      );
    }

    const newAvailable = available.minus(reserveAmount);
    const newLocked = locked.plus(reserveAmount);

    await tx.$executeRaw`
      UPDATE "Balance"
      SET
        available = ${newAvailable.toString()}::numeric,
        locked    = ${newLocked.toString()}::numeric,
        "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "asset" = ${reserveAsset}::"Asset"
    `;

    const order = await tx.order.create({
      data: {
        userId,
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: input.side,
        orderType: input.orderType,
        price:
          input.orderType === "LIMIT" && input.price != null
            ? new Decimal(input.price.toString())
            : null,
        quantity: new Decimal(input.quantity.toString()),
        filledQty: new Decimal("0"),
        status: "PENDING",
      },
    });

    await tx.ledgerEntry.create({
      data: {
        userId,
        asset: reserveAsset,
        amount: reserveAmount.negated(),
        type: "ORDER_LOCK",
        referenceId: order.id.toString(),
      },
    });

    const eventPayload = {
      eventId: crypto.randomUUID(),
      eventType: "ORDER_ACCEPTED" as const,
      orderId: order.id.toString(),
      userId: userId.toString(),
      symbol: input.symbol,
      side: input.side,
      orderType: input.orderType,

      price: order.price?.toString() ?? null,
      quantity: order.quantity.toString(),

      quoteBudget: input.quoteBudget != null
        ? new Decimal(input.quoteBudget.toString()).toString()
        : null,
      timestamp: Date.now(),
    };

    await tx.outboxEvent.create({
      data: {
        eventType: "ORDER_ACCEPTED",
        aggregateId: order.id.toString(),
        payload: eventPayload,
      },
    });

    return order;
  });

  return formatOrder(result);
};

export const cancelOrder = async (
  userId: number,
  orderIdValue: string
): Promise<CancelOrderResult> => {
  let orderId: bigint;
  try {
    orderId = BigInt(orderIdValue);
  } catch {
    throw new ApiError(400, "Invalid order ID");
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) throw new ApiError(404, "Order not found");
  if (order.userId !== userId) throw new ApiError(403, "You can only cancel your own orders");
  if (order.status !== "PENDING" && order.status !== "PARTIALLY_FILLED") {
    throw new ApiError(400, "Only open orders can be cancelled");
  }
  if (order.orderType === "MARKET") {
    throw new ApiError(400, "Market orders cannot be cancelled — they execute immediately");
  }

  const remainingQty = new Decimal(order.quantity.toString()).minus(
    new Decimal(order.filledQty.toString())
  );

  let releaseAsset: Asset;
  let releaseAmount: Decimal;

  if (order.side === "BUY") {

    if (order.price == null) throw new ApiError(500, "Limit buy order missing price");
    releaseAsset = "USD";
    releaseAmount = remainingQty.mul(new Decimal(order.price.toString()));
  } else {

    releaseAsset = "BTC";
    releaseAmount = remainingQty;
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {

    const freshOrder = await tx.order.findUnique({ where: { id: orderId } });
    if (!freshOrder) throw new ApiError(404, "Order not found");
    if (freshOrder.status !== "PENDING" && freshOrder.status !== "PARTIALLY_FILLED") {
      throw new ApiError(400, "Order is no longer open (race condition)");
    }

    const rows = await tx.$queryRaw<Array<{ available: string; locked: string }>>`
      SELECT available::text, locked::text
      FROM "Balance"
      WHERE "userId" = ${userId} AND "asset" = ${releaseAsset}::"Asset"
      FOR UPDATE
    `;

    if (rows.length === 0) throw new ApiError(404, `No ${releaseAsset} balance found`);
    const balRow = rows[0];
    if (!balRow) throw new ApiError(404, `No ${releaseAsset} balance found`);

    const available = new Decimal(balRow.available);
    const locked = new Decimal(balRow.locked);

    const newLocked = locked.minus(releaseAmount);
    const newAvailable = available.plus(releaseAmount);

    if (newLocked.lessThan(0)) {
      throw new ApiError(
        500,
        `Balance invariant violation: locked would go negative. ` +
        `locked=${locked}, release=${releaseAmount}`
      );
    }

    await tx.$executeRaw`
      UPDATE "Balance"
      SET
        available = ${newAvailable.toString()}::numeric,
        locked    = ${newLocked.toString()}::numeric,
        "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "asset" = ${releaseAsset}::"Asset"
    `;

    const cancelled = await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED" },
    });

    await tx.ledgerEntry.create({
      data: {
        userId,
        asset: releaseAsset,
        amount: releaseAmount, 
        type: "ORDER_UNLOCK",
        referenceId: orderId.toString(),
      },
    });

    return cancelled;
  });

  return formatOrder(updatedOrder);
};
