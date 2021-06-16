# Pathfinder-Infra
## military simulation, flexible and on demand

This is a CDK deployment project for spinning up the following systems on AWS:

* A TeamSpeak server
* An Arma 3 dedicated server
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

## Setup steps

- Follow the steps in **Publishing the Arma server docker image** below
- Purchase or reuse an existing domain from AWS Route53
- Run `npm install` to install all dependencies
- Run `cdk deploy --parameters <param> --parameters <param> ...` to deploy the application
  - Parameters are in `key=value` or `key="value"` format
  - Possible parameters are:
    - `hostedZoneId`: The ID of the hosted zone that should be used
    - `hostedZoneName`: The name of the hosted zone
    - `startCron`: A [cron](http://www.cronmaker.com) expression describing when to start the server infrastructure (using UTC timezone)
      - default: `0 18 * * ? *`
    - `stopCron`: A [cron](http://www.cronmaker.com) expression describing when to stop the server infrastructure (using UTC timezone)
      - default: `0 23 * * ? *`
    - `steamUser`: Username of the steam user used to download and host the Arma server
    - `steamPassword`: Password of the steam user
    - `armaServerDiskSizeGiB`: Disk size of the Arma server in GiB
      - default: 70
  - Note the three outputs:
    - `ServerAddressOutput`
    - `DataBucketNameOutput`
    - `MissionsBucketNameOutput`
- On the AWS web console, navigate to *CloudWatch* and find the log group 
  with the prefix `PathfinderInfraStack-TeamspeakTaskTeamspeakContainerLogGroup` and open the latest log stream
- From the logs, extract the server admin token `token=...`
- Connect to the Teamspeak server with the address from the `ServerAddressOutput` and enter the server admin token
- Follow the steps in **Configuring the Arma server** below
- Follow the steps in **Adding mods to the Arma server** below
- Follow the steps in **Adding missions to the Arma server** below

## Publishing the Arma server Docker image
- Navigate to the `arma-server` directory
- Run `docker build . --tag=<tag>`, where `<tag>` has the format of `<user>/<repo>:<ver>`
  - Replace `<user>` with your Docker Hub username
  - Replace `<repo>` with a repository on Docker Hub you have access to
  - Replace `<ver>` with a reasonable name indicating the current version of the image
- Run `docker push <tag>`

## Configuring the Arma server
- Create a valid server config file and save it as `main.cfg`
- On the AWS web console, navigate to *S3* and find the bucket from the `DataBucketNameOutput`
- Upload the config file with default configuration
- Follow the steps in **Reboot the Arma server** below
- On the AWS web console, navigate to *CloudWatch* and find the log group 
  with the prefix `PathfinderInfraStack-ArmaTaskArmaContainerLogGroup` and open the latest log stream
- Observe the logs for any problems

## Adding mods to the Arma server
- Add all mods for the server to a zip file called `mods.zip`
  - Note that all `.pbo` files need to be lowercase (TODO: Maybe already fixed)
- On the AWS web console, navigate to *S3* and find the bucket from the `DataBucketNameOutput`
- Upload the file with default configuration
- Follow the steps in **Reboot the Arma server** below
- On the AWS web console, navigate to *CloudWatch* and find the log group 
  with the prefix `PathfinderInfraStack-ArmaTaskArmaContainerLogGroup` and open the latest log stream
- Observe the logs for any problems

## Adding missions to the Arma server
- Export the chosen mission as multiplayer mission (with `.pbo` file extension)
- On the AWS web console, navigate to *S3* and find the bucket from the `MissionsBucketNameOutput`
- Upload the mission file with default configuration
- Follow the steps in **Reboot the Arma server** below
- On the AWS web console, navigate to *CloudWatch* and find the log group 
  with the prefix `PathfinderInfraStack-ArmaTaskArmaContainerLogGroup` and open the latest log stream
- Observe the logs for any problems

## Reboot the Arma server
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