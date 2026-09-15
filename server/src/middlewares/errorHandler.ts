import type { Request, Response, NextFunction } from "express";
import { Prisma } from "../../prisma/generated/client.ts";
import { ApiError } from "../utils/ApiError.ts";

const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const fields = (err.meta?.target as string[] | undefined)?.join(", ") ?? "field";

    res.status(409).json({
      success: false,
      message: `Already in use: ${fields}`,
      errors: [],
    });
    return;
  }

  const apiError = err as ApiError;
  const statusCode = apiError.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: apiError.message || "Something went wrong",
    errors: apiError.errors || [],
  });
};

export { errorHandler };