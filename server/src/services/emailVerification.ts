import crypto from "crypto";
import { prisma } from "../utils/db";
import { resend } from "../utils/resend.ts";

const generateVerificationToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

const hashVerificationToken = (token: string): string => {
    return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

const sendVerificationEmail =  async ( userId: number, email: string ) => {

    const token = generateVerificationToken();
    const tokenHash = hashVerificationToken(token);
  
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  
    // Store ONLY the hash in your database.
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  
    const verificationUrl =
      `${process.env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  
    const { data, error } = await resend.emails.send({
      from: "SPOT-CEX <no-reply@yourdomain.com>",
      to: [email],
      subject: "Verify your email address",
      html: `
        <div>
          <h2>Verify your email</h2>
  
          <p>
            Thanks for signing up. Please verify your email address
            by clicking the button below.
          </p>
  
          <p>
            <a
              href="${verificationUrl}"
              style="
                display:inline-block;
                padding:12px 20px;
                background:#000;
                color:#fff;
                text-decoration:none;
                border-radius:6px;
              "
            >
              Verify email
            </a>
          </p>
  
          <p>
            This link expires in 15 minutes.
          </p>
  
          <p>
            If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      `,
    });
  
    if (error) {
      // Ideally delete the token or mark the delivery attempt as failed.
      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  
    return {
      emailId: data?.id,
    };
  }

export { generateVerificationToken, hashVerificationToken, sendVerificationEmail};