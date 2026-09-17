import { z } from "zod";

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

  // quoteBudget — MARKET BUY only.
  quoteBudget: z
    .number()
    .positive("Quote budget must be greater than 0")
    .optional()
    .nullable(),
})


const symbolParam = z.object({
  symbol: z.string().trim().toUpperCase().min(1, "Symbol is required"),
});

const orderIdParam = z.object({
  orderId: z.string().trim().min(1, "Order ID is required"),
});

export { createOrder, symbolParam, orderIdParam };
