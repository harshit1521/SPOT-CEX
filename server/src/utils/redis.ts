import { createClient, type RedisClientType } from "redis";

export const STREAMS = {
  ORDER_EVENTS: "cex:order-events",
  EXECUTION_EVENTS: "cex:execution-events",
} as const;

let _client: RedisClientType | null = null;

export const getRedis = async (): Promise<RedisClientType> => {
  if (_client?.isOpen) {
    return _client;
  }

  const url = process.env.REDIS_URL ?? "redis://localhost:6379";

  _client = createClient({ url }) as RedisClientType;

  _client.on("error", (err: unknown) => {
    console.error("[redis] client error:", err);
  });

  await _client.connect();
  return _client;
};

export const publishJson = async (stream: string, payload: Record<string, unknown>): Promise<string> => {
  const redis = await getRedis();
  return redis.xAdd(stream, "*", { data: JSON.stringify(payload) });
};

export const closeRedis = async (): Promise<void> => {
  if (!_client) return;
  await _client.quit();
  _client = null;
};
