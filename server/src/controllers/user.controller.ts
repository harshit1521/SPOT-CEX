import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import type { Response, Request } from "express";
import { prisma } from "../utils/db.ts";
import { ApiError } from "../utils/ApiError.ts";
import { ApiResponse } from "../utils/ApiResponse.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { cookieOptions } from "../utils/cookies.ts";
import { generateTokens } from "../services/tokenService.ts";
import { signUp, signIn, password } from "../schemas/user.schema.ts";
import { hashVerificationToken, sendVerificationEmail } from "../services/emailVerification.ts";
import { STARTING_BALANCES } from "../constants/balances.ts";

interface RefreshTokenPayload extends JwtPayload {
  id: number;
}

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
  return res
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions);
};

const clearAuthCookies = (res: Response) => {
  return res
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions);
};

const persistRefreshToken = async (userId: number, refreshToken: string) => {
  const hashedToken = await bcrypt.hash(refreshToken, 12);

  return prisma.user.update({
    where: { id: userId },
    data: { refreshToken: hashedToken },
    select: { id: true, username: true, email: true },
  });
};

const user = {
  signUp: asyncHandler(async (req: Request, res: Response) => {
    const result = signUp.safeParse(req.body);
    if (!result.success) {
      throw new ApiError(
        400,
        "Validation failed",
        result.error.issues.map((issue) => issue.message)
      );
    }

    const { username, email, password } = result.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, "User already exists");

    const hashPass = await bcrypt.hash(password, 12);

    const createdUser = await prisma.$transaction(async (tx) => {
      const userRow = await tx.user.create({
        data: {
          username,
          email,
          password: hashPass,
        },
        select: {
          id: true,
          username: true,
          email: true,
          emailVerified: true,
          createdAt: true,
        },
      });

      await tx.balance.createMany({
        data: [
          {
            userId: userRow.id,
            asset: "USD",
            available: STARTING_BALANCES.USD,
          },
          {
            userId: userRow.id,
            asset: "BTC",
            available: STARTING_BALANCES.BTC,
          },
        ],
      });

      return userRow;
    });

    await sendVerificationEmail(createdUser.id, email);

    return res.status(201).json(
      new ApiResponse(
        201,
        { email: createdUser.email },
        "User created. Check your email to verify your account."
      )
    );
  }),

  signIn: asyncHandler(async (req: Request, res: Response) => {
    const result = signIn.safeParse(req.body);
    if (!result.success) {
      throw new ApiError(
        400,
        "Validation failed",
        result.error.issues.map((issue) => issue.message)
      );
    }

    const { email, password } = result.data;

    const found = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true, password: true },
    });

    if (!found) throw new ApiError(401, "Invalid email or password");

    if (!found.emailVerified) {
      throw new ApiError(403, "Verify your email before signing in");
    }

    const passwordOk = await bcrypt.compare(password, found.password);
    if (!passwordOk) throw new ApiError(401, "Invalid email or password");

    const { refreshToken, accessToken } = generateTokens(found.id);
    const updatedUser = await persistRefreshToken(found.id, refreshToken);

    return setAuthCookies(res, accessToken, refreshToken)
      .status(200)
      .json(new ApiResponse(200, { user: updatedUser }, "User logged in successfully"));
  }),

  logOut: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, "Unauthorized");

    await prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    return clearAuthCookies(res)
      .status(200)
      .json(new ApiResponse(200, null, "User logged out"));
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError(401, "Unauthorized");

    const result = password.safeParse(req.body);
    if (!result.success) {
      throw new ApiError(
        400,
        "Validation failed",
        result.error.issues.map((issue) => issue.message)
      );
    }

    const { oldPassword, newPassword } = result.data;

    const found = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!found) throw new ApiError(401, "Unauthorized");

    const isPassValid = await bcrypt.compare(oldPassword, found.password);
    if (!isPassValid) throw new ApiError(401, "Invalid password");

    const hashPass = await bcrypt.hash(newPassword, 12);
    const { accessToken, refreshToken } = generateTokens(userId);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashPass,
        refreshToken: await bcrypt.hash(refreshToken, 12),
      },
    });

    return setAuthCookies(res, accessToken, refreshToken)
      .status(200)
      .json(new ApiResponse(200, null, "Password updated successfully"));
  }),

  refreshToken: asyncHandler(async (req: Request, res: Response) => {
    const incoming = req.cookies?.refreshToken as string | undefined;
    if (!incoming) throw new ApiError(401, "Refresh token missing");

    const secret = process.env.REFRESH_TOKEN_SECRET;
    if (!secret) throw new ApiError(500, "REFRESH_TOKEN_SECRET is not configured");

    let decoded: RefreshTokenPayload;
    try {
      decoded = jwt.verify(incoming, secret) as RefreshTokenPayload;
    } catch {
      throw new ApiError(401, "Invalid or expired refresh token");
    }

    const found = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, refreshToken: true, username: true, email: true },
    });

    if (!found?.refreshToken) {
      throw new ApiError(401, "Refresh token is not valid");
    }

    const matches = await bcrypt.compare(incoming, found.refreshToken);
    if (!matches) throw new ApiError(401, "Refresh token is not valid");

    const { accessToken, refreshToken } = generateTokens(found.id);
    await persistRefreshToken(found.id, refreshToken);

    return setAuthCookies(res, accessToken, refreshToken)
      .status(200)
      .json(
        new ApiResponse(
          200,
          { user: { id: found.id, username: found.username, email: found.email } },
          "Tokens refreshed"
        )
      );
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const { id, email, username } = req.user!;

    return res.status(200).json(
      new ApiResponse(200, { id, email, username }, "Fetched user details successfully")
    );
  }),

  verifyEmail: asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.query;

    if (typeof token !== "string" || !token) {
      throw new ApiError(400, "Verification token is required");
    }

    const tokenHash = hashVerificationToken(token);

    const verification = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verification) {
      throw new ApiError(400, "Invalid verification token");
    }

    if (verification.expiresAt < new Date()) {
      throw new ApiError(400, "Verification token has expired");
    }

    if (verification.usedAt) {
      throw new ApiError(400, "Verification token has already been used");
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerified: true },
      }),
      prisma.emailVerificationToken.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return res.status(200).json(
      new ApiResponse(200, null, "Email verified successfully")
    );
  }),
};

export default user;
