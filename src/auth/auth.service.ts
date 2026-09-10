import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { COLLECTIONS, type AuthProvider, type UserDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { SyncSessionDto, UpdateProfileDto, UserResponse } from './dto/auth.dto.js';

type StoredUser = UserDoc & { id: string };

/**
 * El perfil del usuario. La autenticación en sí ya no vive acá.
 *
 * Quién es cada persona, su contraseña, el vínculo con Google y el correo de
 * recuperación los maneja Firebase Authentication desde la app. Este servicio
 * solo se ocupa de lo que Firebase no sabe: el perfil que mostramos, la
 * preferencia de avisos, el vencimiento de la licencia y el borrado en cascada.
 *
 * El identificador del usuario es el `uid` de Firebase, y con él se guarda su
 * documento en `users`. No hay dos numeraciones que mantener sincronizadas.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /**
   * Deja el perfil listo después de entrar.
   *
   * La app llama a esto apenas Firebase le entrega una sesión. Si es la primera
   * vez, crea el documento; si no, refresca lo que pudo cambiar en Firebase
   * --el correo, los proveedores vinculados, la foto-- sin tocar lo que el
   * usuario haya editado a mano.
   *
   * Es idempotente a propósito: llamarlo en cada inicio de sesión no cuesta nada
   * y evita que una cuenta creada en Firebase quede sin perfil acá.
   */
  async sincronizar(userId: string, email: string, dto: SyncSessionDto): Promise<UserResponse> {
    const ref = this.firebase.db.collection(COLLECTIONS.users).doc(userId);
    const snapshot = await ref.get();
    const now = new Date().toISOString();

    const cuenta = await getAuth(this.firebase.app)
      .getUser(userId)
      .catch(() => null);

    const providers = proveedoresDe(cuenta);

    if (!snapshot.exists) {
      const data: UserDoc = {
        email,
        name: dto.name?.trim() || cuenta?.displayName?.trim() || email.split('@')[0],
        googleId: idDeGoogle(cuenta),
        photoUrl: cuenta?.photoURL ?? null,
        providers,
        emailReminders: true,
        acceptedTermsVersion: dto.acceptedTermsVersion ?? null,
        acceptedTermsAt: dto.acceptedTermsVersion ? now : null,
        createdAt: now,
        updatedAt: now,
      };

      await ref.set(data);
      this.logger.log(`Perfil creado para ${email}`);
      return toUserResponse({ id: userId, ...data });
    }

    const actual = snapshot.data() as UserDoc;

    const patch: Partial<UserDoc> = {
      // El correo lo manda Firebase: si la persona lo cambió allá, acá se sigue.
      ...(actual.email !== email ? { email } : {}),
      ...(idDeGoogle(cuenta) && !actual.googleId ? { googleId: idDeGoogle(cuenta) } : {}),
      // La foto solo se rellena si no hay: no pisamos una elección del usuario.
      ...(cuenta?.photoURL && !actual.photoUrl ? { photoUrl: cuenta.photoURL } : {}),
      ...(distintos(actual.providers, providers) ? { providers } : {}),
      // Los términos se registran una sola vez, con la versión que se aceptó.
      ...(dto.acceptedTermsVersion && actual.acceptedTermsVersion !== dto.acceptedTermsVersion
        ? { acceptedTermsVersion: dto.acceptedTermsVersion, acceptedTermsAt: now }
        : {}),
    };

    if (Object.keys(patch).length > 0) {
      await ref.update({ ...patch, updatedAt: now });
    }

    return toUserResponse({ id: userId, ...actual, ...patch });
  }

  async me(userId: string): Promise<UserResponse> {
    const user = await this.findById(userId);
    if (!user) throw new UnauthorizedException('La sesión ya no es válida.');
    return toUserResponse(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponse> {
    const ref = this.firebase.db.collection(COLLECTIONS.users).doc(userId);

    await ref.update({
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
      ...(dto.alias !== undefined ? { alias: dto.alias?.trim() || null } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
      // `name` sigue siendo el nombre para mostrar --lo usan los correos y las
      // cuentas antiguas-- así que se rearma cuando cambian sus partes.
      ...(dto.firstName !== undefined || dto.lastName !== undefined
        ? { name: [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim() || undefined }
        : {}),
      ...(dto.emailReminders !== undefined ? { emailReminders: dto.emailReminders } : {}),
      // null significa "dejar de controlarla", que es distinto de no tocarla.
      ...(dto.licenseExpiresAt !== undefined ? { licenseExpiresAt: dto.licenseExpiresAt } : {}),
      updatedAt: new Date().toISOString(),
    });

    const user = await this.findById(userId);
    if (!user) throw new UnauthorizedException('La sesión ya no es válida.');

    // El nombre para mostrar también vive en Firebase: es el que aparece en los
    // correos que manda Authentication, así que se mantiene igual al nuestro.
    if (user.name) {
      await getAuth(this.firebase.app)
        .updateUser(userId, { displayName: user.name })
        .catch((error: unknown) => {
          this.logger.warn(`No se pudo actualizar el nombre en Firebase: ${describir(error)}`);
        });
    }

    return toUserResponse(user);
  }

  /**
   * Borra la cuenta y todo lo que cuelga de ella. Firestore no tiene borrado en
   * cascada, así que hay que recorrer cada colección a mano.
   *
   * La cuenta de Firebase se borra al final, y a propósito: si algo falla antes,
   * la persona conserva su acceso y puede reintentar. Al revés quedaría con los
   * datos adentro y sin manera de entrar a borrarlos.
   */
  async deleteAccount(userId: string): Promise<void> {
    const db = this.firebase.db;

    const [vehicles, documents, devices] = await Promise.all([
      db.collection(COLLECTIONS.vehicles).where('userId', '==', userId).get(),
      db.collection(COLLECTIONS.documents).where('userId', '==', userId).get(),
      db.collection(COLLECTIONS.devices).where('userId', '==', userId).get(),
    ]);

    const batch = db.batch();
    [...vehicles.docs, ...documents.docs, ...devices.docs].forEach((doc) => batch.delete(doc.ref));
    batch.delete(db.collection(COLLECTIONS.users).doc(userId));

    await batch.commit();

    await getAuth(this.firebase.app)
      .deleteUser(userId)
      .catch((error: unknown) => {
        this.logger.error(`Quedó una cuenta huérfana en Firebase (${userId}): ${describir(error)}`);
      });
  }

  async findById(userId: string): Promise<StoredUser | null> {
    const snapshot = await this.firebase.db.collection(COLLECTIONS.users).doc(userId).get();
    return snapshot.exists ? { id: snapshot.id, ...(snapshot.data() as UserDoc) } : null;
  }
}

/** Traduce los proveedores de Firebase a los nombres que usa la app. */
function proveedoresDe(cuenta: UserRecord | null): AuthProvider[] {
  const encontrados = (cuenta?.providerData ?? [])
    .map((proveedor) => {
      if (proveedor.providerId === 'google.com') return 'google';
      if (proveedor.providerId === 'password') return 'password';
      return null;
    })
    .filter((proveedor): proveedor is AuthProvider => proveedor !== null);

  return encontrados.length > 0 ? [...new Set(encontrados)] : ['password'];
}

function idDeGoogle(cuenta: UserRecord | null): string | null {
  return cuenta?.providerData.find((proveedor) => proveedor.providerId === 'google.com')?.uid ?? null;
}

function distintos(a: AuthProvider[] | undefined, b: AuthProvider[]): boolean {
  return [...(a ?? [])].sort().join(',') !== [...b].sort().join(',');
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toUserResponse(user: StoredUser): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    providers: user.providers ?? ['password'],
    licenseExpiresAt: user.licenseExpiresAt ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    alias: user.alias ?? null,
    phone: user.phone ?? null,
    photoUrl: user.photoUrl ?? null,
    emailReminders: user.emailReminders,
    createdAt: new Date(user.createdAt),
  };
}
