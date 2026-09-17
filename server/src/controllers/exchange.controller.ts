import type { Request, Response } from "express";
import type { Asset } from "../../prisma/generated/client.ts";
import { Prisma } from "../../prisma/generated/client.ts";
import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";
import { ApiResponse } from "../utils/ApiResponse.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { createOrder, orderIdParam, symbolParam } from "../schemas/exchange.schema.ts";

type BalanceView = { available: string; locked: string };

const toBalanceView = (
  available: { toString(): string },
  locked: { toString(): string }
): BalanceView => ({
  available: available.toString(),
  locked: locked.toString(),
});


const exchange = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = createOrder.safeParse(req.body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "Validation failed",
        parsed.error.issues.map(i => i.message)
      );
    }

    const {
      clientOrderId,
      side,
      orderType,
      symbol,
      price,
      quantity,
      quoteBudget,
    } = parsed.data;

    const userId = req.user!.id;

    // Reservation
    const [base, quote] = symbol.split("/");

    const reserveAsset = (side === "SELL" ? base : quote) as Asset;

    const reserveAmount =
      side === "SELL"
        ? quantity
        : orderType === "LIMIT"
          ? quantity * price!
          : quoteBudget!;

    try {
      const order = await prisma.$transaction(async tx => {
        const [balance] = await tx.$queryRaw<
          { available: string; locked: string }[]
        >`
        SELECT available::text, locked::text
        FROM "Balance"
        WHERE "userId" = ${userId}
          AND "asset" = ${reserveAsset}::"Asset"
        FOR UPDATE
      `;

        if (!balance) {
          throw new ApiError(
            404,
            `No ${reserveAsset} balance found for user`
          );
        }

        const available = Number(balance.available);
        const locked = Number(balance.locked);

        if (available < reserveAmount) {
          throw new ApiError(
            400,
            `Insufficient ${reserveAsset} balance. ` +
            `Available: ${available}, Required: ${reserveAmount}`
          );
        }

        await tx.$executeRaw`
        UPDATE "Balance"
        SET
          available = ${available - reserveAmount},
          locked = ${locked + reserveAmount},
          "updatedAt" = NOW()
        WHERE "userId" = ${userId}
          AND "asset" = ${reserveAsset}::"Asset"
      `;

        const order = await tx.order.create({
          data: {
            userId,
            clientOrderId,
            symbol,
            side,
            orderType,
            price: price ?? null,
            quantity,
            filledQty: 0,
            status: "PENDING",
          },
        });

        await tx.ledgerEntry.create({
          data: {
            userId,
            asset: reserveAsset,
            amount: -reserveAmount,
            type: "ORDER_LOCK",
            referenceId: String(order.id),
          },
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "ORDER_ACCEPTED",
            aggregateId: String(order.id),
            payload: {
              eventId: crypto.randomUUID(),
              eventType: "ORDER_ACCEPTED",
              orderId: String(order.id),
              userId: String(userId),
              symbol,
              side,
              orderType,
              price: price ?? null,
              quantity,
              quoteBudget: quoteBudget ?? null,
              timestamp: Date.now(),
            },
          },
        });

        return order;
      });

      return res
        .status(201)
        .json(new ApiResponse(201, order, "Order placed successfully"));

    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existingOrder = await prisma.order.findUnique({
          where: {
            userId_clientOrderId: {
              userId,
              clientOrderId,
            },
          },
        });

        if (existingOrder) {
          return res
            .status(200)
            .json(
              new ApiResponse(
                200,
                existingOrder,
                "Order already exists (idempotent)"
              )
            );
        }
      }

      throw err;
    }
  }),

  order: asyncHandler(async (req: Request, res: Response) => {
    const parsed = orderIdParam.safeParse(req.params);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "Validation failed",
        parsed.error.issues.map((issue) => issue.message)
      );
    }

    const order = await prisma.order.findUnique({ where: { id: parseInt(parsed.data.orderId) } });

    if (!order) throw new ApiError(404, "Order not found");
    if (order.userId !== req.user!.id) throw new ApiError(403, "You can only view your own orders");

    return res.status(200).json(new ApiResponse(200, order, "Order fetched successfully"));
  }),

  close: asyncHandler(async (req: Request, res: Response) => {
    const parsed = orderIdParam.safeParse(req.params);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "Validation failed",
        parsed.error.issues.map((issue) => issue.message)
      );
    }

    let userId = req.user!.id;
    let orderId = parseInt(parsed.data.orderId);

    // Find order
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      throw new ApiError(404, "Order not found");
    }

    // Check owner
    if (order.userId !== userId) {
      throw new ApiError(403, "You can only cancel your own orders");
    }

    // Check status
    if (
      order.status !== "PENDING" &&
      order.status !== "PARTIALLY_FILLED"
    ) {
      throw new ApiError(400, "Order cannot be cancelled");
    }

    // Market orders cannot be cancelled
    if (order.orderType === "MARKET") {
      throw new ApiError(400, "Market orders cannot be cancelled");
    }

    // Calculate remaining quantity
    const remainingQty =
      Number(order.quantity) - Number(order.filledQty);

    // Decide which asset to unlock
    let asset: Asset;
    let amount;

    if (order.side === "BUY") {
      asset = "USD";
      amount = remainingQty * Number(order.price);
    } else {
      asset = "BTC";
      amount = remainingQty;
    }

    // Update everything together
    const cancelledOrder = await prisma.$transaction(async (tx) => {

      // Find user's balance
      const balance = await tx.balance.findUnique({
        where: {
          userId_asset: {
            userId: userId,
            asset: asset
          }
        }
      });

      if (!balance) {
        throw new ApiError(404, "Balance not found");
      }

      // Update everything together
      const cancelledOrder = await prisma.$transaction(async (tx) => {

        // Find user's balance
        const balance = await tx.balance.findUnique({
          where: {
            userId_asset: {
              userId: userId,
              asset: asset
            }
          }
        });

        if (!balance) {
          throw new ApiError(404, "Balance not found");
        }

        // Unlock the money/asset
        await tx.balance.update({
          where: {
            userId_asset: {
              userId: userId,
              asset: asset
            }
          },
          data: {
            available: Number(balance.available) + amount,
            locked: Number(balance.locked) - amount
          }
        });

        // Cancel order
        const updatedOrder = await tx.order.update({
          where: {
            id: orderId
          },
          data: {
            status: "CANCELLED"
          }
        });

        // Record unlock
        await tx.ledgerEntry.create({
          data: {
            userId: userId,
            asset: asset,
            amount: amount,
            type: "ORDER_UNLOCK",
            referenceId: orderId.toString()
          }
        });

        return updatedOrder;
      });

      return res.status(200).json(new ApiResponse(200, cancelledOrder, "Order cancelled successfully"));
    });
  }),

  balance: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const balances = await prisma.balance.findMany({ where: { userId } });

    const result: Partial<Record<Asset, BalanceView>> = {};

    for (const balance of balances) {
      result[balance.asset] = toBalanceView(
        balance.available,
        balance.locked
      );
    }

    const Balance = {
      USD: result.USD ?? { available: "0", locked: "0" },
      BTC: result.BTC ?? { available: "0", locked: "0" },
    };

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          Balance,
          "Balances fetched successfully"
        )
      );
  }),

  usd: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const balance = await prisma.balance.findUnique({
      where: { userId_asset: { userId, asset: "USD" } },
    });

    if (!balance) throw new ApiError(404, "USD balance not found");

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          toBalanceView(balance.available, balance.locked),
          "USD balance fetched successfully"
        )
      );
  }),

  open: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const orders = await prisma.order.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "PARTIALLY_FILLED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json(new ApiResponse(200, orders, "Open orders fetched successfully"));
  }),

  depth: asyncHandler(async (req: Request, res: Response) => {
    const parsed = symbolParam.safeParse(req.params);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "Validation failed",
        parsed.error.issues.map((issue) => issue.message)
      );
    }
    const symbol = parsed.data.symbol;

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

    const depth = {
      symbol,
      bids: bids.map((r) => ({ price: r.price, quantity: r.quantity })),
      asks: asks.map((r) => ({ price: r.price, quantity: r.quantity })),
    };

    return res.status(200).json(new ApiResponse(200, depth, "Depth fetched successfully"));
  }),

  fills: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

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

    const Trades = trades.map((trade) => ({
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

    return res.status(200).json(new ApiResponse(200, Trades, "Trades fetched successfully"));
  }),
};

export default exchange;