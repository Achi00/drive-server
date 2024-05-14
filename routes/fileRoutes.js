const express = require("express");
const multer = require("multer");
const File = require("../models/File");
const User = require("../models/User");
const path = require("path");
const router = express.Router();
const { Storage } = require("@google-cloud/storage");
const googleDocsApi = require("../config/googleDocsApi");
const { google } = require("googleapis");

const storage = new Storage({
  keyFilename: path.join(__dirname, "../gcloud.json"),
});
const bucketName = process.env.GCLOUD_BUCKET;
const bucket = storage.bucket(bucketName);

const gcsStorage = multer.memoryStorage();

async function exportHtmlFromDocument(documentId, docs) {
  try {
    const res = await docs.documents.get({
      documentId: documentId,
      fields: "body.content",
    });

    const content = res.data.body.content;
    let html = "";

    for (const element of content) {
      if (element.paragraph) {
        const paragraph = element.paragraph;
        const elements = paragraph.elements;

        for (const el of elements) {
          if (el.textRun) {
            const text = el.textRun.content;
            html += text;
          }
        }

        html += "<br>"; // Add a line break after each paragraph
      }
    }

    return html;
  } catch (error) {
    console.error("Error exporting HTML from document:", error);
    throw error;
  }
}

// Define the file filter to check supported types
const fileFilter = (req, file, cb) => {
  const supportedTypes = [
    "image/jpeg",
    "image/png",
    "application/pdf",
    "text/plain",
  ];
  if (!supportedTypes.includes(file.mimetype)) {
    req.fileValidationError = req.fileValidationError || [];
    req.fileValidationError.push(
      file.originalname + " rejected due to unsupported file type"
    );
    cb(null, false); // Reject unsupported files
  } else {
    cb(null, true); // Accept supported files
  }
};

const upload = multer({
  storage: gcsStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // for example, 10 MB limit
}).array("files", 5);

const isAuthenticated = (req, res, next) => {
  if (!req.user) {
    return res.status(401).send("User not authenticated");
  }
  next();
};

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

async function refreshAccessToken(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:8080/auth/google/callback"
  );

  oauth2Client.setCredentials({
    refresh_token: user.refreshToken,
  });

  try {
    const { tokens } = await oauth2Client.refreshAccessToken();
    user.accessToken = tokens.access_token;
    await user.save();
    return user.accessToken;
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw error;
  }
}

router.get("/export-html", isAuthenticated, async (req, res) => {
  const documentId = "1GTRxFdGf8fGXlnQ2NWgrftrCmybyEeCdTM9wOFWmrug";

  try {
    const user = await User.findById(req.user._id);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "http://localhost:8080/auth/google/callback"
    );
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    const docs = google.docs({
      version: "v1",
      auth: oauth2Client,
    });

    const html = await exportHtmlFromDocument(documentId, docs);
    res.send(html);
  } catch (error) {
    console.error("Error exporting HTML:", error);
    res.status(500).send("Error exporting HTML");
  }
});

// List all files
router.get("/getfiles", isAuthenticated, async (req, res) => {
  try {
    const { parent } = req.query;
    const query = {
      $or: [{ user: req.user._id }, { isPublic: true }],
    };

    if (parent) {
      query.parent = parent;
    } else {
      query.$or.push({ parent: { $exists: false } }, { parent: null });
    }

    const files = await File.find(query);

    // Check if any files are private and don't belong to the user
    const privateFiles = await File.find({
      _id: { $nin: files.map((file) => file._id) },
      isPublic: false,
    });

    if (privateFiles.length > 0) {
      return res
        .status(403)
        .json({ message: "Some files are private and cannot be accessed." });
    }

    res.json(files);
  } catch (error) {
    res.status(500).send("Failed to retrieve files.");
  }
});
router.get("/files/:fileId/content", isAuthenticated, async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).send("File not found.");
    }

    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).send("Access denied.");
    }

    if (file.type === "file" && file.fileType === "text/plain") {
      return res.send(file.content);
    } else {
      return res.status(400).send("File content not available.");
    }
  } catch (error) {
    res.status(500).send("Error fetching file content: " + error.message);
  }
});

