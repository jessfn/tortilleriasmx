import { crearApp } from "./app.js";

const app = await crearApp();
// HOST=127.0.0.1 (por defecto): solo local, con nginx como proxy público. En el servidor de la Secretaría el balanceador
// entrega el tráfico directo al puerto de la aplicación, así que se pone HOST=0.0.0.0.
await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? "127.0.0.1" });
