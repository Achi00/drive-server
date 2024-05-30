const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true },
  size: {
    type: Number,
    required: function () {
      return this.type === "file";
    },
  },
  fileType: {
    type: String,
    required: function () {
      return this.type === "file";
    },
  },
  path: {
    type: String,
    required: function () {
      return this.type === "file";
    },
  },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
  content: { type: String },
  googleDocId: { type: String },
  type: { type: String, enum: ["file", "folder"], default: "file" },
  uniqueName: { type: String, required: true },
  isPublic: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("File", fileSchema);
