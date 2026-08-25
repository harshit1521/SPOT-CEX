import crypto from "crypto";

const generateVerificationToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

const hasVerificationToken = (token: string): string => {
    return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

export { generateVerificationToken, hasVerificationToken};