import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";
import { Injectable } from "@nestjs/common";
import { AuthService, GoogleUser } from "../auth.service";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(
    private authService: AuthService,
  ) {
    const clientID = process.env.OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "placeholder";
    const clientSecret = process.env.OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "placeholder";
    const callbackURL =
      process.env.GOOGLE_CALLBACK_URL ||
      "http://localhost:3000/api/auth/google/callback";

    // Chỉ log CÓ/KHÔNG, tuyệt đối không log mảnh nào của secret: log BE được gom về Railway và
    // đọc được bởi mọi người có quyền xem deploy. 8 ký tự cuối tưởng vô hại nhưng là 8 ký tự
    // người tấn công khỏi phải đoán, và nó nằm lại trong log vĩnh viễn.
    console.log("[GoogleStrategy] ENV CHECK:", {
      OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID ? "SET" : "MISSING",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "MISSING",
      OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET ? "SET" : "MISSING",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "MISSING",
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL ? "SET" : "MISSING",
      callbackURL,
    });

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ["email", "profile"],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { name, emails, photos, id } = profile;
    const googleUser: GoogleUser = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      googleId: id,
      accessToken,
    };

    // Check if user exists
    const validatedUser = await this.authService.validateGoogleUser(googleUser);

    if (validatedUser && !(validatedUser as any).is_active) {
      // Tài khoản đã bị vô hiệu hóa — dùng sentinel (không throw) để googleAuthRedirect
      // đưa về /login kèm thông báo; throw ở đây sẽ thành trang 401 JSON thô.
      done(null, { isInactiveUser: true });
    } else if (validatedUser) {
      // Existing user - return user object
      done(null, validatedUser);
    } else {
      // New user (email chưa được Admin/Leader tạo tài khoản) - return flag
      done(null, { ...googleUser, isNewUser: true });
    }
  }
}
