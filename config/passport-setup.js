const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        "https://drive-server-dksb.onrender.com/auth/google/callback", // Use localhost for local testing
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email =
          profile.emails && profile.emails.length > 0
            ? profile.emails[0].value
            : null;
        const photo =
          profile.photos && profile.photos.length > 0
            ? profile.photos[0].value
            : null;

        if (!email) {
          throw new Error("No email associated with this account!");
        }

        let user = await User.findOne({ googleId: profile.id });
        console.log("Profile:", profile);
        if (user) {
          user.accessToken = accessToken;
          user.refreshToken = refreshToken;
          await user.save();
          return done(null, user);
        } else {
          user = new User({
            googleId: profile.id,
            name: profile.displayName,
            email: email,
            picture: photo,
            accessToken: accessToken,
            refreshToken: refreshToken,
          });
          await user.save();
          console.log("New user created: ", user);
          return done(null, user);
        }
      } catch (err) {
        done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
