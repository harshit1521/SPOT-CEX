import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser"
import { errorHandler } from "./src/middlewares/errorHandler";

const app = express();

// ---------------------------- middlewares ----------------------------

app.use( cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());

// ---------------------------- import routes ----------------------------



// ---------------------------- route declaration ----------------------------


// ---------------------------- error handler ----------------------------

app.use(errorHandler);
app.listen(3000, () => { console.log(`server is listening to port: 3000`) })