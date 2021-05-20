import * as cdk from '@aws-cdk/core';
import * as ecs from '@aws-cdk/aws-ecs';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as rds from '@aws-cdk/aws-rds';
import * as iam from '@aws-cdk/aws-iam';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

export class PathfinderInfraStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'MainVpc', {});

    // ### Security Groups ### //

    const teamspeakSecurityGroup = new ec2.SecurityGroup(this, 'TeamspeakSg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'TeamspeakDbSg', {
      vpc: vpc,
      allowAllOutbound: true
    })

    dbSecurityGroup.addIngressRule(teamspeakSecurityGroup, ec2.Port.tcp(3306), "Access of DB from Teamspeak")

    teamspeakSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(10011), "Access for clients of TeamSpeak #1")
    teamspeakSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(30033), "Access for clients of TeamSpeak #2")
    teamspeakSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(9987), "Access for clients of TeamSpeak #3")

    // ### Teamspeak Database ###

    const dbAdminName = 'dbAdmin'
    const dbName = 'teamspeak'

    const dbPassword = new secretsmanager.Secret(this, 'TeamspeakDbPassword', {
      generateSecretString: {
        includeSpace: false,
        excludePunctuation: true
      },
    })

    const dbCrendentials = rds.Credentials.fromPassword(dbAdminName, dbPassword.secretValue)

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
      credentials: dbCrendentials,
      securityGroups: [dbSecurityGroup]
    })

    // ### Compute Cluster ###

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: vpc
    })

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'Teamspeak', {
      cpu: 512,
      memoryLimitMiB: 2048
    })

    taskDefinition.addContainer('TeamspeakContainer', {
      image: ecs.ContainerImage.fromRegistry("teamspeak"),
      memoryLimitMiB: 512,
      environment: {
        TS3SERVER_DB_PLUGIN: "ts3db_mariadb",
        TS3SERVER_DB_SQLCREATEPATH: "create_mariadb",
        TS3SERVER_DB_HOST: dbInstance.dbInstanceEndpointAddress,
        TS3SERVER_DB_USER: dbCrendentials.username,
        TS3SERVER_DB_NAME: dbName,
        TS3SERVER_DB_WAITUNTILREADY: "30",
        TS3SERVER_LICENSE: "accept"
      }, 
      secrets: {
        TS3SERVER_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbPassword)
      },
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: "teamspeak-task-logs"
      }),
      portMappings: [
        {
          containerPort: 9987,
          hostPort: 9987,
          protocol: ecs.Protocol.UDP
        },
        {
          containerPort: 10011,
          hostPort: 10011
        },
        {
          containerPort: 30033,
          hostPort: 30033
        }
      ]
    })

    const ecsService = new ecs.FargateService(this, 'TeamspeakService', {
      taskDefinition,
      cluster,
      assignPublicIp: true,
      securityGroups: [teamspeakSecurityGroup]
    })
  }
}
