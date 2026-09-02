import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import {
  COLLECTIONS,
  type AuthProvider,
  type RefreshTokenDoc,
  type UserDoc,
} from '../firebase/collections.js';
import { GoogleAuthService } from './google.service.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type {
  LoginDto,
  RegisterDto,
  SessionResponse,
  UpdateProfileDto,
  UserResponse,
} from './dto/auth.dto.js';

const BCRYPT_ROUNDS = 12;

type StoredUser = UserDoc & { id: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly firebase: FirebaseService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly google: GoogleAuthService,
  ) {}

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
  async loginWithGoogle(idToken: string): Promise<SessionResponse> {
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
      ...(dto.emailReminders !== undefined ? { emailReminders: dto.emailReminders } : {}),
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
