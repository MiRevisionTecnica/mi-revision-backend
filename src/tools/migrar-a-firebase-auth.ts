/**
 * Lleva las cuentas que vivían en Firestore a Firebase Authentication.
 *
 * Uso:  npm run migrar:auth              (prueba en seco: solo muestra)
 *       npm run migrar:auth -- --write   (crea las cuentas en Firebase)
 *
 * Se ejecuta una sola vez, al cambiar la autenticación propia por la de
 * Firebase. Después de eso no sirve para nada y se puede borrar.
 *
 * Dos decisiones que importan:
 *
 * 1. **Cada cuenta se crea con el uid igual al id que ya tenía su documento.**
 *    Los vehículos, documentos y dispositivos apuntan al usuario por ese id; si
 *    Firebase generara uno nuevo, habría que reescribir todas esas referencias
 *    y cualquier error dejaría datos huérfanos. Con el uid fijado, nada más se
 *    mueve.
 *
 * 2. **La contraseña se importa tal cual, sin conocerla.** `importUsers` acepta
 *    el hash de bcrypt que ya teníamos, así que la persona sigue entrando con
 *    la misma contraseña de siempre y no hay que avisarle nada. Si en cambio se
 *    crearan las cuentas de cero, todas quedarían sin contraseña.
 *
 * Es idempotente: una cuenta que ya existe en Firebase se informa y se salta.
 */
import 'dotenv/config';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type UserImportRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const WRITE = process.argv.includes('--write');

/** La forma que tenían los usuarios antes de la migración. */
type UsuarioAntiguo = {
  email: string;
  name?: string;
  passwordHash?: string | null;
  googleId?: string | null;
  photoUrl?: string | null;
  providers?: ('password' | 'google')[];
};

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
const auth = getAuth(app);

const snapshot = await db.collection('users').get();
console.log(`${snapshot.size} cuenta(s) en Firestore.\n`);

const porImportar: UserImportRecord[] = [];
const yaEstaban: string[] = [];
const sinContrasena: string[] = [];

for (const doc of snapshot.docs) {
  const user = doc.data() as UsuarioAntiguo;

  const existente = await auth.getUser(doc.id).catch(() => null);
  if (existente) {
    yaEstaban.push(user.email);
    continue;
  }

  // Un correo repetido con otro uid haría fallar la importación entera; vale
  // más detectarlo acá y decir cuál es.
  const porCorreo = await auth.getUserByEmail(user.email).catch(() => null);
  if (porCorreo) {
    console.log(
      `⚠ ${user.email} ya existe en Firebase con otro uid (${porCorreo.uid}), ` +
        `distinto del de Firestore (${doc.id}). Hay que resolverlo a mano.`,
    );
    continue;
  }

  const registro: UserImportRecord = {
    uid: doc.id,
    email: user.email,
    // Las cuentas venían de nuestro propio registro, donde el correo nunca se
    // verificó. Marcarlas como verificadas sería afirmar algo que no comprobamos.
    emailVerified: false,
    displayName: user.name,
    photoURL: user.photoUrl ?? undefined,
    ...(user.passwordHash
      ? { passwordHash: Buffer.from(user.passwordHash) }
      : {}),
    ...(user.googleId
      ? {
          providerData: [
            {
              uid: user.googleId,
              providerId: 'google.com',
              email: user.email,
              displayName: user.name,
              photoURL: user.photoUrl ?? undefined,
            },
          ],
        }
      : {}),
  };

  if (!user.passwordHash && !user.googleId) sinContrasena.push(user.email);
  porImportar.push(registro);
}

console.log(`A importar: ${porImportar.length}`);
porImportar.forEach((registro) => {
  const como = registro.passwordHash ? 'contraseña' : registro.providerData ? 'Google' : 'sin acceso';
  console.log(`  · ${registro.email} (${registro.uid}) → ${como}`);
});

if (yaEstaban.length > 0) console.log(`Ya estaban en Firebase: ${yaEstaban.join(', ')}`);
if (sinContrasena.length > 0) {
  console.log(
    `⚠ Sin contraseña ni Google, no van a poder entrar: ${sinContrasena.join(', ')}. ` +
      'Tendrán que usar "olvidé mi contraseña" para ponerse una.',
  );
}

if (!WRITE) {
  console.log('\nPrueba en seco. Repite con -- --write para crear las cuentas.');
  process.exit(0);
}

if (porImportar.length === 0) {
  console.log('\nNo hay nada que importar.');
  process.exit(0);
}

const resultado = await auth.importUsers(porImportar, {
  // El algoritmo con el que se generaron los hashes originales. Firebase los
  // verifica con él en el primer inicio de sesión y luego los reescribe con el
  // suyo, sin que la persona note nada.
  hash: { algorithm: 'BCRYPT' },
});

console.log(`\nImportadas: ${resultado.successCount}, con error: ${resultado.failureCount}`);
resultado.errors.forEach((error) => {
  console.log(`  ✗ ${porImportar[error.index]?.email}: ${error.error.message}`);
});

process.exit(resultado.failureCount > 0 ? 1 : 0);
