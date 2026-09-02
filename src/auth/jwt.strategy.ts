import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { COLLECTIONS, type UserDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

type JwtPayload = { sub: string; email: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly firebase: FirebaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Verificamos contra Firestore para que un token de una cuenta borrada no sirva. */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const snapshot = await this.firebase.db.collection(COLLECTIONS.users).doc(payload.sub).get();
    const user = snapshot.data() as UserDoc | undefined;

    if (!user) throw new UnauthorizedException('La sesión ya no es válida.');
    return { id: snapshot.id, email: user.email };
  }
}
