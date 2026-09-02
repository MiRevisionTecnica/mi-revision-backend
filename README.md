# Mi Revisión Técnica — API

Backend de la app **Mi Revisión Técnica**: cuentas, vehículos con sus fechas de vencimiento,
documentos, catálogo de plantas PRT y el envío de recordatorios por push y correo.

**NestJS 12 · Cloud Firestore · Swagger · Railway.**

La app móvil vive en [`../mi-revision-app`](../mi-revision-app).

> **La app nunca habla con Firebase directamente.** Todo pasa por esta API: las credenciales
> de la cuenta de servicio viven solo en el servidor y las reglas de Firestore niegan el
> acceso de cualquier cliente. Son dos piezas separadas, no una app con Firebase incrustado.

## Levantarlo en local

```bash
npm install
cp .env.example .env     # completa las credenciales de Firebase y JWT_SECRET
npm run seed             # carga las 38 plantas PRT de la RM en Firestore
npm run start:dev
```

- API: `http://localhost:3000/api`
- Documentación interactiva: `http://localhost:3000/docs`
- Health check: `http://localhost:3000/health`

```bash
npm run typecheck    # tsc --noEmit
npm test             # unitarios (vitest)
npm run test:e2e     # smoke tests, requiere credenciales de Firebase
npm run openapi      # regenera openapi.json (compila y verifica el cableado de módulos)
```

### Credenciales de Firebase

En la consola de Firebase: **Configuración del proyecto → Cuentas de servicio →
Generar nueva clave privada**. Esa clave **es secreta** y está en `.gitignore`.

Después define **una** de estas tres opciones en el `.env`:

**1. Ruta al archivo — la más simple en local.** No hay que convertir nada:

```bash
GOOGLE_APPLICATION_CREDENTIALS=C:/Proyectos/claves/mi-revision-tecnica.json
```

Usa barras normales aunque estés en Windows, y guarda el archivo **fuera del
repositorio** para no subirlo por accidente.

**2. El JSON en base64 — la más cómoda en Railway**, porque cabe en una sola variable:

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("clave.json")) | Set-Clipboard
```

```bash
# Linux / macOS
base64 -w0 clave.json
```

y pegar el resultado en `FIREBASE_SERVICE_ACCOUNT_BASE64`.

**3. Los tres campos sueltos:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` y
`FIREBASE_PRIVATE_KEY`.

Si no hay ninguna, la API no arranca y el error dice exactamente qué falta.

Es la **misma clave** que se sube a Expo para el push FCM V1, aunque cumple otro rol: aquí
da acceso a Firestore, allá autoriza el envío de notificaciones.

## Endpoints

25 rutas, todas bajo `/api` salvo `/health`. El contrato completo está en
[`openapi.json`](openapi.json) y en `/docs`.

| Grupo | Rutas |
| --- | --- |
| **Autenticación** | `POST /auth/register` · `POST /auth/login` · `POST /auth/google` · `POST /auth/refresh` · `POST /auth/logout` · `GET/PATCH/DELETE /auth/me` |
| **Vehículos** | `GET/POST /vehicles` · `GET/PATCH/DELETE /vehicles/:id` |
| **Documentos** | `GET/POST /vehicles/:vehicleId/documents` · `DELETE /documents/:id` |
| **Plantas PRT** | `GET /plants` · `GET /plants/comunas` · `GET /plants/:id` *(públicos)* |
| **Dispositivos** | `GET/POST /devices` · `DELETE /devices/:expoPushToken` |
| **Recordatorios** | `GET /reminders/preview` · `POST /reminders/run` |
| **Estado** | `GET /health` |

Todo exige `Authorization: Bearer <accessToken>` salvo lo marcado con `@Public()`:
registro, login, entrar con Google, refresh, el catálogo de plantas y el health check.

### Autenticación

`login` y `register` devuelven un **access token** (1 h por defecto) y un **refresh token**
(30 días). Del refresh token solo se guarda su hash SHA-256, que además es el id del documento
en Firestore, y **rota**: al usarlo en `POST /auth/refresh` queda revocado y se entrega uno
nuevo. Las contraseñas se guardan con bcrypt (12 rondas).

Un correo inexistente y una clave errónea devuelven el mismo mensaje, para no revelar qué
correos están registrados.

### Entrar con Google

`POST /auth/google` recibe el **ID token** que la app obtuvo de Google, verifica su firma
contra las claves públicas de Google y comprueba que la audiencia sea uno de los client ID
de `GOOGLE_OAUTH_CLIENT_IDS`. Recién ahí crea la sesión propia. La app sigue sin hablar con
Firebase, y un token emitido para otra aplicación no sirve porque la audiencia no calza.

