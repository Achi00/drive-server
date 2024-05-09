const express = require("express");
const passport = require("passport");

const router = express.Router();

router.post("/", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy(function (err) {
      if (err) {
        console.error("Session destroy failed:", err);
        return res
          .status(500)
          .json({ success: false, message: "Failed to log out" });
      }
      res.json({ success: true, message: "Logout successful" });
    });
  });
});

module.exports = router;
