# Catálogo DENUE

`denue_311830.tsv.gz`: tortillerías del DENUE (INEGI, SCIAN 311830), 112,072 registros ya limpios.
Es información pública de unidades económicas; no contiene datos personales de los responsables.

## Cómo se separan los datos

| Qué | Dónde | Se reemplaza al actualizar el DENUE |
|---|---|---|
| Catálogo (llave `id_denue`) | tabla `denue_catalogo` | sí |
| Tortillería elegible en la app | `tortillerias` con `origen = 'denue'` | solo nombre, domicilio, municipio y ubicación |
| Usuarios, responsables, fotos, precios, alertas | sus propias tablas | **nunca** |

Actualizar el DENUE nunca cambia el estatus, las fotos, el autor ni los precios capturados.

## Cargar o actualizar

1. Convertir el Excel (solo cuando haya un DENUE nuevo):
   `node apps/api/scripts/convertir-denue.mjs "ruta/catalogo.xlsx" db/denue/denue_311830.tsv.gz`
   (muestra un reporte de calidad: duplicados, coordenadas fuera de México, claves raras).
2. En el servidor, después de desplegar:
   - Prueba: `node --env-file=/var/www/tortilleriasmx/.env dist/scripts/importar-denue.js --limite=500`
   - Completa: `node --env-file=/var/www/tortilleriasmx/.env dist/scripts/importar-denue.js`
   - Solo revisar el archivo sin tocar la base: `node dist/scripts/importar-denue.js --simular`

Se puede repetir las veces que haga falta: no duplica.
