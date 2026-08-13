import { IsEmail, IsString, Length } from 'class-validator';

export class MagicLinkDto {
  @IsEmail({}, { message: 'Ingresa un correo electrónico válido.' }) email!: string;
}

export class CreateSessionDto {
  @IsString()
  @Length(40, 128)
  token!: string;
}

export class VerifyMagicLinkDto extends CreateSessionDto {}
