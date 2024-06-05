const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const File = require("../models/File");
const User = require("../models/User");
const path = require("path");
const router = express.Router();
const axios = require("axios");
const { Storage } = require("@google-cloud/storage");
const googleDocsApi = require("../config/googleDocsApi");
const { google } = require("googleapis");
const { v4: uuidv4 } = require("uuid");

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
            const style = el.textRun.textStyle || {};
            let formattedText = text;

            // Apply text styles
            if (style.bold) formattedText = `<b>${formattedText}</b>`;
            if (style.italic) formattedText = `<i>${formattedText}</i>`;
            if (style.underline) formattedText = `<u>${formattedText}</u>`;
            if (style.strikethrough) formattedText = `<s>${formattedText}</s>`;

            // Apply font size
            if (style.fontSize && style.fontSize.magnitude) {
              const fontSize = style.fontSize.magnitude;
              formattedText = `<span style="font-size:${fontSize}pt">${formattedText}</span>`;
            }

            html += formattedText;
          } else if (el.inlineObjectElement) {
            const inlineObjectId = el.inlineObjectElement.inlineObjectId;
            const inlineObject = res.data.inlineObjects[inlineObjectId];

            if (
              inlineObject &&
              inlineObject.inlineObjectProperties &&
              inlineObject.inlineObjectProperties.embeddedObject
            ) {
              const embeddedObject =
                inlineObject.inlineObjectProperties.embeddedObject;

              if (embeddedObject.imageProperties) {
                const imageProperties = embeddedObject.imageProperties;
                const contentUri = imageProperties.contentUri;

                try {
                  // Fetch the image data
                  const response = await axios.get(contentUri, {
                    responseType: "arraybuffer",
                  });

                  // Convert the image data to base64
                  const base64Image = Buffer.from(
                    response.data,
                    "binary"
                  ).toString("base64");

                  // Insert the image into the HTML
                  html += `<img src="data:image/png;base64,${base64Image}" alt="Embedded Image">`;
                } catch (error) {
                  console.error("Error fetching image:", error);
                }
              }
            }
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
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // for example, 10 MB limit
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
    "https://drive-server-dksb.onrender.com/auth/google/callback"
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
      "https://drive-server-dksb.onrender.com/auth/google/callback"
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
    const query = {
      user: req.user._id,
      type: "file",
      $or: [{ parent: { $exists: false } }, { parent: null }],
      deletedAt: { $eq: null },
    };

    const files = await File.find(query);
    res.json(files);
  } catch (error) {
    res.status(500).send("Failed to retrieve files.");
  }
});

// list all folders
router.get("/folders", isAuthenticated, async (req, res) => {
  try {
    const query = {
      user: req.user._id,
      type: "folder",
    };

    const folders = await File.find(query);
    res.json(folders);
  } catch (error) {
    res.status(500).send("Failed to retrieve folders.");
  }
});
// get files inside folders
router.get("/folders/:folderId/files", isAuthenticated, async (req, res) => {
  try {
    const folderId = req.params.folderId;

    const query = {
      user: req.user._id,
      parent: folderId,
    };

    const files = await File.find(query);
    res.json(files);
  } catch (error) {
    res.status(500).send("Failed to retrieve files.");
  }
});

// get single file details by _id
router.get("/files/:fileId", async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId);

    console.log("File:", file);

    if (!file) {
      console.log("File not found");
      return res.status(404).send("File not found.");
    }

    if (
      !file.isPublic &&
      (!req.user || file.user.toString() !== req.user._id.toString())
    ) {
      console.log("Access denied. User:", req.user);
      return res.status(403).send("Access denied.");
    }

    res.json(file);
  } catch (error) {
    console.error("Error fetching file:", error);
    res.status(500).send("Error fetching file: " + error.message);
  }
});
// get content field for txt file
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
        "https://drive-server-dksb.onrender.com/auth/google/callback"
      );

      oauth2Client.setCredentials({
        access_token: user.accessToken,
        refresh_token: user.refreshToken,
      });

      docs = google.docs({ version: "v1", auth: oauth2Client });

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
          return res
            .status(400)
            .json({ message: "No files were provided for upload." });
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
    };

    const fileNames = new Set();
    const uploads = (req.files || []).map(async (file) => {
      let uniqueFileName = `${req.user._id}_${Date.now()}_${file.originalname}`;
      const isPublic = req.body.isPublic === "true"; // Get isPublic from request body

      if (fileNames.has(uniqueFileName)) {
        results.duplicates.push(file.originalname);
        return Promise.resolve();
      }
      fileNames.add(uniqueFileName);

      let buffer = file.buffer;
      let converted = false;

      if (
        file.mimetype === "image/jpeg" ||
        file.mimetype === "image/png" ||
        file.mimetype === "image/gif"
      ) {
        // Convert image to WebP
        buffer = await sharp(buffer).webp().toBuffer();
        uniqueFileName = uniqueFileName.replace(/\.\w+$/, ".webp");
        converted = true;
      }

      const blob = bucket.file(uniqueFileName);
      const blobStream = blob.createWriteStream({
        resumable: false,
        metadata: {
          contentType: converted ? "image/webp" : file.mimetype,
          metadata: {
            originalMimeType: file.mimetype, // Add original MIME type as custom metadata
          },
        },
      });

      return new Promise((resolve, reject) => {
        blobStream.on("error", (err) => reject(err));
        blobStream.on("finish", async () => {
          const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
          const newFile = new File({
            user: req.user._id,
            name: file.originalname,
            uniqueName: uniqueFileName,
            size: buffer.length, // Update size to the new buffer size
            fileType: converted ? "image/webp" : file.mimetype, // Update fileType to webp if converted
            path: publicUrl,
            parent: req.body.parent || undefined,
            content:
              file.mimetype === "text/plain"
                ? file.buffer.toString()
                : undefined,
            isPublic: isPublic,
            createdAt: new Date(),
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
          results.totalStorageUsed += buffer.length;
          resolve();
        });
        blobStream.end(buffer);
      });
    });

    try {
      await Promise.all(uploads);
    } catch (error) {
      return res.status(500).send("Error uploading files: " + error.message);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { totalStorageUsed: results.totalStorageUsed } },
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
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    } else {
      res.status(201).json({
        message: "All files uploaded successfully",
        uploaded: results.uploaded,
        location: results.location,
        totalStorageUsed: formattedStorage,
        availableStorage: formattedAvailableStorage,
      });
    }
  }
);

