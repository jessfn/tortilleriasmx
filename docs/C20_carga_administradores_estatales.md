# Carga masiva de administradores estatales (C20.8)

El archivo `carga_administradores_estatales.xlsx` trae **CURP y correos**: es información personal. **No se sube a Git** (el `.gitignore` ya lo evita) y se comparte solo con quien hace la carga.

## Pasos (en el servidor, con el `.env` de producción)

1. Copiar el archivo al servidor **fuera del repositorio** (por ejemplo `~/carga/`).
2. **Prueba** (no escribe nada; valida y cuenta):

   ```bash
   cd /var/www/Tortillerias/apps/api
   node --env-file=../../.env dist/scripts/cargar-estatales.js ~/carga/carga_administradores_estatales.xlsx
   ```

   Si hay errores, los lista por fila y **no aplica nada**: se corrige el archivo y se vuelve a correr.
3. **Aplicar** (una sola transacción; `--por` es el correo de la cuenta de DGTIC que hace la carga):

   ```bash
   node --env-file=../../.env dist/scripts/cargar-estatales.js ~/carga/carga_administradores_estatales.xlsx --aplicar --por=correo.dgtic@agricultura.gob.mx
   ```

   Genera las contraseñas temporales **en el servidor** y guarda el archivo de credenciales en `~/credenciales-tortilleriasmx/` (solo legible por su dueño).
4. Entregar el archivo de credenciales por un medio seguro y **borrarlo del servidor**, junto con el archivo de entrada.

## Opciones

| Opción | Qué hace |
|---|---|
| `--aplicar` | Escribe. Sin ella, es solo una prueba. |
| `--por=<correo>` | Obligatoria con `--aplicar`: administrador activo que hace la carga. |
| `--restablecer` | También genera otra contraseña temporal a las cuentas que ya existían (sin ella, su contraseña no cambia). |
| `--salida=<carpeta>` | Dónde guardar el archivo de credenciales. |

Volver a correr la carga **no duplica** cuentas: las que ya existen (mismo correo o CURP) se actualizan en estados y datos.
