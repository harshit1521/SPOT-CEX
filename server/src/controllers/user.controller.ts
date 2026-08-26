import type { Response, Request } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto"
import { signUp, signIn, password } from "../schemas/user.schema.ts";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/ApiError.ts";
import { ApiResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { prisma } from "../utils/db.ts";
import { generateVerificationToken } from "../services/emailVerification.ts";
import { resend } from "../utils/resend.ts";
import { hashVerificationToken, sendVerificationEmail } from "../services/emailVerification.ts";
import { z } from "zod";

const user = {

    signUp: asyncHandler(async (req: Request, res: Response) => {


        // 1. validate and normalize input 
        // 2. receive signup details 
        // 3. check if user already exists or not , if does then throw error
        // 5. hash password 
        // 5. CREATE AN UNVERIFIED USER IN DB 
        // 6. GENERATE VERIFICATION TOKEN
        // 7. SEND VERIFICATION EMAIL
        // 8. RETURN SAFE RESPONSE TO CLIENT


        // step 1 done
        const result = signUp.safeParse(req.body);
        if (!result.success) throw new ApiError(400, "Validation failed", z.flattenError(result.error));

        // step 2 
        const { username, email, password } = result.data;

        // step 3
        const checkUser = await prisma.user.findUnique({ where: { email: email } });
        if (checkUser) throw new ApiError(409, "user already exists !");

        // step 4
        const hashPass = await bcrypt.hash(password, 12);

        // step 5 
        const user = await prisma.user.create({
            data: {
                username,
                email,
                password: hashPass,
            },
            select: { id: true, username: true, email: true, emailVerified: true, createdAt: true }
        })

        const { emailId } = await sendVerificationEmail(user.id, email);

        res
            .status(200)
            .json(new ApiResponse(200,{ emailId } , "User created successfully"))

    }),

    signIn: () => {

        // 1. validate and normalize input 
        // 2. extract signIn details 
        // 3. validate if user exists or not , if doesnt throw error 
        // 4. verify password , doesnt match => throw error 
        // 5. generate refresh and access token 
        // 6. store refresh token in db 
        // 7. set secure http cookie 
        // 8. return success response 
    },

    // now these are authenticated controllers 

    logOut: () => {

        // 1. simply fetch userId from req.user via auth middleware 
        // 2. revoke current refresh session 
        // 3. clear access and refresh token 
        // 4. return success response 
    },

    changePassword: () => {

        // 1. Authenticate request
        // 2. Validate and normalize input
        // 3. Extract currentPassword + newPassword
        // 4. Fetch authenticated user
        // 5. Verify current password
        // 6. Validate new password
        // 7. Hash new password
        // 8. Save new password to DB
        // 9. Revoke existing refresh sessions
        // 10. Establish a new session / rotate tokens if desired
        // 11. Set secure cookies
        // 12. Return success response
    },

    refreshToken: () => {

    },

    me: () => {

        // 1. authenticate user 
        // 2. get userId from req.user 
        // 3. fetch current user 
        // 4. remove sensitive fields 
        // 5. return user 

    },

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
    });
}

export default user;