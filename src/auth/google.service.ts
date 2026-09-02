import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export type GoogleProfile = {
  /** Claim "sub": identificador estable del usuario en Google. */
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  photoUrl: string | null;
};

/**
 * Verificación del ID token de Google.
 *
 * La app obtiene el token con el flujo nativo de Google y lo manda aquí; el
 * backend comprueba la firma contra las claves públicas de Google y que la
 * audiencia sea uno de nuestros client ID. La app nunca habla con Firebase, y
 * un token robado de otra aplicación no sirve porque la audiencia no calza.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return this.audiences().length > 0;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    const audience = this.audiences();

    if (audience.length === 0) {
      throw new ServiceUnavailableException(
        'El inicio de sesión con Google no está configurado en el servidor.',
      );
    }

    let payload;
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch (error) {
      this.logger.warn(
        `ID token de Google rechazado: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('No pudimos validar tu cuenta de Google.');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('La cuenta de Google no entregó un correo.');
    }

    // Google marca como no verificados los correos de dominios que no controla.
    // Sin esa garantía, cualquiera podría reclamar el correo de otra persona.
    if (!payload.email_verified) {
      throw new UnauthorizedException(
        'Tu correo de Google no está verificado. Verifícalo antes de continuar.',
      );
    }

    return {
      googleId: payload.sub,
      email: payload.email.trim().toLowerCase(),
      emailVerified: true,
      name: payload.name?.trim() || payload.email.split('@')[0],
      photoUrl: payload.picture ?? null,
    };
  }

  private audiences(): string[] {
    return (this.config.get<string>('GOOGLE_OAUTH_CLIENT_IDS') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
