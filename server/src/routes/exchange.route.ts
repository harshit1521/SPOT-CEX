import { Router } from "express";
import exchange from "../controllers/exchange.controller.ts";
import authMiddleware from "../middlewares/auth.middleware.ts";
const router = Router();

router.use(authMiddleware);

router
    .get("/balance/usd", exchange.usd )
    .get("/balance/", exchange.balance )
    .get("/depth/:symbol", exchange.depth )
    .get("/order/:orderId", exchange.order )
    .get("/order/open", exchange.open)
    .get("/fills", exchange.fills)
    .post("/order", exchange.create)
    .delete("/order/:orderId", exchange.close) 


export default router;