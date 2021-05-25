# Pathfinder Infrastructure

This is a CDK deployment project for spinning up the following systems on AWS:

* An Arma 3 dedicated server
* A S3 bucket for storing the modpack and server configuration
* A S3 bucket for storing all Arma multiplayer missions
* A TeamSpeak server

The `cdk.json` defines execution parameters.
The `lib\pathfinder-infra-stack.ts` file defines the infrastructure stack.

## ToDo's

* Scheduled operation of Arma and Teamspeak
* Game settings persistence

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk destroy` destroy this stack (use with caution)
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
- `aws logs tail $group_name --follow` to watch logs of a log group in AWS

## Setup steps
- Run `npm install` to install all dependencies
- Run `cdk deploy` to deploy the application
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
  - Note that all `.pbo` files need to be lowercase
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