const fs = require("fs");
const os = require("os");
const svc = require("@slingr/slingr-services");
const { google } = require("googleapis");

let creds;

const reloadCredentials = async () => {
  // attempt to load credentials from datastore
  creds = await svc.dataStores.creds.findOne({ name: "google-credentials" });
  if (!creds) {
    svc.appLogger.info("No credentials found, returning");
    return;
  }
  svc.appLogger.info("Found credentials for " + creds.client_email);
  // console.log('Loaded credentials: ', creds);
};

const getDriveService = () => {
  const SCOPES = ["https://www.googleapis.com/auth/drive"];
  const auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    credentials: creds,
  });
  const driveService = google.drive({ version: "v3", auth });
  return driveService;
};

const getSheetsService = () => {
  const SCOPES = ["https://www.googleapis.com/auth/drive"];
  const auth = new google.auth.GoogleAuth({
    scopes: SCOPES,
    credentials: creds,
  });
  const sheetsService = google.sheets({ version: "v4", auth });
  return sheetsService;
};

svc.hooks.onSvcStart = async () => {
  svc.logger.info("Wagecents converter started");
  await reloadCredentials();
};

svc.hooks.onSvcStop = (cause) => {
  svc.logger.info("Wagecents converter is stopping");
};

svc.functions.setCredentials = async (req) => {
  console.log("Got parameters ", req.params);
  let missingFields = [];
  let expectedFields = [
    "type",
    "project_id",
    "private_key_id",
    "private_key",
    "client_email",
    "client_id",
    "auth_uri",
    "token_uri",
    "auth_provider_x509_cert_url",
    "client_x509_cert_url",
    "universe_domain",
  ];
  let unexpectedFields = [];
  let suppliedFields = Object.keys(req.params);
  for (let k of suppliedFields) {
    if (!expectedFields.find((s) => s == k)) unexpectedFields.push(k);
  }
  for (let k of expectedFields) {
    if (!suppliedFields.find((s) => s == k)) missingFields.push(k);
  }
  if (unexpectedFields.length || missingFields.length) {
    let msg = "Invalid parameters to set credentials: ";
    if (unexpectedFields.length) {
      msg = msg + ` Unexpected fields: ${unexpectedFields.join(", ")}`;
      if (missingFields.length) msg = msg + "; ";
    }
    if (missingFields.length) {
      msg = msg + ` Missing fields: ${missingFields.join(", ")}`;
    }
    return { error: msg };
  }
  if (!creds) {
    creds = {
      name: "google-credentials",
      ...req.params,
    };
    let resp = await svc.dataStores.creds.save(creds);
  } else {
    creds = {
      ...creds,
      ...req.params,
    };
    await svc.dataStores.creds.update(creds);
  }
  await reloadCredentials();
  return { ok: true };
};

svc.functions.listFolders = async (req) => {
  console.log("Starting list folders...");
  const service = getDriveService();

  try {
    let folders = await service.files.list({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      q: `mimeType='application/vnd.google-apps.folder'`,
    });
    console.log(folders.data.files);
    return folders.data.files;
  } catch (err) {
    console.log("Error from google drive: ", err);
    return { error: "Unable to list files on google drive" };
  }
};

svc.functions.getCredentials = async (req) => {
  let deepCopy = JSON.parse(JSON.stringify(creds));
  delete deepCopy.private_key;
  return deepCopy;
};

svc.functions.clearCredentials = async (req) => {
  if (creds) svc.dataStores.remove(creds._id);
  await reloadCredentials();
  console.log(creds);
  return { ok: true };
};

