
const fs = require('fs');
const svc = require('@slingr/slingr-services');
// const {GoogleAuth} = require('google-auth-library');
const {google} = require('googleapis');

let creds;

const reloadCredentials = async () => {
    // attempt to load credentials from datastore
    creds = await svc.dataStores.dataStore1.findOne({  name: 'google-credentials'});
    if(! creds) {
        console.log('No credentials found, returning');
        return;
    }
    console.log('Loaded credentials: ', creds);
}

const getDriveService = () => {
    const SCOPES = ['https://www.googleapis.com/auth/drive'];
    const auth = new google.auth.GoogleAuth({
        scopes: SCOPES,
        credentials: creds,
    });
    const driveService = google.drive({version: 'v3', auth });
    return driveService;
}

const getSheetsService = () => {
    const SCOPES = ['https://www.googleapis.com/auth/drive'];
    const auth = new google.auth.GoogleAuth({
        scopes: SCOPES,
        credentials: creds,
    });
    const sheetsService = google.sheets({version: 'v4', auth});
    return sheetsService;
}

svc.hooks.onSvcStart = async () => {
    svc.logger.info('Wagecents converter started');
    await reloadCredentials();
};

svc.hooks.onSvcStop = (cause) => {
    svc.logger.info('Wagecents converter is stopping');
}

svc.functions.setCredentials = async (req) => {
    console.log('Got parameters ', req.params);
    let missingFields = [];
    let expectedFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri', 'auth_provider_x509_cert_url', 'client_x509_cert_url', 'universe_domain'];
    let unexpectedFields = [];
    let suppliedFields = Object.keys(req.params);
    for(let k of suppliedFields) {
        if(! expectedFields.find(s => s == k)) unexpectedFields.push(k);
    }
    for(let k of expectedFields) {
        if(! suppliedFields.find( s => s == k)) missingFields.push(k);
    }
    if(unexpectedFields.length || missingFields.length) {
        let msg = 'Invalid parameters to set credentials: ';
        if(unexpectedFields.length) {
            msg = msg + ` Unexpected fields: ${unexpectedFields.join(', ')}`;
            if(missingFields.length) msg = msg + '; ';
        }
        if(missingFields.length) {
            msg = msg + ` Missing fields: ${missingFields.join(', ')}`;
        }
        return {error: msg};
    }
    if(! creds) {
        creds = {
            name: 'google-credentials',
            ...req.params
        };
        await svc.dataStores.dataStore1.save(creds);
    } else {
        creds = {
            ...creds,
            ...req.params
        };
        await svc.dataStores.dataStore1.update(creds);
    }
    await reloadCredentials();
    return {ok: true};
}

svc.functions.listFolders = async (req) => {
    console.log('Starting list folders...');
    const service = getDriveService();

    try {
        let folders = await service.files.list({
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            q: `mimeType='application/vnd.google-apps.folder'`
        });
        console.log(folders.data.files);
        return folders.data.files;
    } catch (err) {
        console.log('Error from google drive: ', err);
        return { error: 'Unable to list files on google drive'};
    }
}

svc.functions.uploadFile = async (req) => {
    let fileId = req?.params?.srcFile
    let destination = req?.params?.destination
    if(! fileId) {
        return { error: 'No srcFile provided'};
    }
    if(! destination) {
        return { error: 'No destination provided'};
    }
    let folderId = req?.params?.folderId;
    // FIXME - waiting on platform team to fix proxy
    // let res = await svc.files.download(fileId);
    // console.log(res);

    const fileMetadata = {
        name: req?.params?.destination,
        mimeType: 'application/vnd.google-apps.spreadsheet',
    };
    if(folderId) fileMetadata.parents = [folderId];

    const media = {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // FIXME - this should use the file received from the platform
        body: fs.createReadStream('tmp/PR_PayrollRegisterCheckLevelTotals_EP1_42.xlsx'),
    };

    try {
        const service = getDriveService();

        service.files.create({
            resource: fileMetadata,
            media: media,
            supportsAllDrives: true
        }).then((res) => {
            let responseData = {googleFileId: res.data.id, googleName: res.data.name};
            console.log('File creation complete, submitting fileUploaded event', res);
            console.log('Callback response data: ', responseData);
            svc.events.send('onUploadComplete', responseData, req.id);
        });
    } catch (err) {
        svc.logger.error('Error sending file to google drive', err);
        return { error: 'Error sending file to google drive' };
    }
    return {ok: true};
}

svc.functions.downloadCsv = async (req) => {
    console.log('starting downloadCsv', req);
    let googleFileId = req?.params?.googleId;
    if(! googleFileId) return { error: "No googleFileId to download"};
    let range = req?.params?.range;
    if(! range) range = 'Sheet1!A1:Z100';

    try {
        const drive = getDriveService();
        let info = await drive.files.get({fileId: googleFileId, supportsAllDrives: true});
        let fileName = info.data.name;
        console.log('Using file name ' + fileName);
        const service = getSheetsService();
        service.spreadsheets.values.get({ spreadsheetId: googleFileId, range: range}).then(
            (response) => {
                const data = response.data.values || [];
                const csvContant = data.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
                try {
                    svc.files.upload(fileName, csvContant).then(
                        (data) => {
                            console.log('Got app data', data);
                            svc.events.send('onDownloadComplete', data, req.id);
                        }
                    );
                } catch (err) {
                    svc.appLogger.error('Error saving CSV file:', err);
                }
            }
        );
        return {ok: true};
    } catch (err) {
        svc.appLogger.error('Error downloading data: ', err);
    }
}

// actuall run the service
svc.start();