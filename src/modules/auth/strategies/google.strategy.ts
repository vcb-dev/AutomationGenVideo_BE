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
      "http://localhost:3000/auth/google/callback";

    console.log("[GoogleStrategy] ENV CHECK:", {
      OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID ? "SET" : "MISSING",
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? "SET" : "MISSING",
      OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET ? "SET" : "MISSING",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? "SET" : "MISSING",
      GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL ? "SET" : "MISSING",
    });
    console.log("[GoogleStrategy] clientID:", clientID ? clientID.substring(0, 20) + "..." : "MISSING");
    console.log("[GoogleStrategy] clientSecret last8:", clientSecret ? "..." + clientSecret.slice(-8) : "MISSING");
    console.log("[GoogleStrategy] callbackURL:", callbackURL);

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

    if (validatedUser) {
      // Existing user - return user object
      done(null, validatedUser);
    } else {
      // New user - return Google profile data with a flag
      done(null, { ...googleUser, isNewUser: true });
    }
  }
}
