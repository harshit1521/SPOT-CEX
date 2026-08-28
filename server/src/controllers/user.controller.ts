import bcrypt from "bcrypt";
import crypto from "crypto"
import jwt from "jsonwebtoken";
import { prisma } from "../utils/db.ts";
import { resend } from "../utils/resend.ts";
import { ApiError } from "../utils/ApiError.ts";
import type { Response, Request } from "express";
import { ApiResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { generateTokens } from "../services/tokenService.ts"
import { signUp, signIn, password } from "../schemas/user.schema.ts";
import { generateVerificationToken } from "../services/emailVerification.ts";
import { hashVerificationToken, sendVerificationEmail } from "../services/emailVerification.ts";
import { tr } from "zod/locales";
import { ref } from "process";


const user = {

    signUp: asyncHandler(async (req: Request, res: Response) => {

        // validate and normalize input 
        const result = signUp.safeParse(req.body);
        if (!result.success) {
            throw new ApiError(
                400,
                "Validation failed",
                result.error.issues.map((issue) => issue.message)
            );
        }

        // extract signup details 
        const { username, email, password } = result.data;

        // validate user 
        const checkUser = await prisma.user.findUnique({ where: { email: email } });
        if (checkUser) throw new ApiError(409, "user already exists !");

        // hash pass
        const hashPass = await bcrypt.hash(password, 12);

        // create user with provided credentials 
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashPass,
            },
            select: { id: true, username: true, email: true, emailVerified: true, createdAt: true }
        })

        // send verification email
        // const { emailId } = await sendVerificationEmail(user.id, email);

        // return secure response 
        res
            .status(200)
            .json(new ApiResponse(200, "User created successfully"))

    }),

    signIn: asyncHandler(async (req: Request, res: Response) => {

        // validate and normalize input 
        const result = signIn.safeParse(req.body);
        if (!result.success) {
            throw new ApiError(
                400,
                "Validation failed",
                result.error.issues.map((issue) => issue.message)
            );
        }

        // extract signIn details 
        const { email, password } = result.data;

        // validate user 
        const user = await prisma.user.findUnique({
            where: {
                email: email,
            },
            select: { id: true, emailVerified: true, password: true }
        })

        if (!user) throw new ApiError(401, "User doesnt exists !!!");

        // if(!user?.emailVerified) throw new ApiError(403, "verify your email first !!!");

        // verify user password 
        const verifyPass = await bcrypt.compare(password, user.password);
        if (!verifyPass) throw new ApiError(401, "Invalid Password !!!");

        // generate tokens
        const { refreshToken, accessToken } = generateTokens(user.id);

        // hash refresh token 
        const hashedToken = await bcrypt.hash(refreshToken, 12);

        // save hashed refresh token in db
        const updatedUser = await prisma.user.update({
            where: {
                id: user.id
            },
            data: {
                refreshToken: hashedToken
            },
            select: { id: true, username: true, email: true }
        })

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        }

        // set secure cookie and return success response 
        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    {
                        user: updatedUser,
                    },
                    "user logged in successfully"
                )
            )

    }),

    // now these are authenticated controllers 

    logOut: asyncHandler(async (req: Request, res: Response) => {

        // fetch userId 
        const userId = req.user?.id;

        // revoke curr refresh token
        await prisma.user.update({

            where: {
                id: userId
            },
            data: {
                refreshToken: undefined
            }

        })

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        }

        // clear tokens and return secure response 
        return res
            .status(200)
            .clearCookie("accessToken", options)
            .clearCookie("refreshToken", options)
            .json(
                new ApiResponse(200, "User logged out")
            )
    }),

    changePassword: asyncHandler(async (req: Request, res: Response) => {

        const userId = req.user?.id;
        if (!userId) throw new ApiError(401, "Unauthorized !!!");

        // validate and normalize input 
        const result = password.safeParse(req.body);
        if (!result.success) throw new ApiError(
            400,
            "Validation failed !!",
            result.error.issues.map(issue => issue.message)
        )

        // extract input
        const { oldPassword, newPassword } = result.data;

        // fetch authenticated user 
        const user = await prisma.user.findUnique({
            where: {
                id: userId
            },
            select: { id: true, password: true }
        })

        if (!user) throw new ApiError(401, "Unauthorized !!!");

        // verify current pass 
        const isPassValid = await bcrypt.compare(oldPassword, user?.password);
        if (!isPassValid) throw new ApiError(401, "Invalid Password");

        // hash new pass
        const hashPass = await bcrypt.hash(newPassword, 12);

        // rotate tokens 
        const { accessToken, refreshToken } = generateTokens(userId!);

        // hash refresh token
        const hashedToken = await bcrypt.hash(refreshToken, 12);

        // update user data 
        await prisma.user.update({
            where: {
                id: userId,
            },
            data: {
                password: hashPass,
                refreshToken: hashedToken
            }
        })

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict" as const
        }

        // return safe response 
        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(
                new ApiResponse(200, "Password updated successfully !!!")
            )
    }),

    refreshToken: asyncHandler(async ( req: Request, res: Response ) => {

        

    }),

    me: asyncHandler(async (req: Request, res: Response) => {

        const { id, email, username } = req.user!;

        return res.status(200).json(
            new ApiResponse(
                200,
                { id, email, username },
                "Fetched user details successfully"
            )
        );
    }),

    verifyEmail: asyncHandler(async (req: Request, res: Response) => {

        const { token } = req.query;

        if (typeof token !== "string" || !token) {
            throw new ApiError(400, "Verification token is required");
        }

        const tokenHash = hashVerificationToken(token);

        const verification =
            await prisma.emailVerificationToken.findUnique({
                where: {
                    tokenHash,
                },
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
                where: {
                    id: verification.userId,
                },
                data: {
                    emailVerified: true,
                },
            }),

            prisma.emailVerificationToken.update({
                where: {
                    id: verification.id,
                },
                data: {
                    usedAt: new Date(),
                },
            }),
        ]);

        return res.status(200).json({
            success: true,
            message: "Email verified successfully",
        });
    }),
}

export default user;