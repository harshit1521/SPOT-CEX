import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.ts";

const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message,
    errors: err.errors || [],
  });
};

export { errorHandler };