svc.functions.uploadFile = async (req) => {
  let fileId = req?.params?.srcFile;
  let destination = req?.params?.destination;
  if (!fileId) {
    return { error: "No srcFile provided" };
  }
  if (!destination) {
    return { error: "No destination provided" };
  }
  let folderId = req?.params?.folderId;

  let slingrFile = await svc.files.download(fileId);
  let tmpDest = os.tmpdir() + `/${fileId}-${new Date().getTime()}`;
  console.log(tmpDest);
  fs.writeFileSync(tmpDest, slingrFile);

  const fileMetadata = {
    name: req?.params?.destination,
    mimeType: "application/vnd.google-apps.spreadsheet",
  };
  if (folderId) fileMetadata.parents = [folderId];

  const media = {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: fs.createReadStream(tmpDest),
  };

  try {
    const service = getDriveService();

    service.files
      .create({
        resource: fileMetadata,
        media: media,
        supportsAllDrives: true,
      })
      .then((res) => {
        let responseData = {
          googleFileId: res.data.id,
          googleName: res.data.name,
        };
        console.log(
          "File creation complete, submitting fileUploaded event",
          res
        );
        console.log("Callback response data: ", responseData);
        svc.events.send("onUploadComplete", responseData, req.id);
      })
      .finally(() => {
        console.log(`Removing temp file ${tmpDest}`);
        fs.unlinkSync(tmpDest);
      })
      .catch((err) => {
        svc.appLogger.error("Error sending file to google drive", err);
        svc.events.send(
          "onUploadError",
          err?.response?.data?.error ?? err,
          req.id
        );
      });
  } catch (err) {
    svc.appLogger.error("Error sending file to google drive", err);
    return { error: "Error sending file to google drive" };
  }
  return { ok: true };
};

svc.functions.downloadCsv = async (req) => {
  console.log("starting downloadCsv", req);
  let googleFileId = req?.params?.googleId;
  if (!googleFileId) return { error: "No googleFileId to download" };
  let range = req?.params?.range;
  if (!range) range = "Sheet1!A1:Z100";

  try {
    const drive = getDriveService();
    let info = await drive.files.get({
      fileId: googleFileId,
      supportsAllDrives: true,
    });
    let fileName = info.data.name;
    console.log("Using file name " + fileName);
    const service = getSheetsService();
    service.spreadsheets.values
      .get({ spreadsheetId: googleFileId, range: range })
      .then((response) => {
        const data = response.data.values || [];
        const csvContant = data
          .map((row) =>
            row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
          )
          .join("\n");
        try {
          svc.files.upload(fileName, csvContant).then((data) => {
            if(! data) {
              console.log('No file created in slingr, raising an error');
              svc.appLogger.warn('No file created in slingr, possibly due to an empty file');
              throw "No file created in slingr";
            }
            console.log("Got app data", data);
            svc.events.send("onDownloadComplete", data, req.id);
          }).catch((err) => {
            svc.appLogger.error("Error saving CSV file:", err);
            svc.events.send("onDownloadError", err?.response?.data?.error ?? err, req.id);  
          });
        } catch (err) {
          svc.appLogger.error("Error saving CSV file:", err);
          svc.events.send("onDownloadError", err?.response?.data?.error ?? err, req.id);
        }
      })
      .catch((err) => {
        console.log("Error handler");
        svc.appLogger.error(
          `Service Error: Unable to parse range "${range}".`,
          err
        );
        svc.events.send(
          "onDownloadError",
          err?.response?.data?.error ?? err,
          req.id
        );
        console.log("On download error sent");
      });
    return { ok: true };
  } catch (err) {
    svc.appLogger.error("Error downloading data: ", err);
  }
};

svc.functions.getSheetTitles = async (req) => {
  const spreadsheetId = req?.params?.spreadsheetId;
  if (!spreadsheetId) {
    return { error: "No spreadsheetId provided" };
  }

  try {
    const sheetsService = getSheetsService();

    const response = await sheetsService.spreadsheets.get({
      spreadsheetId,
    });

    const sheetTitles = response.data.sheets.map(
      (sheet) => sheet.properties.title
    );

    return { success: true, sheets: sheetTitles };
  } catch (err) {
    svc.appLogger.error("Error retrieving sheets data", err);
    return { error: "Error retrieving sheets data" };
  }
};

svc.functions.deleteFile = async (req) => {
  const fileId = req?.params?.fileId;
  if (!fileId) {
    return { error: "No fileId provided" };
  }

  try {
    const driveService = getDriveService();

    const body_value = {
        'trashed': true
    }

    await driveService.files.update({
      fileId: fileId,
      supportsAllDrives: true,
      requestBody: body_value
    });

    return {
      success: true,
      message: `File with ID ${fileId} deleted successfully`,
    };
  } catch (err) {
    svc.appLogger.error("Error deleting file from Google Drive", err);
    return { error: "Error deleting file from Google Drive" };
  }
};

// actuall run the service
svc.start();
