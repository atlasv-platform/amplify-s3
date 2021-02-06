#!/usr/bin/env node
const _ = require('lodash');
const aws = require('aws-sdk');
const yargs = require("yargs");
const fs = require('fs');
const path = require('path');
const chalk = require("chalk");
const boxen = require("boxen");
const Confirm = require('prompt-confirm');

const prompt = new Confirm('Do you confirm to delete?');

let amplifyConfig, amplifyMeta
try {
    const options = yargs
        .help()
        .demandCommand()
        .command('ls [path]', 'List S3 objects of certain path in bucket.')
        .command('upload <localPath> [path]', 'Upload a file or a directory to S3 bucket')
        .command('rm <path>', 'Remove a file or a directory from S3 bucket')
        .argv;
    amplifyConfig = require(`${process.env['HOME']}/.amplify/admin/config.json`);
    amplifyMeta = require(`${process.cwd()}/amplify/#current-cloud-backend/amplify-meta.json`);
    const bucketName = Object.values(amplifyMeta.storage)[0].output.BucketName;
    const appId = amplifyMeta.providers.awscloudformation.AmplifyAppId;

    initToken(appId).then((config) => {
        const s3 = new aws.S3();
        switch (options._[0]) {
            case 'ls':
                const params = {
                    Bucket: bucketName,
                    Prefix: `public/${options.path ? options.path : ''}`
                };
                s3.listObjectsV2(params, function (err, data) {
                    if (err) error(err); // an error occurred
                    else {
                        output = `Bucket: ${data.Name}
List Total: ${data.KeyCount}
IsTruncated: ${data.IsTruncated}
                        
Name          Size          LastModified
`;
                        data.Contents.forEach((item) => {
                            output += `${item.Key}  ${item.Size}  ${item.LastModified}\n`
                        })
                        info(output);
                    }
                });
                break;
            case 'upload':
                const uploadList = [];
                const isFile = recursiveFiles(options.localPath, uploadList);
                uploadList.forEach(filePath => {
                    const fileStream = fs.createReadStream(filePath);
                    fileStream.on('error', function (err) {
                        error(err);
                    });

                    const params = { Bucket: bucketName, Key: `public/${options.path ? options.path + '/' : ''}${isFile ? path.basename(options.localPath) : filePath.replace(options.localPath + '/', '')}`, Body: fileStream };
                    s3.upload(params, { partSize: 5 * 1024 * 1024, queueSize: 3 }, function (err, data) {
                        if (err) error(err);
                        else {
                            log(`${data.Key} uploaded successfully`);
                        }
                    });
                });
                break;
            case 'rm':
                prompt.ask(function (answer) {
                    if (answer) {
                        const listParams = {
                            Bucket: bucketName,
                            Prefix: `public/${options.path ? options.path : ''}`
                        };
                        const rmParams = {
                            Bucket: bucketName,
                            Delete: {
                                Objects: [],
                                Quiet: false
                            }
                        };
                        s3.listObjectsV2(listParams, function (err, data) {
                            if (err) error(err);
                            else {
                                data.Contents.forEach((item) => {
                                    rmParams.Delete.Objects.push({
                                        Key: item.Key,
                                    });
                                });
                                s3.deleteObjects(rmParams, function (err, data) {
                                    if (err) error(err);
                                    else {
                                        let success = '';
                                        let fail = '';
                                        data.Deleted.forEach(del => {
                                            success += `${del.Key}\n`;
                                        });
                                        data.Errors.forEach(e => {
                                            fail += `${e.Key}:  ${e.Message}\n`;
                                        });
                                        if (success) {
                                            info(success);
                                        }
                                        if (fail) {
                                            error(fail);
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
                break;
            default:
                break;
        }
    });
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        if (!amplifyConfig) {
            error('Amplify Credentials has not been created!');
        } if (!amplifyMeta) {
            error('Amplify Project Not Found! Please run this command in the project root.');
        } else {
            error(err);
        }
    } else {
        error(err);
    }

}
function recursiveFiles(filepath, fileList) {
    if (path.basename(filepath).startsWith('.')) {
        return false;
    }
    const pathInfo = fs.statSync(filepath);
    if (pathInfo.isDirectory()) {
        fs.readdirSync(filepath).forEach(file => {
            recursiveFiles(`${filepath}/${file}`, fileList);
        });
        return false;
    } else {
        fileList.push(filepath);
        return true;
    }
}

async function initToken(appId) {
    admin = amplifyConfig[appId];
    if (isJwtExpired(admin.idToken)) {
        refreshResult = await refreshJWTs(admin);
        admin.idToken.jwtToken = refreshResult.IdToken;
        admin.accessToken.jwtToken = refreshResult.AccessToken;
    }
    awsConfig = await getAdminCognitoCredentials(admin.idToken, admin.IdentityId, admin.region);
    aws.config.update(awsConfig);
    return awsConfig;
}

async function getAdminCognitoCredentials(idToken, identityId, region) {
    const cognitoIdentity = new aws.CognitoIdentity({ region });
    const login = idToken.payload.iss.replace('https://', '');
    const { Credentials } = await cognitoIdentity
        .getCredentialsForIdentity({
            IdentityId: identityId,
            Logins: {
                [login]: idToken.jwtToken,
            },
        })
        .promise();

    return {
        accessKeyId: Credentials.AccessKeyId,
        expiration: Credentials.Expiration,
        region,
        secretAccessKey: Credentials.SecretKey,
        sessionToken: Credentials.SessionToken,
    };
}
async function refreshJWTs(authConfig) {
    const CognitoISP = new aws.CognitoIdentityServiceProvider({ region: authConfig.region });
    try {
        const result = await CognitoISP.initiateAuth({
            AuthFlow: 'REFRESH_TOKEN',
            AuthParameters: {
                REFRESH_TOKEN: authConfig.refreshToken.token,
            },
            ClientId: authConfig.accessToken.payload.client_id, // App client id from identityPool
        }).promise();
        return result.AuthenticationResult;
    } catch (e) {
        console.error(`Failed to refresh tokens: ${e.message || 'Unknown error occurred'}`);
        throw e;
    }
}
function isJwtExpired(token) {
    const expiration = _.get(token, ['payload', 'exp'], 0);
    const secSinceEpoch = Math.round(new Date().getTime() / 1000);
    return secSinceEpoch >= expiration - 60;
}
function log(str) {
    const msg = chalk.green.bold(str);
    console.log(msg);
}
function info(str) {
    const msg = chalk.green.bold(str);
    const boxenOptions = {
        padding: 1,
        borderColor: 'blue',
    };
    const msgBox = boxen(msg, boxenOptions);
    console.log(msgBox);
}
function error(str) {
    const msg = chalk.red.bold(str);
    const boxenOptions = {
        padding: 1,
        borderColor: 'blue',
    };
    const msgBox = boxen(msg, boxenOptions);
    console.log(msgBox);
}