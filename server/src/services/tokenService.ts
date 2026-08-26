import jwt from "jsonwebtoken";

const generateRefreshToken = (userId: number): string => {
    const secret = process.env.REFRESH_TOKEN_SECRET;

    if (!secret) {
        throw new Error("REFRESH_TOKEN_SECRET is not configured");
    }

    const expiresIn =
        (process.env.REFRESH_TOKEN_EXPIRY ?? "10D") as SignOptions["expiresIn"];

    return jwt.sign(
        {
            id: userId,
        },
        secret,
        {
            expiresIn,
        }
    );
};

const generateAccessToken = (userId: number): string => {
    const secret = process.env.ACCESS_TOKEN_SECRET;

    if (!secret) {
        throw new Error("ACCESS_TOKEN_SECRET is not configured");
    }

    const expiresIn =
        (process.env.ACCESS_TOKEN_EXPIRY ?? "1D") as SignOptions["expiresIn"];

    return jwt.sign(
        {
            id: userId,
        },
        secret,
        {
            expiresIn,
        }
    );
};

const generateTokens = (userId: number) => {
    const accessToken = generateAccessToken(userId);
    const refreshToken = generateRefreshToken(userId);

    return {
        accessToken,
        refreshToken,
    };
};

export {
    generateAccessToken,
    generateRefreshToken,
    generateTokens,
};