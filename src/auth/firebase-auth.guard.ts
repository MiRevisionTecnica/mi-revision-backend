import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getAuth } from 'firebase-admin/auth';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator.js';

/**
 * Guard global: todo pide token salvo lo marcado con @Public().
 *
 * El token lo emite Firebase Authentication y lo verifica el SDK de administrador
 * contra las claves públicas de Google. La API ya no emite ni renueva sesiones:
 * de eso se encarga Firebase, que además maneja el restablecimiento de
 * contraseña y la verificación de correo sin que tengamos que enviar nada.
 *
 * El identificador del usuario es el `uid` de Firebase, y es el mismo con el que
 * se guardan sus documentos en Firestore.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly firebase: FirebaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const encabezado = request.headers.authorization ?? '';
    const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7).trim() : '';

    if (!token) throw new UnauthorizedException('Falta el token de sesión.');

    try {
      // `checkRevoked` en true: si la cuenta se borró o se cerraron las sesiones,
      // un token que aún no vence deja de servir en el acto.
      const payload = await getAuth(this.firebase.app).verifyIdToken(token, true);

      if (!payload.email) {
        throw new UnauthorizedException('La cuenta no tiene correo asociado.');
      }

      request.user = { id: payload.uid, email: payload.email };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Tu sesión terminó. Vuelve a iniciar sesión.');
    }
  }
}