- Si el correo **ya tenía cuenta con contraseña**, se vincula en vez de duplicar: el correo
  verificado por Google es prueba suficiente de que es la misma persona. `UserResponse.providers`
  muestra con qué puede entrar (`["password", "google"]`).
- Una cuenta creada con Google **no tiene contraseña**: si intenta entrar por `/auth/login`, la
  API responde explicando que use el botón de Google, en vez de un genérico "clave incorrecta".
- Se rechaza el token si Google marca el correo como no verificado, porque si no cualquiera
  podría reclamar el correo de otra persona.
- Sin `GOOGLE_OAUTH_CLIENT_IDS` configurado el endpoint responde **503**, no un error confuso.

Para obtener los client ID: consola de Firebase → **Authentication → Sign-in method →
habilitar Google**. Eso crea el cliente OAuth *web*; el de Android aparece después de
registrar la huella SHA-1 del keystore (ver `../mi-revision-app`).

### Vehículos y vencimientos

Las fechas van dentro del vehículo, como lista de `{ kind, dueDate }`, y la respuesta agrega
`daysRemaining` y `status` (`vigente` / `por_vencer` / `vencido`) ya calculados:

```jsonc
// POST /api/vehicles
{
  "plate": "ABCD12",
  "brand": "Chevrolet",
  "model": "Cruze LT",
  "year": 2018,
  "expirations": [
    { "kind": "REVISION_TECNICA", "dueDate": "2026-09-30" },
    { "kind": "SOAP", "dueDate": "2027-03-31" }
  ]
}
```

En `PATCH`, si se envía `expirations`, **reemplaza por completo** las fechas guardadas.
El límite por cuenta es `MAX_VEHICLES_PER_USER` (Fase 1: `1`; al superarlo responde 403).

### Recordatorios

Un cron interno corre todos los días a las `REMINDER_HOUR` en zona `America/Santiago` y avisa
`REMINDER_OFFSETS` días antes de cada vencimiento (por defecto 30, 15, 7, 1 y 0), por push
(Expo) y por correo (SMTP).

- **Es idempotente.** Cada aviso se "reserva" creando `reminderLogs/{vehículo}_{tipo}_{fecha}_{días}_{canal}`
  con `create()`, que falla si el documento ya existe. Repetir la corrida —o correr dos
  instancias a la vez— no duplica avisos. Si el envío no llega a salir, la reserva se libera.
- **Los tokens muertos se limpian solos:** si Expo responde `DeviceNotRegistered`, el
  dispositivo se borra.
- **Sin `SMTP_HOST` configurado** el correo queda inactivo y solo salen los push.
- `GET /reminders/preview` muestra qué avisos tocarían hoy, sin enviar nada.
- `POST /reminders/run` dispara la corrida para un cron externo. Exige el header
  `x-cron-secret` igual a `CRON_SECRET`; **sin esa variable el endpoint queda cerrado**.

## Modelo de datos en Firestore

Firestore no tiene esquema, claves únicas ni borrado en cascada, así que esas garantías se
sostienen desde el código ([`src/firebase/collections.ts`](src/firebase/collections.ts)):

| Colección | id | Notas |
| --- | --- | --- |
| `users` | autogenerado | Cuenta y preferencia de correos |
| `userEmails` | correo en minúsculas | **Índice de unicidad**: se escribe en la misma transacción que el usuario |
| `refreshTokens` | sha256 del token | Buscar una sesión es un acceso directo por id |
| `vehicles` | autogenerado | Único por `(usuario, patente)`, validado dentro de una transacción |
| `documents` | autogenerado | Guarda `userId` además de `vehicleId`, para filtrar por dueño sin leer el vehículo |
| `devices` | `ExponentPushToken[...]` | El token como id hace que registrar dos veces no duplique |
| `reminderLogs` | clave compuesta | Su id es lo que hace idempotente el envío |
| `plants` | `prt-01`… | Catálogo público, cacheado 10 minutos en memoria |

Dos decisiones que vale la pena conocer:

- **`vehicles.dueDates`** duplica en un arreglo plano las fechas que ya están en el mapa
  `expirations`. Firestore no sabe consultar dentro de un mapa, y ese arreglo es lo que
  permite al cron preguntar `array-contains` por la fecha del día en vez de recorrer todos
  los vehículos. Ambos campos se escriben juntos.
- **Las fechas se guardan como texto `'YYYY-MM-DD'`**, no como `Timestamp`: un vencimiento es
  un día del calendario, sin hora, y así el servidor y un usuario en Chile ven siempre el mismo.

Todas las consultas son de igualdad o `array-contains`, que Firestore resuelve con sus índices
automáticos: **no hace falta crear índices compuestos**.

### Reglas de seguridad

[`firestore.rules`](firestore.rules) **niega todo acceso directo**. No es un descuido: el
Admin SDK que usa esta API se salta las reglas por diseño, y ningún cliente debe poder tocar
la base. Desplegarlas:

