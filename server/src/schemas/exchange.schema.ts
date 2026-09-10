import { z } from "zod";

const createOrder = z
  .object({
    side: z.enum(["BUY", "SELL"]),
    type: z.enum(["LIMIT", "MARKET"]),
    symbol: z.string().trim().toUpperCase().min(1, "Symbol is required"),
    price: z.number().positive("Price must be greater than 0").optional().nullable(),
    qty: z.number().positive("Quantity must be greater than 0"),
  })
  .superRefine((data, ctx) => {
    if (data.type === "LIMIT" && (data.price == null || data.price <= 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Price is required for limit orders",
        path: ["price"],
      });
    }

    if (data.type === "MARKET" && data.price != null) {
      ctx.addIssue({
        code: "custom",
        message: "Price must not be set for market orders",
        path: ["price"],
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
