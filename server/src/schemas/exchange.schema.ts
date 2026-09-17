import { z } from "zod";

/**
 * 
 * clientOrderId  — caller-generated idempotency key.
 *                  DB enforces unique(userId, clientOrderId) so a retry
 *                  with the same key never creates a duplicate order.
 *
 * quoteBudget    — required for MARKET BUY only.
 *                  The full amount is locked in USD upfront; unused
 *                  budget is released by the settlement consumer.
 */
const createOrder = z.object({
  clientOrderId: z
    .string()
    .trim()
    .min(1, "clientOrderId is required")
    .max(128, "clientOrderId must be at most 128 characters"),

  side: z.enum(["BUY", "SELL"]),

  orderType: z.enum(["LIMIT", "MARKET"]),

  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Symbol is required"),

  price: z
    .number()
    .positive("Price must be greater than 0")
    .optional()
    .nullable(),

  quantity: z
    .number()
    .positive("Quantity must be greater than 0"),

  /**
   * quoteBudget — MARKET BUY only.
   * The matching engine will spend up to this much USD.
   * Any unused portion is returned to the buyer's available balance
   * during settlement.
   */
  quoteBudget: z
    .number()
    .positive("Quote budget must be greater than 0")
    .optional()
    .nullable(),
})
  .superRefine((data, ctx) => {
    // LIMIT orders require a positive price
    if (data.orderType === "LIMIT" && (data.price == null || data.price <= 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Price is required for LIMIT orders",
        path: ["price"],
      });
    }

    // MARKET orders must NOT carry a price
    if (data.orderType === "MARKET" && data.price != null) {
      ctx.addIssue({
        code: "custom",
        message: "Price must not be set for MARKET orders",
        path: ["price"],
      });
    }

    // MARKET BUY must supply quoteBudget (maximum USD to spend)
    if (
      data.orderType === "MARKET" &&
      data.side === "BUY" &&
      (data.quoteBudget == null || data.quoteBudget <= 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "quoteBudget (max USD spend) is required for MARKET BUY orders",
        path: ["quoteBudget"],
      });
    }

    // MARKET SELL must NOT supply quoteBudget
    if (data.orderType === "MARKET" && data.side === "SELL" && data.quoteBudget != null) {
      ctx.addIssue({
        code: "custom",
        message: "quoteBudget must not be set for MARKET SELL orders",
        path: ["quoteBudget"],
      });
    }
  });


const symbolParam = z.object({
  symbol: z.string().trim().toUpperCase().min(1, "Symbol is required"),
});

const orderIdParam = z.object({
  orderId: z.string().trim().min(1, "Order ID is required"),
});

export { createOrder, symbolParam, orderIdParam };
