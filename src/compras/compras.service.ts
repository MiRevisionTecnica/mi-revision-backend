import { Injectable, Logger } from '@nestjs/common';
import { COLLECTIONS, type UserDoc } from '../firebase/collections.js';
import { FirebaseService } from '../firebase/firebase.service.js';
import { planVigente, vehiculosPermitidos, type Plan } from './plan.js';

/**
 * El plan pagado de cada cuenta.
 *
 * Quien cobra es la tienda --Google Play y App Store, obligatorio para vender
 * funciones digitales-- y RevenueCat nos avisa qué pasó: alguien pagó, renovó,
 * canceló o pidió devolución. Ese aviso es la única fuente de verdad; la app
 * nunca decide sola si tiene premium, porque eso se falsifica en un minuto.
 *
 * Lo que se guarda es **hasta cuándo** vale el plan, no un "sí". Una
 * suscripción cancelada sigue valiendo hasta que termine lo pagado, y una
 * devolución lo corta al instante.
 */

/** Los avisos de RevenueCat que nos importan, agrupados por lo que significan. */
const DA_ACCESO = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'TRANSFER',
]);

const QUITA_ACCESO = new Set(['CANCELLATION', 'EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED']);

export type AvisoDeCompra = {
  type: string;
  app_user_id?: string;
  product_id?: string;
  /** Milisegundos desde 1970. Ausente en el pago único, que no vence. */
  expiration_at_ms?: number | null;
  period_type?: string;
  cancel_reason?: string;
};

@Injectable()
export class ComprasService {
  private readonly logger = new Logger(ComprasService.name);

  constructor(private readonly firebase: FirebaseService) {}

  /** El plan de una cuenta, recalculado con la fecha de hoy. */
  async plan(userId: string): Promise<{ premium: boolean; hasta: string | null; vehiculos: number }> {
    const doc = await this.firebase.db.collection(COLLECTIONS.users).doc(userId).get();
    const plan = (doc.data() as UserDoc | undefined)?.plan ?? undefined;

    return {
      premium: planVigente(plan),
      hasta: plan?.hasta ?? null,
      vehiculos: vehiculosPermitidos(plan),
    };
  }

  /**
   * Anota lo que informó la tienda.
   *
   * Un aviso que no reconocemos no se descarta en silencio: queda en el log. Si
   * mañana RevenueCat agrega un tipo nuevo, preferimos enterarnos ahí y no por
   * un usuario que pagó y no recibió lo suyo.
   */
  async registrar(aviso: AvisoDeCompra): Promise<'activado' | 'desactivado' | 'ignorado'> {
    const userId = aviso.app_user_id;
    if (!userId) {
      this.logger.warn(`Aviso de compra sin cuenta (${aviso.type}): no se puede aplicar.`);
      return 'ignorado';
    }

    if (DA_ACCESO.has(aviso.type)) {
      const plan: Plan = {
        activo: true,
        // Sin fecha de término es el pago de por vida.
        hasta: aviso.expiration_at_ms ? new Date(aviso.expiration_at_ms).toISOString() : null,
        tipo: tipoDe(aviso.product_id),
      };

      await this.guardar(userId, plan);
      this.logger.log(`Plan activado para ${userId} (${aviso.type}, ${plan.tipo ?? 'sin tipo'})`);
      return 'activado';
    }

    if (QUITA_ACCESO.has(aviso.type)) {
      // CANCELLATION es "no va a renovar", no "se acabó ahora": el acceso sigue
      // hasta la fecha pagada. Solo la devolución lo corta en el acto.
      const cortaAhora = aviso.type === 'REFUND' || aviso.type === 'EXPIRATION';

      await this.guardar(userId, {
        activo: !cortaAhora,
        hasta: cortaAhora
          ? new Date().toISOString()
          : aviso.expiration_at_ms
            ? new Date(aviso.expiration_at_ms).toISOString()
            : null,
        tipo: tipoDe(aviso.product_id),
      });

      this.logger.log(`Plan dado de baja para ${userId} (${aviso.type})`);
      return 'desactivado';
    }

    this.logger.log(`Aviso de compra sin efecto: ${aviso.type}`);
    return 'ignorado';
  }

  private async guardar(userId: string, plan: Plan): Promise<void> {
    await this.firebase.db
      .collection(COLLECTIONS.users)
      .doc(userId)
      .set({ plan, updatedAt: new Date().toISOString() }, { merge: true });
  }
}

/** 'premium_anual' → 'anual'. Sirve para saber qué compró sin mirar la tienda. */
function tipoDe(productId?: string): string | undefined {
  if (!productId) return undefined;
  if (/anual|annual|year/i.test(productId)) return 'anual';
  if (/mensual|month/i.test(productId)) return 'mensual';
  if (/unico|lifetime|total/i.test(productId)) return 'unico';
  return productId;
}
