// Uso (en el servidor, con las variables en el entorno, no en Git):
//   USUARIO=ana PASSWORD='...' ROL=admin NOMBRE=Ana APELLIDOS=Perez node --env-file=/var/www/tortilleriasmx/.env dist/scripts/crear-usuario.js
import { hash } from "@node-rs/argon2";
import { pool } from "../db.js";

const { USUARIO, PASSWORD, ROL = "capturista", NOMBRE, APELLIDOS } = process.env;
if (!USUARIO || !PASSWORD || !NOMBRE || !APELLIDOS) throw new Error("Faltan USUARIO, PASSWORD, NOMBRE o APELLIDOS");
if (!["capturista", "supervisor", "admin"].includes(ROL)) throw new Error("ROL inválido");
if (PASSWORD.length < 10) throw new Error("La contraseña debe tener al menos 10 caracteres");

await pool.query(
  `INSERT INTO usuarios(nombre, apellidos, usuario, password_hash, rol) VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash, rol = EXCLUDED.rol, activo = true`,
  [NOMBRE, APELLIDOS, USUARIO, await hash(PASSWORD), ROL],
);
console.log(`Usuario ${USUARIO} (${ROL}) listo`);
await pool.end();
