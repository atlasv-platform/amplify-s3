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
  amplifys3 sync <src> <dest> [subpath]     sync the whole public dir from <src>
  [--delete]                                to <dest> or sync a subpath. When
                                            add [--delete], file that that only
                                            exist in dest will  be deleted.
  amplifys3 ls [path]                        List S3 objects of certain path in
                                            bucket.
  amplifys3 upload <localPath> [path]       Upload a file or a directory to S3
  [--refreshTime refreshTime]               bucket, refreshTime is the time in
                                            seconds to refresh (at least 60).
  amplifys3 download <s3Path> [path]         Download directory from S3 bucket.
  amplifys3 rm <path>                        Remove a file or a directory from S3
                                            bucket.
  amplifys3 init <backend>                  init a new backend,now only support
                                            space.S3 backend do not need to be
                                            inited.
```
