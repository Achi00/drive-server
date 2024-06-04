const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        "https://drive-server-dksb.onrender.com/auth/google/callback",
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

        console.log("Access Token:", accessToken);
        console.log("Refresh Token:", refreshToken);
        console.log("Profile:", profile);

        // Attempt to find the user in the database
        let user = await User.findOne({ googleId: profile.id });
        console.log("Profile:", profile);
        if (user) {
          // If user exists, log them in
          user.accessToken = accessToken;
          user.refreshToken = refreshToken;
          await user.save();
          return done(null, user);
        } else {
          // If user doesn't exist, create a new one
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
        console.error("Error in strategy:", err);
        done(err);
      }
      // return done(new Error("Forced error"));
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
