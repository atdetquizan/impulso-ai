import { IsEmail, IsString } from 'class-validator';

export class MagicLinkDto {
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' }) email!: string;
}

export class CreateSessionDto {
  @IsString() accessToken!: string;
  @IsString() refreshToken!: string;
}