```bash
npx firebase-tools deploy --only firestore:rules
```

## Desplegar en Railway

1. Crear un proyecto y conectar este repositorio. `railway.toml` ya indica que se construya
   con el `Dockerfile`, con health check en `/health`. **No hace falta agregar Postgres.**
2. Definir las variables de [`.env.example`](.env.example): como mínimo `JWT_SECRET` y las
   credenciales de Firebase.
3. Desplegar y cargar el catálogo una vez: `railway run npm run seed`.

`PORT` lo asigna Railway y el servidor escucha en `0.0.0.0`, que es lo que el contenedor
necesita para recibir tráfico.

Con el cron interno basta para los recordatorios. Si prefieres separarlo del ciclo de vida del
servicio, define `CRON_SECRET`, pon `REMINDERS_ENABLED=false` y llama desde un
*Scheduled Job* de Railway:

```bash
curl -X POST https://<tu-servicio>.up.railway.app/api/reminders/run \
  -H "x-cron-secret: $CRON_SECRET"
```

## Catálogo de plantas PRT

38 plantas de la Región Metropolitana. `src/data/plants.json` es el archivo maestro y el
mismo que usa la app como respaldo sin conexión.

### De dónde salen los datos

Google Places es la fuente: entrega la coordenada del propio negocio, el horario, el teléfono
y si sigue funcionando. Al 2 de septiembre de 2026, de las 38 plantas del listado:

| Dato | Cobertura |
| --- | --- |
| Coordenada verificada (`precision: places`) | 38 |
| Horario de atención | 36 |
| Teléfono | 38 |
| Cerradas permanentemente | 2 (SGS Ñuñoa) |

Las cerradas **no se listan** en la API: mandar a alguien a una planta que ya no existe es peor
que no mostrarla. Quedan en la base con `status: "closed"`, así que si reabren vuelven solas en
el siguiente refresco.

Esto corrigió errores grandes. Antes, con geocodificación gratuita, la mitad de las
coordenadas apuntaba a cualquier parte —hubo pines sobre un colegio, un teatro y una
ciclovía— y una planta estaba a 6,4 km de su lugar real.

### Refresco automático

[`PlantsRefreshService`](src/plants/plants-refresh.service.ts) actualiza el catálogo **el día 1
de cada mes a las 03:00** (hora de Chile). Una vez al mes basta: los horarios y teléfonos casi
no cambian, y así el gasto queda en 38 llamadas mensuales, muy lejos del free tier de 10.000
por SKU. El `placeId` guardado evita repetir la búsqueda, así que solo se paga el detalle.

Para forzarlo a mano, tras editar el listado o para ver qué devuelve Google:

```bash
npm run enrich:plants             # prueba en seco, no escribe nada
npm run enrich:plants -- --write  # guarda en Firestore y en src/data/plants.json
```

Ambos caminos comparten la lógica de [`places-refresh.ts`](src/plants/places-refresh.ts).
Necesitan `GOOGLE_MAPS_API_KEY` con "Places API (New)" habilitada; sin ella el servicio avisa
al arrancar y el catálogo queda como esté.

**Detalle a tener presente:** Firestore no acepta arreglos anidados, así que los tramos se
guardan como objetos (`{ open: "08:00", close: "17:00" }`) y no como pares.

Para agregar o quitar plantas del listado, editar `src/data/plants.json` y correr
`npm run seed` (es un upsert, seguro de repetir).

## Estado de la verificación

- ✅ `tsc --noEmit` sin errores, `nest build` compila, unitarios en verde.
- ✅ `npm run openapi` levanta la aplicación completa con un doble de Firebase: confirma que
  los 24 endpoints, sus DTOs y la inyección de dependencias resuelven.
- ⚠️ **No se probó contra Firestore real**: falta la clave de cuenta de servicio. Al tenerla,
  hay que correr `npm run seed` y `npm run test:e2e` una vez para validar las consultas,
  las transacciones de unicidad y el borrado en cascada.

## Pendiente

1. Conectar la app móvil: hoy usa almacenamiento local. Los puntos de cambio son
   `src/services/auth.ts` y `src/context/GarageContext.tsx`; `openapi.json` sirve para generar
   el cliente.
2. Configurar SMTP para los correos (Resend, Brevo o el que prefiera el cliente).
3. Subida de archivos a Cloud Storage, si se decide sincronizar los documentos entre
   dispositivos. El bucket del proyecto ya existe y `documents.storageUrl` está listo.
4. Cargar los horarios con `npm run enrich:plants` (necesita `GOOGLE_MAPS_API_KEY`).
5. Limitar la tasa de intentos en `/auth/login`. `@nestjs/throttler` todavía no soporta
   NestJS 12, así que hay que esperar esa versión o resolverlo en el borde.
