import { Body, Controller, Headers, Ip, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class RegisterDto {
  @IsEmail() email!: string;
  @IsString() phoneE164!: string;
  @IsString() displayName!: string;
  @IsString() @MinLength(12) password!: string;
  @IsOptional() @IsString() deviceId?: string;
}

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() deviceId?: string;
}

class RefreshDto {
  @IsString() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') ua: string | undefined,
    @Ip() ip: string,
  ) {
    return this.auth.register(dto.email, dto.phoneE164, dto.displayName, dto.password, {
      ip,
      userAgent: ua,
      deviceId: dto.deviceId,
    });
  }

  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') ua: string | undefined,
    @Ip() ip: string,
  ) {
    return this.auth.login(dto.email, dto.password, { ip, userAgent: ua, deviceId: dto.deviceId });
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Headers('user-agent') ua: string | undefined, @Ip() ip: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
