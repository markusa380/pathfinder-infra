import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // A VPC that contains all infrastructure
    const vpc = new ec2.Vpc(this, 'MainVpc', {});

    const dbAdminName = 'dbAdmin';
    const dbName = 'teamspeak'

    // The MySQL Database for Teamspeak
    const dbSecret = new secretsmanager.Secret(this, 'TeamspeakDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: dbAdminName }),
        generateStringKey: 'password',
      },
    });

    const dbCrendentials = rds.Credentials.fromSecret(dbSecret, dbAdminName);
    const dbInstance = new rds.DatabaseInstance(this, 'TeamspeakDb', {
      engine: rds.DatabaseInstanceEngine.mariaDb({
        version: rds.MariaDbEngineVersion.VER_10_5_8
      }),
      vpc: vpc,
      databaseName: dbName,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      credentials: dbCrendentials
    })

    // The ECS cluster (only used with Fargate tasks)
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc
    });

    // The Teamspeak Fargate task
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Teamspeak', {
      cpu: 512,
      memoryLimitMiB: 2048
    });

    taskDefinition.addContainer('TeamspeakContainer', {
      image: ecs.ContainerImage.fromRegistry("teamspeak"),
      memoryLimitMiB: 512,
      environment: {
        TS3SERVER_DB_PLUGIN: "ts3db_mariadb",
        TS3SERVER_DB_SQLCREATEPATH: "create_mariadb",
        TS3SERVER_DB_HOST: dbInstance.dbInstanceEndpointAddress,
        TS3SERVER_DB_USER: dbCrendentials.username,
        TS3SERVER_DB_PASSWORD: "${DB_SECRET}",
        TS3SERVER_DB_NAME: dbName,
        TS3SERVER_DB_WAITUNTILREADY: "30",
        TS3SERVER_LICENSE: "accept"
      },
      secrets: {
        DB_SECRET: ecs.Secret.fromSecretsManager(dbSecret)
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "teamspeak-task-logs"
      })
    });

    const ecsService = new ecs.FargateService(this, 'TeamspeakService', {
      taskDefinition,
      cluster,
      assignPublicIp: true
    })
  }
}
