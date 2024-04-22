
# Overview

This is a basic service that lets us send excell files to Google Drive, and then download them as CSV files

# Javascript API

## Functions

### uploadFile

**Label:** Upload File
**Name:** uploadFile
**Description:** Upload a file to google drive for conversion
**Callbacks:** onUploadComplete - this gets called when the upload to google drive has been completed

```
let res = svc.proxy.uploadFile({srcFile: '66265f5242571119f6f08975', folderId: '1TzVHo9a9q_g2LFVCOmX4xvVbCFU33Q9T', destination: 'myTestFile'}, {record: 'asdfxyx'}, {
  onUploadComplete: function (res, data) {
    sys.logs.info(`Upload completed event, source record ${data.record}`);
    sys.logs.info(`Uploaded test file to google file id: ${res.data.googleFileId}`);
  }
});
```

### setCredentials

**Label:** Set Credentials
**Name:** setCredentials
**Description:** Set the google service account credentials in the datastore

This function is used to set the google key file to be used for authentication with google.  The JSON should be sent as the parameter.

[Key File Creation](https://cloud.google.com/iam/docs/keys-create-delete)

```
let res = svc.proxy.setCredentials({
   "type": "service_account",
   "project_id": "wagecents-integrations",
   "private_key_id": "<keyId>",
   "private_key": "<privateKeyContnet>",
   "client_email": "<serviceAccountEmail>",
   "client_id": "116828514187771991932",
   "auth_uri": "https://accounts.google.com/o/oauth2/auth",
   "token_uri": "https://oauth2.googleapis.com/token",
   "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
   "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/drive-access%40wagecents-integrations.iam.gserviceaccount.com",
   "universe_domain": "googleapis.com",
});
```

### listFolders

**Label:** List Folders
**Name:** listFolders
**Description:** Returns the list of folders the current credentials has access to

This function queries Google Drive for the various folders the currently authenticated account has access to.

```
let res = svc.proxy.listFolders();
log(JSON.stringify(res));
```

This will return an array of results like:
```
[
  {
    "kind": "drive#file",
    "driveId": "0AM-x8k98VucXUk9PVA",
    "mimeType": "application/vnd.google-apps.folder",
    "id": "1TzVHo9a9q_g2LFVCOmX4xvVbCFU33Q9T",
    "name": "conversion_temp",
    "teamDriveId": "0AM-x8k98VucXUk9PVA"
  }
]
```