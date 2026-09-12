/**
 * Manda una notificación de prueba a los teléfonos registrados.
 *
 * Uso:  npm run push:prueba                      (a todos los aparatos)
 *       npm run push:prueba -- correo@ejemplo.cl (solo a esa cuenta)
 *       npm run push:prueba -- --esperar         (espera hasta que aparezca uno)
 *
 * Existe porque probar el push de punta a punta es lo único que no se puede
 * comprobar desde el servidor solo: hace falta un teléfono real con la app
 * abierta al menos una vez y con sesión iniciada. Con `--esperar` se deja
 * corriendo mientras se entra en el teléfono, y dispara apenas se registre.
 */
import 'dotenv/config';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { COLLECTIONS, type DeviceDoc, type UserDoc } from '../firebase/collections.js';

const argumentos = process.argv.slice(2);
const ESPERAR = argumentos.includes('--esperar');
const CORREO = argumentos.find((a) => a.includes('@'))?.toLowerCase();

function credentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return { credential: applicationDefault() };

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    return {
      credential: cert(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')) as ServiceAccount),
    };
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    };
  }

  throw new Error('Faltan las credenciales de Firebase. Ver README.md.');
}

const app = getApps().length > 0 ? getApps()[0] : initializeApp(credentials());
const db = getFirestore(app);
const messaging = getMessaging(app);

type Aparato = DeviceDoc & { id: string; correo: string };

async function aparatos(): Promise<Aparato[]> {
  const [dispositivos, usuarios] = await Promise.all([
    db.collection(COLLECTIONS.devices).get(),
    db.collection(COLLECTIONS.users).get(),
  ]);

  const correos = new Map(usuarios.docs.map((doc) => [doc.id, (doc.data() as UserDoc).email]));

  return dispositivos.docs
    .map((doc) => {
      const datos = doc.data() as DeviceDoc;
      return { ...datos, id: doc.id, correo: correos.get(datos.userId) ?? '(sin dueño)' };
    })
    .filter((aparato) => !CORREO || aparato.correo.toLowerCase() === CORREO);
}

let lista = await aparatos();

if (lista.length === 0 && ESPERAR) {
  console.log('Esperando a que un teléfono se registre.');
  console.log('Abre la app **con tu cuenta iniciada** (en modo invitado no se registra).');
  console.log('Ctrl+C para cortar.\n');

  const hasta = Date.now() + 5 * 60 * 1000;
  while (lista.length === 0 && Date.now() < hasta) {
    await new Promise((r) => setTimeout(r, 4000));
    lista = await aparatos();
    process.stdout.write('.');
  }
  console.log();
}

if (lista.length === 0) {
  console.log('No hay teléfonos registrados.');
  console.log('\nPara que aparezca uno:');
  console.log('  1. Abre la app e inicia sesión con tu cuenta (no como invitado).');
  console.log('  2. Acepta el permiso de notificaciones cuando lo pida.');
  console.log('  3. Vuelve a correr esto, o usa -- --esperar para que quede aguardando.');
  process.exit(1);
}

const entregables = lista.filter((a) => a.provider === 'fcm');
const apple = lista.filter((a) => a.provider === 'apns');

console.log(`${lista.length} aparato(s) registrado(s):`);
lista.forEach((a) => console.log(`  ${a.correo}  ${a.platform}  ${a.provider}`));

if (apple.length > 0) {
  console.log(
    `\n${apple.length} de iOS sin ruta de entrega todavía. Ver README.md → "Notificaciones en iOS".`,
  );
}

if (entregables.length === 0) {
  console.log('\nNinguno se puede entregar por FCM.');
  process.exit(1);
}

const hora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

const respuesta = await messaging.sendEach(
  entregables.map((aparato) => ({
    token: aparato.token,
    notification: {
      title: 'Prueba de notificación',
      body: `Si ves esto, los avisos de vencimiento van a llegar. Enviada a las ${hora}.`,
    },
    data: { prueba: 'true' },
    android: {
      priority: 'high' as const,
      notification: { channelId: 'vencimientos', sound: 'default' },
    },
  })),
);

console.log(`\nEnviados: ${respuesta.successCount}, con error: ${respuesta.failureCount}`);

respuesta.responses.forEach((resultado, indice) => {
  const aparato = entregables[indice];
  if (resultado.success) {
    console.log(`  ok    ${aparato.correo}`);
    return;
  }
  console.log(`  FALLA ${aparato.correo}: ${resultado.error?.code} — ${resultado.error?.message}`);
});

process.exit(respuesta.failureCount > 0 ? 1 : 0);
