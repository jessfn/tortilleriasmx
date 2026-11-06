import Fastify from "fastify";
import cors from "@fastify/cors";

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" });
app.get("/health", async () => ({ ok: true }));
await app.listen({ port: Number(process.env.PORT ?? 3001), host: "0.0.0.0" });
