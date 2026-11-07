import { crearApp } from "./app.js";

const app = await crearApp();
// Solo local: Nginx hace de proxy público con HTTPS
await app.listen({ port: Number(process.env.PORT ?? 3001), host: "127.0.0.1" });
