import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  COLLECTIONS,
  type AuthProvider,
  type PasswordResetDoc,
  type RefreshTokenDoc,
  type UserDoc,
} from '../firebase/collections.js';
import { GoogleAuthService } from './google.service.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { MailService } from '../reminders/mail.service.js';
import type {
  LoginDto,
  RegisterDto,
  SessionResponse,
  UpdateProfileDto,
  UserResponse,
} from './dto/auth.dto.js';

const BCRYPT_ROUNDS = 12;

/**
 * Cuánto dura un código de recuperación.
 *
 * Corto a propósito: es lo que separa "me llegó y lo uso" de "quedó dando vueltas
 * en un correo que alguien puede leer después".
 */
const RESET_MINUTES = 15;

type StoredUser = UserDoc & { id: string };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firebase: FirebaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly google: GoogleAuthService,
    private readonly mail: MailService,
  ) {}

  /**
   * Empieza una recuperación de contraseña.
   *
   * Responde igual exista o no la cuenta. Decir "ese correo no está registrado"
   * convierte este endpoint en una forma de averiguar quién tiene cuenta, que es
   * justo lo que no queremos regalar.
   *
   * El código va por correo y dura poco. Se guarda solo su hash: si alguien
   * leyera la base, no podría usarlo para entrar.
   */
  async forgotPassword(email: string): Promise<void> {
    const limpio = email.trim().toLowerCase();
    const user = await this.findByEmail(limpio);

    if (!user) return;

    // Una cuenta creada con Google no tiene contraseña que recuperar.
    if (!user.passwordHash) return;

    if (!this.mail.enabled) {
      this.logger.error(
        'Alguien pidió recuperar su contraseña, pero no hay SMTP configurado y el ' +
          'correo no salió. Revisa SMTP_HOST y compañía en el .env.',
      );
      return;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + RESET_MINUTES * 60 * 1000).toISOString();

    await this.firebase.db
      .collection(COLLECTIONS.passwordResets)
      .doc(hashToken(`${limpio}:${code}`))
      .set({
        userId: user.id,
        email: limpio,
        expiresAt,
        usedAt: null,
        attempts: 0,
        createdAt: new Date().toISOString(),
      });

    await this.mail.send({
      to: limpio,
      subject: 'Tu código para recuperar la contraseña',
      text:
        `Tu código es ${code}. Vence en ${RESET_MINUTES} minutos.

` +
        'Si no pediste recuperar tu contraseña, ignora este correo: tu cuenta sigue igual.',
      html:
        `<p>Tu código es <strong style="font-size:22px;letter-spacing:3px">${code}</strong></p>` +
        `<p>Vence en ${RESET_MINUTES} minutos.</p>` +
        '<p style="color:#5B6B84">Si no pediste recuperar tu contraseña, ignora este correo: ' +
        'tu cuenta sigue igual.</p>',
    });
  }

  /**
   * Termina la recuperación: valida el código y cambia la contraseña.
   *
   * Al cambiarla se revocan todas las sesiones abiertas. Si alguien había
   * entrado con la contraseña anterior, deja de tener acceso; ese es el punto de
   * recuperarla.
   */
  async resetPassword(email: string, code: string, password: string): Promise<void> {
    const limpio = email.trim().toLowerCase();
    const ref = this.firebase.db
      .collection(COLLECTIONS.passwordResets)
      .doc(hashToken(`${limpio}:${code}`));

    const snapshot = await ref.get();
    const reset = snapshot.data() as PasswordResetDoc | undefined;

    const invalido = new UnauthorizedException('El código no es válido o ya venció.');

    if (!reset || reset.usedAt || reset.expiresAt < new Date().toISOString()) throw invalido;
    if (reset.email !== limpio) throw invalido;

    const userRef = this.firebase.db.collection(COLLECTIONS.users).doc(reset.userId);
    const user = (await userRef.get()).data() as UserDoc | undefined;
    if (!user) throw invalido;

    await userRef.update({
      passwordHash: await hash(password, 12),
      providers: [...new Set([...(user.providers ?? []), 'password'])],
      updatedAt: new Date().toISOString(),
    });

    await ref.update({ usedAt: new Date().toISOString() });
    await this.revokeAllRefreshTokens(reset.userId);
  }

  /** Cierra todas las sesiones de una cuenta. */
  private async revokeAllRefreshTokens(userId: string): Promise<void> {
    const abiertos = await this.firebase.db
      .collection(COLLECTIONS.refreshTokens)
      .where('userId', '==', userId)
      .where('revokedAt', '==', null)
      .get();

    if (abiertos.empty) return;

    const lote = this.firebase.db.batch();
    const now = new Date().toISOString();
    abiertos.docs.forEach((doc) => lote.update(doc.ref, { revokedAt: now }));
    await lote.commit();
  }

  async register(dto: RegisterDto): Promise<SessionResponse> {
    const email = dto.email.trim().toLowerCase();
    const db = this.firebase.db;

    const userRef = db.collection(COLLECTIONS.users).doc();
    const emailRef = db.collection(COLLECTIONS.userEmails).doc(email);
    const now = new Date().toISOString();

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);

    // Firestore no tiene índices únicos: la unicidad del correo se sostiene
    // escribiendo users/{id} y userEmails/{correo} en la misma transacción.
    const user = await db.runTransaction(async (tx) => {
      const taken = await tx.get(emailRef);
      if (taken.exists) {
        throw new ConflictException('Ya existe una cuenta con este correo.');
      }

      const data: UserDoc = {
        email,
        name: dto.name.trim(),
        passwordHash,
        googleId: null,
        photoUrl: null,
        providers: ['password'],
        emailReminders: true,
        acceptedTermsVersion: dto.acceptedTermsVersion,
        acceptedTermsAt: now,
        createdAt: now,
        updatedAt: now,
      };

      tx.set(userRef, data);
      tx.set(emailRef, { userId: userRef.id });

      return { id: userRef.id, ...data };
    });

    return this.buildSession(user);
  }

  async login(dto: LoginDto): Promise<SessionResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.findByEmail(email);

    // Una cuenta creada con Google no tiene contraseña que comparar.
    if (user && !user.passwordHash) {
      throw new UnauthorizedException(
        'Esta cuenta se creó con Google. Inicia sesión con el botón de Google.',
      );
    }

    // Mismo mensaje para usuario inexistente y clave errónea: no revelamos
    // qué correos están registrados.
    const valid = user?.passwordHash ? await compare(dto.password, user.passwordHash) : false;
    if (!user || !valid) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    return this.buildSession(user);
  }

  /**
   * Inicia sesión con Google, creando la cuenta si es la primera vez.
   *
   * Si ya existe una cuenta con ese correo (creada con contraseña), se vincula
   * en vez de duplicar: el correo verificado por Google es prueba suficiente de
   * que se trata de la misma persona.
   */
  async loginWithGoogle(idToken: string, acceptedTermsVersion?: string): Promise<SessionResponse> {
    const profile = await this.google.verify(idToken);
    const db = this.firebase.db;
    const now = new Date().toISOString();

    const existing = await this.findByEmail(profile.email);

    if (existing) {
      const providers: AuthProvider[] = existing.providers?.includes('google')
        ? existing.providers
        : [...(existing.providers ?? ['password']), 'google'];

      const patch = {
        googleId: profile.googleId,
        photoUrl: existing.photoUrl ?? profile.photoUrl,
        providers,
        updatedAt: now,
      };

      await db.collection(COLLECTIONS.users).doc(existing.id).update(patch);
      return this.buildSession({ ...existing, ...patch });
    }

    const userRef = db.collection(COLLECTIONS.users).doc();
    const emailRef = db.collection(COLLECTIONS.userEmails).doc(profile.email);

    const created = await db.runTransaction(async (tx) => {
      // Otra petición pudo crear la cuenta entremedio; la transacción lo detecta.
      const taken = await tx.get(emailRef);
      if (taken.exists) return null;

      const data: UserDoc = {
        email: profile.email,
        name: profile.name,
        passwordHash: null,
        googleId: profile.googleId,
        photoUrl: profile.photoUrl,
        providers: ['google'],
        emailReminders: true,
        acceptedTermsVersion: acceptedTermsVersion ?? null,
        acceptedTermsAt: acceptedTermsVersion ? now : null,
        createdAt: now,
        updatedAt: now,
      };

      tx.set(userRef, data);
      tx.set(emailRef, { userId: userRef.id });

      return { id: userRef.id, ...data };
    });

    if (created) return this.buildSession(created);

    // La cuenta apareció mientras creábamos: reintentamos por la vía de vínculo.
    const raced = await this.findByEmail(profile.email);
    if (!raced) throw new UnauthorizedException('No pudimos crear tu cuenta.');
    return this.buildSession(raced);
  }

  /** Rota el refresh token: el anterior queda revocado al usarse. */
  async refresh(refreshToken: string): Promise<SessionResponse> {
    // El hash del token es el id del documento, así que basta un acceso directo.
    const ref = this.firebase.db.collection(COLLECTIONS.refreshTokens).doc(hashToken(refreshToken));
    const snapshot = await ref.get();
    const stored = snapshot.data() as RefreshTokenDoc | undefined;

    if (!stored || stored.revokedAt || new Date(stored.expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException('La sesión expiró. Vuelve a iniciar sesión.');
    }

    await ref.update({ revokedAt: new Date().toISOString() });

    const user = await this.findById(stored.userId);
    if (!user) throw new UnauthorizedException('La sesión ya no es válida.');

    return this.buildSession(user);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    const tokens = this.firebase.db.collection(COLLECTIONS.refreshTokens);

    if (refreshToken) {
      // Solo puede revocar un token propio: el filtro por userId lo garantiza.
      const ref = tokens.doc(hashToken(refreshToken));
      const snapshot = await ref.get();
      if (snapshot.exists && (snapshot.data() as RefreshTokenDoc).userId === userId) {
        await ref.update({ revokedAt: new Date().toISOString() });
      }
      return;
    }

    // Sin token explícito cerramos todas las sesiones del usuario.
    const active = await tokens
      .where('userId', '==', userId)
      .where('revokedAt', '==', null)
      .get();
    if (active.empty) return;

    const batch = this.firebase.db.batch();
    const revokedAt = new Date().toISOString();
    active.docs.forEach((doc) => batch.update(doc.ref, { revokedAt }));
    await batch.commit();
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
    return toUserResponse(user);
  }

  /**
   * Borra la cuenta y todo lo que cuelga de ella. Firestore no tiene borrado en
   * cascada, así que hay que recorrer cada colección a mano.
   */
  async deleteAccount(userId: string): Promise<void> {
    const db = this.firebase.db;
    const user = await this.findById(userId);
    if (!user) return;

    const [vehicles, documents, devices, tokens] = await Promise.all([
      db.collection(COLLECTIONS.vehicles).where('userId', '==', userId).get(),
      db.collection(COLLECTIONS.documents).where('userId', '==', userId).get(),
      db.collection(COLLECTIONS.devices).where('userId', '==', userId).get(),
      db.collection(COLLECTIONS.refreshTokens).where('userId', '==', userId).get(),
    ]);

    const batch = db.batch();
    [...vehicles.docs, ...documents.docs, ...devices.docs, ...tokens.docs].forEach((doc) =>
      batch.delete(doc.ref),
    );
    batch.delete(db.collection(COLLECTIONS.userEmails).doc(user.email));
    batch.delete(db.collection(COLLECTIONS.users).doc(userId));

    await batch.commit();
  }

  async findById(userId: string): Promise<StoredUser | null> {
    const snapshot = await this.firebase.db.collection(COLLECTIONS.users).doc(userId).get();
    return snapshot.exists ? ({ id: snapshot.id, ...(snapshot.data() as UserDoc) }) : null;
  }

  private async findByEmail(email: string): Promise<StoredUser | null> {
    const index = await this.firebase.db.collection(COLLECTIONS.userEmails).doc(email).get();
    if (!index.exists) return null;
    return this.findById((index.data() as { userId: string }).userId);
  }

  private async buildSession(user: StoredUser): Promise<SessionResponse> {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '1h');
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: expiresIn as JwtSignOptions['expiresIn'] },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get<number>('REFRESH_TOKEN_DAYS', 30);

    await this.firebase.db
      .collection(COLLECTIONS.refreshTokens)
      .doc(hashToken(refreshToken))
      .set({
        userId: user.id,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        revokedAt: null,
        createdAt: new Date().toISOString(),
      });

    return {
      user: toUserResponse(user),
      accessToken,
      refreshToken,
      expiresIn: parseDuration(expiresIn),
    };
  }
}

/** Guardamos solo el hash: si se filtra la base, los tokens no sirven. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

/** '1h' → 3600. Solo para informar al cliente cuándo renovar. */
function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return 3600;
  const amount = Number(match[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]] ?? 1;
  return amount * unit;
}
