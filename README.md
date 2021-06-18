# Pathfinder-Infra
## military simulation, flexible and on demand

This is a CDK deployment project for spinning up the following systems on AWS:

* A TeamSpeak server running under `ts.` subdomain
* An Arma 3 dedicated server running under `arma.` subdomain
  * A S3 bucket for storing the modpack
  * A S3 bucket for storing the server configuration
  * A S3 bucket for storing all Arma multiplayer missions

## Contents

* The `arma-server/` directory defines the Arma 3 server Docker image
* The `lib\pathfinder-infra-stack.ts` file defines the infrastructure stack.
* The `cdk.json` defines execution parameters.

## ToDo's

* Parametrize the stack definition further: Server memory and CPU sizes
* Add a simple method of starting/stopping the servers manually
* Add a simple method to sync mods from local workshop to S3

## Requirements
- An AWS account
  - a Route53 domain
- Locally installed software:
  - Docker Desktop
  - Node.js
  - NPM
  - AWS CLI

## Setup steps

- [Configure AWS CLI credentials](https://docs.aws.amazon.com/cdk/latest/guide/cli.html#cli-environment)
- [Bootstrap AWS environment](https://docs.aws.amazon.com/cdk/latest/guide/cli.html#cli-bootstrap)
- [Deploy the stack](https://docs.aws.amazon.com/cdk/latest/guide/cli.html#cli-deploy)
  - Parameters:
    - `hostedZoneId`: The ID of the hosted zone that should be used
    - `hostedZoneName`: The name of the hosted zone
    - `startCron`: A [cron](http://www.cronmaker.com) expression describing when to start the server infrastructure (using UTC timezone)
      - default: `0 18 * * ? *`
    - `stopCron`: A [cron](http://www.cronmaker.com) expression describing when to stop the server infrastructure (using UTC timezone)
      - default: `0 23 * * ? *`
      - Note: It's better to have stop times for days where the server isn't started automatically, too, so a manually started server isn't forgotten and won't run for days.
    - `steamUser`: Username of the steam user used to download and host the Arma server
    - `steamPassword`: Password of the steam user
    - `armaServerDiskSizeGiB`: Disk size of the Arma server in GiB
      - default: 70
  - Outputs:
    - `DataBucketNameOutput` - S3 bucket name to upload configuration for the Arma server
    - `MissionsBucketNameOutput` - S3 bucket name to upload missions for the Arma server
    - `ModsBucketNameOutput` - an S3 bucket name to upload mods for the Arma server
- From the Teamspeak server logs (see *Monitoring Logs*), extract the server admin token `token=...`
- Connect to the Teamspeak server and enter the server admin token
- Follow the steps in **Configuring the Arma server** below
- Follow the steps in **Adding mods to the Arma server** below
- Follow the steps in **Adding missions to the Arma server** below

## Monitoring Logs
- On the AWS web console, navigate to *CloudWatch*
- Navigate to *Log Groups*
- Open a log group for the component of interest
- Open the latest log stream

## Configuring the Arma server
- Create a valid server config file and save it as `main.cfg`
- On the AWS web console, navigate to *S3* and find the bucket from the `DataBucketNameOutput`
- The following files are supported and can be uploaded to the bucket:
  - `main.cfg` ([documentation](https://community.bistudio.com/wiki/server.cfg))
  - `cba_settings.sqf` (only if CBA is installed on the server | [documentation](https://github.com/CBATeam/CBA_A3/wiki/CBA-Settings-System))
  - `main.Arma3Profile` ([documentation](https://community.bistudio.com/wiki/server.armaprofile))
- Reboot the server (see *Reboot the Arma server*)
- Observe logs for any problems (see *Monitoring Logs*)

## Adding mods to the Arma server
> Note: This is a makeshift solution and will be replaced with a better one in the future.
- On the AWS web console, navigate to S3 and find the bucket name that was returned by `ModsBucketNameOutput`
- Upload local mod directories directly
- Follow the steps in **Reboot the Arma server** below
- Observe logs for any problems (see *Monitoring Logs*)

## Adding missions to the Arma server
> Note: This is a makeshift solution and will be replaced with a better one in the future.
- In Arma, export the chosen mission as multiplayer mission (with `.pbo` file extension)
- On the AWS web console, navigate to *S3* and find the bucket from the `MissionsBucketNameOutput`
- Upload the mission file
- Follow the steps in **Reboot the Arma server** below
- Observe logs for any problems (see *Monitoring Logs*)

## Reboot the Arma server
> Note: This is a makeshift solution and will be replaced with a better one in the future.
- On the AWS web console, navigate to *ECS* and find the ECS cluster
- In the ECS cluster, open the tasks and identify the Arma server task using the task definition prefixed with `PathfinderInfraStackArmaTask`
- Stop the task
- Wait for the service to recreate the task

## Useful commands

- `npm run build` compile typescript to js
- `cdk deploy --parameters <params>` deploy this stack to your default AWS account/region
- `cdk destroy` destroy this stack (use with caution)
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
- `aws logs tail $group_name --follow` to watch logs of a log group in AWS
- `npm install -g aws-cdk` to update CDK