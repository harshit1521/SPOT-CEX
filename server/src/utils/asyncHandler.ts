import { Request, Response, NextFunction, RequestHandler } from "express";

const asyncHandler = (
  requestHandler: RequestHandler
): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    return Promise.resolve(
      requestHandler(req, res, next)
    ).catch((err: unknown) => {
      next(err);
    });
  };
};

export { asyncHandler };