let docs;
// upload files
router.post(
  "/upload",
  isAuthenticated,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "http://localhost:8080/auth/google/callback"
      );

      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
      });

      docs = google.docs({
        version: "v1",
        auth: oauth2Client,
      });

      user.storageLimit = user.storageLimit || 1024 * 1024 * 1024;

      upload(req, res, function (error) {
        if (
          error instanceof multer.MulterError &&
          error.code === "LIMIT_UNEXPECTED_FILE"
        ) {
          return res.status(400).json({
            message: "Error: Too many files. Maximum 5 files allowed.",
          });
        } else if (error) {
          return res.status(500).send(error.message);
        }

        const rejectedFiles = req.fileValidationError || [];
        if (
          (!req.files || req.files.length === 0) &&
          rejectedFiles.length === 0
        ) {
          return res.status(400).json({
            message: "No files were provided for upload.",
          });
        }

        const totalSizeOfNewFiles = (req.files || []).reduce(
          (acc, file) => acc + file.size,
          0
        );
        const newStorageTotal = user.totalStorageUsed + totalSizeOfNewFiles;

        if (newStorageTotal > user.storageLimit) {
          return res.status(400).json({
            message: "Storage limit exceeded. Unable to upload more files.",
          });
        }

        req.rejectedFiles = rejectedFiles;
        next();
      });
    } catch (error) {
      console.error("Error during file upload:", error);
      return res.status(500).send("Server error while checking user storage.");
    }
  },
  async (req, res) => {
    const results = {
      uploaded: [],
      rejected: req.rejectedFiles || [],
      duplicates: [],
      totalStorageUsed: 0,
      location: null,
      isPublic: req.body.isPublic || false,
    };

    const fileNames = new Set();
    const uploads = (req.files || []).map((file) => {
      const uniqueFileName = `${req.user._id}_${Date.now()}_${
        file.originalname
      }`;

      if (fileNames.has(uniqueFileName)) {
        results.duplicates.push(file.originalname);
        return Promise.resolve();
      }
      fileNames.add(uniqueFileName);

      const blob = bucket.file(uniqueFileName);
      const blobStream = blob.createWriteStream({
        resumable: false,
      });

      return new Promise((resolve, reject) => {
        blobStream.on("error", (err) => reject(err));
        blobStream.on("finish", async () => {
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
          const newFile = new File({
            user: req.user._id,
            name: file.originalname,
            uniqueName: uniqueFileName,
            size: file.size,
            fileType: file.mimetype,
            path: publicUrl,
            parent: req.body.parent || undefined,
            content:
              file.mimetype === "text/plain"
                ? file.buffer.toString()
                : undefined,
            isPublic: req.body.isPublic || false,
            createdAt: new Date(),
            googleDocId: undefined,
          });

          if (file.mimetype === "text/plain") {
            try {
              const doc = await docs.documents.create({
                requestBody: {
                  title: file.originalname,
                },
              });
              newFile.googleDocId = doc.data.documentId;
            } catch (error) {
              console.error("Error creating Google Doc:", error);
            }
          }

          await newFile.save();
          results.uploaded.push(file.originalname);
          results.totalStorageUsed += file.size;
          resolve();
        });
        blobStream.end(file.buffer);
      });
    });

    try {
      await Promise.all(uploads);
    } catch (error) {
      return res.status(500).send("Error uploading files: " + error.message);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $inc: { totalStorageUsed: results.totalStorageUsed },
      },
      { new: true }
    );

    if (req.body.parent) {
      try {
        const parentFolder = await File.findById(req.body.parent);
        if (parentFolder && parentFolder.type === "folder") {
          results.location = parentFolder.name;
        }
      } catch (error) {
        console.error("Error retrieving parent folder:", error);
      }
    }

    const formattedStorage = formatBytes(updatedUser.totalStorageUsed);
    const availableStorage = Math.max(
      updatedUser.storageLimit - updatedUser.totalStorageUsed,
      0
    );
    const formattedAvailableStorage = formatBytes(availableStorage);

    if (
      results.uploaded.length > 0 ||
      results.rejected.length > 0 ||
      results.duplicates.length > 0
    ) {
      res.status(207).json({
        message: "File upload completed with some issues.",
        uploaded: results.uploaded,
        rejected: results.rejected,
        duplicates: results.duplicates,
        location: results.location,
        isPublic: results.isPublic,
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    } else {
      res.status(201).json({
        message: "All files uploaded successfully",
        uploaded: results.uploaded,
        location: results.location,
        isPublic: results.isPublic,
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    }
  }
);

router.post("/folders", isAuthenticated, async (req, res) => {
  try {
    const { name, parent } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }
    const newFolder = new File({
      user: req.user._id,
      name,
      parent: parent || undefined,
      type: "folder",
    });
    await newFolder.save();
    res.status(201).json(newFolder);
  } catch (error) {
    res.status(500).send("Error creating folder: " + error.message);
  }
});

// edit with google docs
router.post("/files/:fileId/edit", isAuthenticated, async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const user = await User.findById(req.user._id);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "http://localhost:8080/auth/google/callback"
    );
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    const docs = google.docs({
      version: "v1",
      auth: oauth2Client,
    });

    // Get the current content of the Google Docs document
    const currentDocument = await docs.documents.get({
      documentId: file.googleDocId,
    });

    // Replace the entire document content with an empty string
    await docs.documents.batchUpdate({
      documentId: file.googleDocId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: {
                text: "{{content}}",
                matchCase: false,
              },
              replaceText: "",
            },
          },
        ],
      },
    });

    // Insert the updated content from the database into the Google Docs document
    await docs.documents.batchUpdate({
      documentId: file.googleDocId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: {
                index: 1,
              },
              text: file.content,
            },
          },
        ],
      },
    });

    // Generate the Google Docs edit URL
    const editUrl = `https://docs.google.com/document/d/${file.googleDocId}/edit`;

    return res.status(200).json({ editUrl });
  } catch (error) {
    console.error("Error generating edit URL:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// save google docs changes on mongodb
router.put("/files/:fileId/content", isAuthenticated, async (req, res) => {
  try {
    const { fileId } = req.params;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Get the user's OAuth2Client instance
    const user = await User.findById(req.user._id);
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      "http://localhost:8080/auth/google/callback"
    );
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    const docs = google.docs({
      version: "v1",
      auth: oauth2Client,
    });

    // Get the document content from Google Docs API
    const doc = await docs.documents.get({
      documentId: file.googleDocId,
    });

    // Extract the plain text content from the document
    const content = doc.data.body.content
      .map((element) => {
        if (element.paragraph) {
          return element.paragraph.elements
            .map((el) => el.textRun?.content || "")
            .join("");
        }
        return "";
      })
      .join("\n");

    // Update the file content in MongoDB
    file.content = content;
    await file.save();

    return res
      .status(200)
      .json({ message: "File content updated successfully" });
  } catch (error) {
    console.error("Error updating file content:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// Download a file
router.get("/download/:fileId", isAuthenticated, async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).send("File not found.");
    }

    // Check if the authenticated user has permission to access the file
    if (file.user.toString() === req.user._id.toString()) {
      // Generate a signed URL for the file
      const options = {
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
      };

      const [url] = await bucket.file(file.uniqueName).getSignedUrl(options);
      return res.redirect(url);
    } else {
      // User does not have permission to access the file
      return res.status(403).send("Access denied.");
    }
  } catch (error) {
    res.status(500).send("Error downloading file: " + error.message);
  }
});

// Delete a file
router.delete("/:fileId", async (req, res) => {
  try {
    await File.findByIdAndDelete(req.params.fileId);
    res.status(200).send("File deleted successfully");
  } catch (error) {
    res.status(500).send("Error deleting file: " + error.message);
  }
});

module.exports = router;