router.post("/folders", isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }
    const uniqueName = uuidv4(); // Generate a unique identifier for the folder
    const newFolder = new File({
      user: req.user._id,
      name,
      uniqueName,
      type: "folder",
    });
    await newFolder.save();
    res.status(201).json(newFolder);
  } catch (error) {
    res.status(500).send("Error creating folder: " + error.message);
  }
});
router.post("/folders", isAuthenticated, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }
    const uniqueName = uuidv4(); // Generate a unique identifier for the folder
    const newFolder = new File({
      user: req.user._id,
      name,
      uniqueName,
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
      "https://drive-server-dksb.onrender.com/auth/google/callback"
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

    // Check if the document is newly created and empty
    const isNewDocument = currentDocument.data.body.content.length === 1;

    if (isNewDocument) {
      // If the document is new, insert the plain text content from the database
      const plainTextContent = extractPlainText(file.content);

      await docs.documents.batchUpdate({
        documentId: file.googleDocId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: {
                  index: 1,
                },
                text: plainTextContent,
              },
            },
          ],
        },
      });
    }

    // Generate the Google Docs edit URL
    const editUrl = `https://docs.google.com/document/d/${file.googleDocId}/edit`;

    return res.status(200).json({ editUrl });
  } catch (error) {
    console.error("Error generating edit URL:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// Helper function to extract plain text from HTML content
function extractPlainText(html) {
  const tempElement = document.createElement("div");
  tempElement.innerHTML = html;
  return tempElement.textContent || tempElement.innerText || "";
}

// Save Google Docs changes on MongoDB
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
      "https://drive-server-dksb.onrender.com/auth/google/callback"
    );
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    const docs = google.docs({
      version: "v1",
      auth: oauth2Client,
    });

    // Export the HTML content from the Google Docs document
    const html = await exportHtmlFromDocument(file.googleDocId, docs);

    // Update the file content in MongoDB with the exported HTML
    file.content = html;
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
router.get("/download/:fileId", async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).send("File not found.");
    }

    // Check if the file is public or if the user is authenticated and has permission to access the file
    if (
      file.isPublic ||
      (req.user && file.user.toString() === req.user._id.toString())
    ) {
      // Generate a signed URL for the file
      const options = {
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
      };

      const [url] = await bucket.file(file.uniqueName).getSignedUrl(options);
      return res.json({ url });
    } else {
      return res.status(403).send("Access denied.");
    }
  } catch (error) {
    res.status(500).send("Error downloading file: " + error.message);
  }
});

router.get("/downloadfile/:fileId", async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId);

    if (!file) {
      return res.status(404).send("File not found.");
    }

    // Check if the file is public or if the user is authenticated and has permission to access the file
    if (
      file.isPublic ||
      (req.user && file.user.toString() === req.user._id.toString())
    ) {
      const options = {
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // URL expires in 15 minutes
      };

      const [url] = await bucket.file(file.uniqueName).getSignedUrl(options);

      // Set the necessary headers for file download
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.name}"`
      );
      res.setHeader("Content-Type", file.fileType);

      // Send the URL to the client
      return res.json({ url });
    } else {
      return res.status(403).send("Access denied.");
    }
  } catch (error) {
    res.status(500).send("Error downloading file: " + error.message);
  }
});

// list all files in trash
router.get("/trash", isAuthenticated, async (req, res) => {
  try {
    const files = await File.find({
      user: req.user._id,
      deletedAt: { $ne: null },
    });
    res.json(files);
  } catch (error) {
    res.status(500).send("Error retrieving files from trash: " + error.message);
  }
});

// move files to trash
router.post("/files/:fileId/trash", isAuthenticated, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).send("File not found.");
    }
    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).send("Access denied.");
    }

    file.deletedAt = new Date();
    await file.save();
    res.status(200).send("File moved to trash successfully");
  } catch (error) {
    res.status(500).send("Error moving file to trash: " + error.message);
  }
});

// restore files from trash
router.post("/files/:fileId/restore", isAuthenticated, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).send("File not found.");
    }
    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).send("Access denied.");
    }

    file.deletedAt = null;
    await file.save();
    res.status(200).send("File restored from trash successfully");
  } catch (error) {
    res.status(500).send("Error restoring file from trash: " + error.message);
  }
});

// Delete a file permanently
router.delete("/files/:fileId/permanent", isAuthenticated, async (req, res) => {
  try {
    const file = await File.findById(req.params.fileId);
    if (!file) {
      return res.status(404).send("File not found.");
    }
    if (file.user.toString() !== req.user._id.toString()) {
      return res.status(403).send("Access denied.");
    }

    await file.deleteOne();
    res.status(200).send("File permanently deleted successfully");
  } catch (error) {
    res.status(500).send("Error deleting file: " + error.message);
  }
});

module.exports = router;
