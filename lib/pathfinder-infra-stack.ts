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

    // The MySQL Database for Teamspeak
    const dbSecret = new secretsmanager.Secret(this, 'TeamspeakDbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'user' }),
        generateStringKey: 'password',
      },
    });

    const dbCrendentials = rds.Credentials.fromSecret(dbSecret, "dbadmin");
    const dbCluster = new rds.ServerlessCluster(this, 'TeamspeakDbCluster', {
      vpc: vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE,
      },
      engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
      credentials: dbCrendentials,
    });

    // The ECS cluster (only used with Fargate tasks)
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc
    });

    // The Teamspeak Fargate task
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Teamspeak');

    taskDefinition.addContainer('TeamspeakContainer', {
      image: ecs.ContainerImage.fromRegistry("teamspeak"),
      memoryLimitMiB: 512,
      environment: {
        TS3SERVER_DB_PLUGIN: "ts3db_mysql",
        TS3SERVER_DB_SQLCREATEPATH: "create_mysql",
        TS3SERVER_DB_HOST: dbCluster.clusterEndpoint.hostname,
        TS3SERVER_DB_USER: dbCrendentials.username,
        TS3SERVER_DB_PASSWORD: "${DB_SECRET}",
        TS3SERVER_DB_NAME: "teamspeak",
        TS3SERVER_DB_WAITUNTILREADY: "30",
        TS3SERVER_LICENSE: "accept"
      },
      secrets: {
        DB_SECRET: ecs.Secret.fromSecretsManager(dbSecret)
      }
    });

    const ecsService = new ecs.FargateService(this, 'MainCluster', {
      taskDefinition,
      cluster
    })
  }
}
