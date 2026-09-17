import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../prisma/generated/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

const adapter = new PrismaPg({
  connectionString: connectionString.replace(
    /([?&])sslmode=require\b/g,
    "$1sslmode=verify-full"
  ),
});

export const prisma = new PrismaClient({ adapter });