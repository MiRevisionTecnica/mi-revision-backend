import { ApiProperty } from '@nestjs/swagger';

export class PlanResponse {
  @ApiProperty({ description: 'Si el plan pagado está vigente hoy.' })
  premium!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Hasta cuándo vale, en ISO. null en el pago de por vida o si no hay plan.',
  })
  hasta!: string | null;

  @ApiProperty({ example: 1, description: 'Cuántos vehículos permite este plan.' })
  vehiculos!: number;
}
