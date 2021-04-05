# amplify-s3

Use amplify project config to manage `storage` public files (files in S3 with public prefix), then amplify app can access these files with public access level. You must running the command in the root of the project.

## Install
```
npm install -g amplify-s3
```

## Usage

```
amplifys3 <command>

Commands:
  amplifys3 sync <src> <dest> [subpath] sync the whole public dir from <src> to <dest> or sync a subpath
  amplifys3 ls [path]                   List S3 objects of certain path in bucket
  amplifys3 upload <localPath> [path]   Upload a file or a directory to S3 bucket
  amplifys3 rm <path>                   Remove a file or a directory from S3 bucket
```
