import crypto from "crypto";

const generateVerificationToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

export { generateVerificationToken };