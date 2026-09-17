import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { errorHandler } from "./src/middlewares/errorHandler";

const app = express();

// ---------------------------- middlewares ----------------------------

app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

// ---------------------------- import routes ----------------------------

import user from "./src/routes/user.route.ts";
import exchange from "./src/routes/exchange.route.ts";

// ---------------------------- route declaration ----------------------------

app.use("/api/v1/users", user);
app.use("/api/v1/exchange", exchange);

// ---------------------------- error handler ----------------------------

app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 3001);

app.listen(PORT, () => {
  console.log(`server is listening to port: ${PORT}`);
});
