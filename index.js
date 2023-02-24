#!/usr/bin/env node
const _ = require('lodash');
const aws = require('aws-sdk');
const yargs = require("yargs");
const fs = require('fs');
const path = require('path');
const chalk = require("chalk");
const boxen = require("boxen");
const inquirer = require('inquirer');
const {sync,listAll,initClient} = require('./sync');

let amplifyConfig, amplifyMeta;
let backendType = 's3';
try {
    const options = yargs
        .help()
        .demandCommand()
        .command('sync <src> <dest> [subpath] [--delete]', 'sync the whole public dir from <src> to <dest> or sync a subpath. When add [--delete], file that that only exist in dest will  be deleted.')
        .command('ls [path]', 'List S3 objects of certain path in bucket.')
        .command('upload <localPath> [path]', 'Upload a file or a directory to S3 bucket.')
        .command('download <s3Path> [path]', 'Download directory from S3 bucket.')
        .command('rm <path>', 'Remove a file or a directory from S3 bucket.')
        .command('init <backend>', 'init a new backend,now only support space.S3 backend do not need to be inited.')
        .options({
            'space': {
              description: 'change backend service to space',
              type: 'boolean'
            }
        })
        .argv;
    amplifyConfig = require(`${process.env['HOME']}/.amplify/admin/config.json`);
    amplifyMeta = require(`${process.cwd()}/amplify/#current-cloud-backend/amplify-meta.json`);
    let bucketName = Object.values(amplifyMeta.storage)[0].output.BucketName;
    const appId = amplifyMeta.providers.awscloudformation.AmplifyAppId;
    if(options.space){
        backendType = 'space';
        if(!fs.existsSync(`.${backendType}/config.json`)){
            throw new Error('Space Config not found, please use `amplifys3 init space` to create one');
        }
    }
    initToken(appId).then(async (config) => {
        const s3 = new aws.S3();
        if(backendType === 'space') {
            bucketName = config.bucket;
        }
        initClient(s3);
        switch (options._[0]) {
            case 'init':
                if(options.backend === 'space') {
                    let questions = [
                        {
                          type: 'input',
                          name: 'bucketName',
                          message: "Enter DigitalOcean Space BucketName:"
                        },
                        {
                            type: 'list',
                            name: 'endpoint',
                            choices:['sfo3.digitaloceanspaces.com','nyc3.digitaloceanspaces.com'],
                            message: "Enter DigitalOcean Space Endpoint:"
                          },
                          {
                            type: 'input',
                            name: 'accessKeyId',
                            message: "Enter DigitalOcean Space AccessKeyId:"
                          },
                          {
                            type: 'input',
                            name: 'secretAccessKey',
                            message: "Enter DigitalOcean Space SecretAccessKey:"
                          }
                    ]
                    const init_ans = await inquirer.prompt(questions);
                    if(init_ans.bucketName && init_ans.endpoint && init_ans.accessKeyId && init_ans.secretAccessKey){
                        init_config = {
                            "bucket": init_ans.bucketName,
                            "endpoint": init_ans.endpoint,
                            "accessKeyId": init_ans.accessKeyId,
                            "secretAccessKey": init_ans.secretAccessKey
                        };
                        fs.mkdirSync(`.${options.backend}`,{recursive: true});
                        fs.writeFileSync(`.${options.backend}/config.json`,JSON.stringify(init_config));
                        log(`${options.backend} backend config has been created`);
                    } else {
                        error('Missing one of the config options!')
                    }
                } else {
                    error('No supported backend specified!')
                }
                break;
            case 'sync':
                if(backendType === 'space') {
                    throw new Error('Command not supported yet for space backend.');
                }
                const amplifybackend = new aws.AmplifyBackend();
                const srcMD = await amplifybackend.getBackend({
                    AppId: appId,
                    BackendEnvironmentName: options.src
                }).promise();
                const srcbuctet = Object.values(JSON.parse(srcMD.AmplifyMetaConfig).storage)[0].output.BucketName;
                const destMD = await amplifybackend.getBackend({
                    AppId: appId,
                    BackendEnvironmentName: options.dest
                }).promise();
                const destbuctet = Object.values(JSON.parse(destMD.AmplifyMetaConfig).storage)[0].output.BucketName;
                let subpath = '/'
                if (options.subpath)
                    subpath += options.subpath;
                try{
                    const {countAdd, bytesAdd,countRm,bytesRm} = await sync(srcbuctet, `public${subpath}`, destbuctet, `public${subpath}`,options.delete);
                    info(`Sync Summary:\n Add ${countAdd} files, ${sizeTxt(bytesAdd)} in public${subpath}`+ (options.delete?`\n Delete ${countRm} files, ${sizeTxt(bytesRm)} in public${subpath}`:''));
                } catch(syncErr) {
                    error(syncErr);
                }
                break;
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

                    const params = {Bucket: bucketName, Key: `public/${options.path ? options.path + '/' : ''}${isFile ? path.basename(options.localPath) : filePath.replace(options.localPath + '/', '')}`, Body: fileStream };
                    if(backendType === 'space') {
                        params.ACL = 'public-read';
                    }
                    s3.upload(params, { partSize: 5 * 1024 * 1024, queueSize: 3 }, function (err, data) {
                        if (err) error(err);
                        else {
                            log(`${data.Key} uploaded successfully`);
                        }
                    });
                });
                break;
            case 'download':
                const downloadList = await listAll(bucketName, `public/${options.s3Path}`)
                downloadList.forEach(s3file => {
                    if(s3file.Size > 0){
                        let targetPath = options.path;
                        if (targetPath == undefined) {
                            targetPath = ""
                        }
                        const destFile = `${targetPath}${options.s3Path}${s3file.Key}`;
                        fs.mkdirSync(path.dirname(destFile),{recursive: true});
                        const destStream = fs.createWriteStream(destFile);
                        destStream.on('error', function (err) {
                            error(err);
                        });
                        destStream.on('finish', function (dd) {
                            log(`${destFile} downloaded successfully`);
                        });
                        const down_params = { 
                            Bucket: bucketName, 
                            Key: `public/${options.s3Path}${s3file.Key}`
                        };
                        s3.getObject(down_params).createReadStream().pipe(destStream);
                    }
                });
                break;
            case 'rm':
                const {confirmDel} = await inquirer.prompt([
                    {
                      type: 'confirm',
                      name: 'confirmDel',
                      message: 'Do you confirm to delete?'
                    },]);
                if (confirmDel) {
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
                break;
            default:
                break;
        }
    }).catch(error);
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
function sizeTxt(bytes){
    if(bytes < 10485) return `${(bytes/1024.0).toFixed(2)} KB`
    else return `${(bytes/1024.0/1024.0).toFixed(2)} MB`
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
    if(backendType === 's3') {
        admin = amplifyConfig[appId];
        if (isJwtExpired(admin.idToken)) {
            refreshResult = await refreshJWTs(admin);
            admin.idToken.jwtToken = refreshResult.IdToken;
            admin.accessToken.jwtToken = refreshResult.AccessToken;
        }
        awsConfig = await getAdminCognitoCredentials(admin.idToken, admin.IdentityId, admin.region);
        aws.config.update(awsConfig);
        return awsConfig;
    } else if (backendType === 'space') {
        spaceConfig = require(`${process.cwd()}/.space/config.json`);
        awsConfig = {
            bucket: spaceConfig.bucket,
            endpoint: `https://${spaceConfig.endpoint}`,
            region: "us-east-1",
            credentials: {
              accessKeyId: spaceConfig.accessKeyId,
              secretAccessKey: spaceConfig.secretAccessKey
            }
        };
        aws.config.update(awsConfig);
        return awsConfig;
    }
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