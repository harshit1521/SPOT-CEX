import "dotenv/config";
import { PrismaClient } from "../prisma/generated/client.js";
import { Redis } from "@upstash/redis";

import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const STREAM = "cex:order-events";
const BATCH_SIZE = 20;

async function main() {
  await redis.connect();

  try {
    await redis.xGroupCreate(STREAM, "matching-engine", "$", {
      MKSTREAM: true,
    });
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) {
      throw err;
    }
  }

  console.log("[outbox] Worker started");

  while (true) {
    try {
      const events = await prisma.outboxEvent.findMany({
        where: {
          processedAt: null,
        },
        orderBy: {
          id: "asc",
        },
        take: BATCH_SIZE,
      });

      if (events.length === 0) {
        continue;
      }

      for (const event of events) {
        await redis.xAdd(STREAM, "*", {
          data: JSON.stringify(event.payload),
        });

        await prisma.outboxEvent.update({
          where: {
            id: event.id,
          },
          data: {
            processedAt: new Date(),
          },
        });

        console.log(
          `[outbox] Published ${event.eventType} (${event.aggregateId})`
        );
      }
    } catch (err) {
      console.error("[outbox] Error:", err);
    }
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await redis.quit();
  });