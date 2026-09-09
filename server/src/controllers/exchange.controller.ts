import type { Request, Response } from "express";
import type { Asset } from "../../prisma/generated/client.ts";
import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";
import { ApiResponse } from "../utils/ApiResponse.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { createOrder, orderIdParam, symbolParam } from "../schemas/exchange.schema.ts";
import {
  cancelOrder,
  getMarketDepth,
  getOpenOrders,
  getOrderById,
  getUserFills,
  placeOrder,
} from "../services/engine.service.ts";

type BalanceView = {
  available: string;
  locked: string;
};

const toBalanceView = (available: { toString(): string }, locked: { toString(): string }): BalanceView => ({
  available: available.toString(),
  locked: locked.toString(),
});

const getUserBalances = async (userId: number): Promise<Record<Asset, BalanceView>> => {
  const balances = await prisma.balance.findMany({
    where: { userId },
  });

  const result: Partial<Record<Asset, BalanceView>> = {};

  for (const balance of balances) {
    result[balance.asset] = toBalanceView(balance.available, balance.locked);
  }

  return {
    USD: result.USD ?? { available: "0", locked: "0" },
    BTC: result.BTC ?? { available: "0", locked: "0" },
  };
};

const exchange = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const parsed = createOrder.safeParse(req.body);

    if (!parsed.success) {
      throw new ApiError(
        400,
        "Validation failed",
        parsed.error.issues.map((issue) => issue.message)
      );
    }

    const userId = req.user!.id;
    const { side, type, symbol, price, qty } = parsed.data;

    const result = await placeOrder(userId, {
      side,
      type,
      symbol,
      price: type === "LIMIT" ? price ?? null : null,
      qty,
    });

    return res.status(200).json(
      new ApiResponse(200, result, "Order placed successfully")
    );
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

    const order = await getOrderById(req.user!.id, parsed.data.orderId);

    return res.status(200).json(
      new ApiResponse(200, order, "Order fetched successfully")
    );
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

    const order = await cancelOrder(req.user!.id, parsed.data.orderId);

    return res.status(200).json(
      new ApiResponse(200, order, "Order cancelled successfully")
    );
  }),

  balance: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const balances = await getUserBalances(userId);

    return res.status(200).json(
      new ApiResponse(200, balances, "Balances fetched successfully")
    );
  }),

  usd: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const balance = await prisma.balance.findUnique({
      where: {
        userId_asset: {
          userId,
          asset: "USD",
        },
      },
    });

    if (!balance) {
      throw new ApiError(404, "USD balance not found");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        toBalanceView(balance.available, balance.locked),
        "USD balance fetched successfully"
      )
    );
  }),

  open: asyncHandler(async (req: Request, res: Response) => {
    const orders = await getOpenOrders(req.user!.id);

    return res.status(200).json(
      new ApiResponse(200, orders, "Open orders fetched successfully")
    );
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

    const depth = await getMarketDepth(parsed.data.symbol);

    return res.status(200).json(
      new ApiResponse(200, depth, "Depth fetched successfully")
    );
  }),

  fills: asyncHandler(async (req: Request, res: Response) => {
    const fills = await getUserFills(req.user!.id);

    return res.status(200).json(
      new ApiResponse(200, fills, "Fills fetched successfully")
    );
  }),
};

export default exchange;
