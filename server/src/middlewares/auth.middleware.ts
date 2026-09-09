import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { prisma } from "../utils/db"
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

interface AccessTokenPayload extends JwtPayload {
    id: number;
}

const authMiddleware = asyncHandler(
    async (req: Request, res: Response, next: NextFunction) => {
        const token =
            req.cookies?.accessToken ||
            req.header("Authorization")?.replace("Bearer ", "");

        if (!token) {
            throw new ApiError(401, "Unauthorized request");
        }

        const decodedToken = jwt.verify(
            token,
            process.env.ACCESS_TOKEN_SECRET as string
        ) as AccessTokenPayload;

        const user = await prisma.user.findUniqueOrThrow({
            where: {
                id: decodedToken.id,
            },
            select: { id: true, username: true, email: true },
        });

        req.user = user;

        next();
    }
);

export default authMiddleware;