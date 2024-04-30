const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  displayName: { type: String, required: true },
  email: { type: String, required: true },
  photoUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  totalStorageUsed: { type: Number, default: 0 },
  storageLimit: { type: Number, default: 1073741824 }, // 1 GB default limit
});

module.exports = mongoose.model("User", userSchema);
